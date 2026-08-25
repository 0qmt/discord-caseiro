import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

/**
 * Formato pelo conteudo real do arquivo, nunca pelo nome nem pelo MIME que o
 * navegador manda. `animated` decide se a imagem e guardada inteira (com o
 * recorte aplicado so na exibicao) ou se ja veio recortada pelo canvas.
 */
export function sniffImage(buffer) {
  if (buffer.length < 12) return null;
  const ascii = (start, end) => buffer.subarray(start, end).toString('latin1');

  if (ascii(0, 4) === 'GIF8') return { ext: 'gif', animated: true };

  if (buffer[0] === 0x89 && ascii(1, 4) === 'PNG') {
    // APNG se declara com um chunk acTL, sempre antes do primeiro IDAT.
    const head = buffer.subarray(0, 4096).toString('latin1');
    const actl = head.indexOf('acTL');
    const idat = head.indexOf('IDAT');
    return { ext: 'png', animated: actl !== -1 && (idat === -1 || actl < idat) };
  }

  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { ext: 'jpg', animated: false };
  }

  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') {
    // So o formato estendido (VP8X) anima; o bit 0x02 das flags marca isso.
    const animated = ascii(12, 16) === 'VP8X' && (buffer[20] & 0x02) !== 0;
    return { ext: 'webp', animated };
  }

  return null;
}

/** Recorte em porcentagem, do jeito que o react-easy-crop entrega. */
export function parseCrop(raw) {
  if (!raw) return null;
  let value;
  try {
    value = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
  const nums = ['x', 'y', 'width', 'height'].map((k) => Number(value?.[k]));
  if (nums.some((n) => !Number.isFinite(n))) return null;
  if (nums[2] <= 0 || nums[3] <= 0) return null;
  const [x, y, width, height] = nums;
  return { x, y, width, height };
}

export function removeFile(url) {
  if (!url?.startsWith('/uploads/')) return;
  // path.basename corta qualquer tentativa de ../ no caminho guardado.
  fs.rm(path.join(config.uploadsDir, path.basename(url)), { force: true }, () => {});
}
