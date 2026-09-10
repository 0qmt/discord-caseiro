import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { Router } from 'express';
import multer from 'multer';
import { config } from '../config.js';
import { requireAuth } from '../lib/auth.js';

export const attachmentRoutes = Router();
attachmentRoutes.use(requireAuth);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxAttachmentBytes, files: 1 },
});

const EXT_IMAGEM = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.avif']);
const EXT_VIDEO = new Set(['.mp4', '.webm', '.mov', '.m4v', '.mkv']);
const EXT_AUDIO = new Set(['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac']);

/** Categoria grosseira pra decidir como o cliente mostra o anexo. */
function categoriaDe(mimetype, originalname) {
  const tipo = String(mimetype ?? '').toLowerCase();
  if (tipo.startsWith('image/')) return 'image';
  if (tipo.startsWith('video/')) return 'video';
  if (tipo.startsWith('audio/')) return 'audio';
  const ext = path.extname(originalname ?? '').toLowerCase();
  if (EXT_IMAGEM.has(ext)) return 'image';
  if (EXT_VIDEO.has(ext)) return 'video';
  if (EXT_AUDIO.has(ext)) return 'audio';
  return 'file';
}

/**
 * Anexo de mensagem: qualquer arquivo, sem inspecionar o conteudo (isso e
 * coisa do avatar/banner, que precisa saber se e GIF animado). Aqui a gente
 * so confia na extensao original pro download fazer sentido, e no
 * content-type que o navegador mandou pra decidir como exibir.
 */
attachmentRoutes.post('/', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'nenhum arquivo enviado' });

  const extensaoOriginal = path.extname(req.file.originalname).slice(0, 10);
  const filename = `${req.user.id}-${crypto.randomBytes(8).toString('hex')}${extensaoOriginal}`;
  fs.writeFileSync(path.join(config.uploadsDir, filename), req.file.buffer);

  res.json({
    attachment: {
      url: `/uploads/${filename}`,
      type: categoriaDe(req.file.mimetype, req.file.originalname),
      name: req.file.originalname,
      size: req.file.size,
    },
  });
});

attachmentRoutes.use((err, _req, res, next) => {
  if (err?.code === 'LIMIT_FILE_SIZE') {
    const mb = Math.round(config.maxAttachmentBytes / (1024 * 1024));
    return res.status(413).json({ error: `arquivo passa de ${mb} MB` });
  }
  return next(err);
});
