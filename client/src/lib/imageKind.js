/**
 * Descobre o formato pelos bytes do arquivo, nunca por `file.type`.
 *
 * No Windows o MIME que o navegador reporta vem da associacao de extensao do
 * registro: se ela estiver alterada, um .gif chega como tipo vazio. Confiar
 * nisso fazia GIF animado cair no caminho do canvas e virar imagem parada.
 */
const ascii = (bytes, start, end) => String.fromCharCode(...bytes.slice(start, end));

export async function detectImageKind(file) {
  const head = new Uint8Array(await file.slice(0, 4096).arrayBuffer());
  if (head.length < 12) return null;

  if (ascii(head, 0, 4) === 'GIF8') {
    return { ext: 'gif', animated: true };
  }

  if (head[0] === 0x89 && ascii(head, 1, 4) === 'PNG') {
    // APNG se declara com um chunk acTL, que vem antes do primeiro IDAT.
    const idat = ascii(head, 0, head.length).indexOf('IDAT');
    const actl = ascii(head, 0, head.length).indexOf('acTL');
    return { ext: 'png', animated: actl !== -1 && (idat === -1 || actl < idat) };
  }

  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) {
    return { ext: 'jpg', animated: false };
  }

  if (ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 12) === 'WEBP') {
    // Só o formato estendido (VP8X) anima, e o bit 0x02 das flags marca isso.
    const animated = ascii(head, 12, 16) === 'VP8X' && (head[20] & 0x02) !== 0;
    return { ext: 'webp', animated };
  }

  return null;
}
