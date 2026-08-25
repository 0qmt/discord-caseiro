import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { config } from '../config.js';
import { q } from '../db.js';
import { requireAuth } from '../lib/auth.js';
import { emitToGuild } from '../lib/bus.js';
import { parseCrop, removeFile, sniffImage } from '../lib/images.js';
import { sharesGuild } from '../lib/permissions.js';
import { profileDto, publicUser, selfUser } from '../lib/serialize.js';

export const userRoutes = Router();
userRoutes.use(requireAuth);

const MAX_BIO = 300;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxAvatarBytes, files: 1 },
});

/** Avisa todos os servidores em que a pessoa esta, pra atualizar na hora. */
function broadcastUser(user) {
  const dto = publicUser(user);
  for (const { guild_id: guildId } of q.all(
    'SELECT guild_id FROM guild_members WHERE user_id = ?', user.id,
  )) {
    emitToGuild(guildId, 'user:updated', { user: dto });
  }
}

const reload = (id) => q.get('SELECT * FROM users WHERE id = ?', id);

/* --------------------------- imagens do perfil --------------------------- */

/** Avatar e banner seguem exatamente a mesma regra; so mudam as colunas. */
function saveImage(req, res, { urlColumn, cropColumn }) {
  if (!req.file) return res.status(400).json({ error: 'nenhum arquivo enviado' });

  const kind = sniffImage(req.file.buffer);
  if (!kind) {
    return res.status(400).json({ error: 'formato nao suportado (use png, jpg, webp ou gif)' });
  }

  const crop = parseCrop(req.body?.crop);

  // Imagem animada chega inteira e o recorte e aplicado na hora de exibir,
  // senao a animacao se perderia. Imagem parada ja chega recortada do canvas.
  if (kind.animated && !crop) {
    return res.status(400).json({ error: 'imagem animada precisa vir com os dados do recorte' });
  }

  const filename = `${req.user.id}-${crypto.randomBytes(8).toString('hex')}.${kind.ext}`;
  fs.writeFileSync(path.join(config.uploadsDir, filename), req.file.buffer);
  removeFile(req.user[urlColumn]);

  q.run(
    `UPDATE users SET ${urlColumn} = ?, ${cropColumn} = ? WHERE id = ?`,
    `/uploads/${filename}`, kind.animated ? JSON.stringify(crop) : null, req.user.id,
  );

  const updated = reload(req.user.id);
  broadcastUser(updated);
  return res.json({ user: selfUser(updated) });
}

function clearImage(req, res, { urlColumn, cropColumn }) {
  removeFile(req.user[urlColumn]);
  q.run(`UPDATE users SET ${urlColumn} = NULL, ${cropColumn} = NULL WHERE id = ?`, req.user.id);

  const updated = reload(req.user.id);
  broadcastUser(updated);
  return res.json({ user: selfUser(updated) });
}

const AVATAR = { urlColumn: 'avatar_url', cropColumn: 'avatar_crop' };
const BANNER = { urlColumn: 'banner_url', cropColumn: 'banner_crop' };

userRoutes.post('/me/avatar', upload.single('file'), (req, res) => saveImage(req, res, AVATAR));
userRoutes.delete('/me/avatar', (req, res) => clearImage(req, res, AVATAR));

userRoutes.post('/me/banner', upload.single('file'), (req, res) => saveImage(req, res, BANNER));
userRoutes.delete('/me/banner', (req, res) => clearImage(req, res, BANNER));

/* -------------------------------- perfil --------------------------------- */

userRoutes.patch('/me', (req, res) => {
  const patch = {};

  if (req.body?.username !== undefined) {
    const username = String(req.body.username).trim();
    if (username.length < 2 || username.length > 32) {
      return res.status(400).json({ error: 'nome de usuario precisa ter de 2 a 32 caracteres' });
    }
    patch.username = username;
  }

  if (req.body?.handle !== undefined) {
    const handle = String(req.body.handle).trim().toLowerCase().replace(/^@/, '');
    if (handle) {
      if (!/^[a-z0-9_]{3,32}$/.test(handle)) {
        return res.status(400).json({
          error: '@usuario precisa ter de 3 a 32 caracteres: letras minusculas, numeros ou _',
        });
      }
      const emUso = q.get('SELECT id FROM users WHERE handle = ? AND id != ?', handle, req.user.id);
      if (emUso) return res.status(409).json({ error: 'esse @usuario ja esta em uso' });
    }
    patch.handle = handle || null;
  }

  if (req.body?.bio !== undefined) {
    const bio = String(req.body.bio).trim();
    if (bio.length > MAX_BIO) {
      return res.status(400).json({ error: `a descricao passa de ${MAX_BIO} caracteres` });
    }
    patch.bio = bio || null;
  }

  // As duas cores do tema andam juntas: só faz sentido validar/gravar em par
  // (nao dá pra ter só metade de um gradiente).
  if (req.body?.themePrimary !== undefined || req.body?.themeAccent !== undefined) {
    const corValida = (v) => (v === null || v === undefined
      ? null
      : (/^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : undefined));
    const primary = corValida(req.body.themePrimary);
    const accent = corValida(req.body.themeAccent);
    if (primary === undefined || accent === undefined) {
      return res.status(400).json({ error: 'cor do tema precisa ser #rrggbb' });
    }
    patch.theme_primary = primary;
    patch.theme_accent = accent;
  }

  if (req.body?.themePosition !== undefined) {
    const bruto = req.body.themePosition;
    const posicao = bruto === null ? null : Number(bruto);
    if (posicao !== null && (!Number.isFinite(posicao) || posicao < 0 || posicao > 100)) {
      return res.status(400).json({ error: 'posicao do tema precisa ser de 0 a 100' });
    }
    patch.theme_position = posicao;
  }

  if (!Object.keys(patch).length) return res.status(400).json({ error: 'nada pra alterar' });

  for (const [column, value] of Object.entries(patch)) {
    q.run(`UPDATE users SET ${column} = ? WHERE id = ?`, value, req.user.id);
  }

  const updated = reload(req.user.id);
  broadcastUser(updated);
  return res.json({ user: selfUser(updated) });
});

/** Card de perfil de alguem: banner, descricao, desde quando esta por aqui. */
userRoutes.get('/:userId', (req, res) => {
  const { userId } = req.params;
  if (userId !== req.user.id && !sharesGuild(req.user.id, userId)) {
    return res.status(403).json({ error: 'voces nao dividem nenhum servidor' });
  }

  const user = reload(userId);
  if (!user) return res.status(404).json({ error: 'usuario nao encontrado' });

  // Servidores em comum, com o cargo que a pessoa tem em cada um.
  const shared = q.all(
    `SELECT g.id, g.name, gm.role FROM guild_members gm
     JOIN guilds g ON g.id = gm.guild_id
     WHERE gm.user_id = ?
       AND gm.guild_id IN (SELECT guild_id FROM guild_members WHERE user_id = ?)
     ORDER BY gm.joined_at`,
    userId, req.user.id,
  );

  return res.json({
    profile: { ...profileDto(user), sharedGuilds: shared, isSelf: userId === req.user.id },
  });
});

/** Erros do multer (arquivo grande demais) viram mensagem legivel. */
userRoutes.use((err, _req, res, next) => {
  if (err?.code === 'LIMIT_FILE_SIZE') {
    const mb = Math.round(config.maxAvatarBytes / (1024 * 1024));
    return res.status(413).json({ error: `arquivo passa de ${mb} MB` });
  }
  return next(err);
});
