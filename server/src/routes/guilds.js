import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { config } from '../config.js';
import { q, tx } from '../db.js';
import { ACAO, listar as listarAuditoria, registrar } from '../lib/auditoria.js';
import { requireAuth } from '../lib/auth.js';
import { emitToGuild, getIo } from '../lib/bus.js';
import { newId, newInviteCode } from '../lib/ids.js';
import { parseCrop, removeFile, sniffImage } from '../lib/images.js';
import {
  can, hasRole, highestPosition, membership, podeAgirSobre, requirePerm, requireRole,
  rolesOf, PERM, PERMISSOES_PADRAO,
} from '../lib/permissions.js';
import { channelDto, guildDetail, guildSummary } from '../lib/serialize.js';
import { dropVoiceRoom } from '../voice.js';

export const guildRoutes = Router();
guildRoutes.use(requireAuth);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxAvatarBytes, files: 1 },
});

/**
 * Nome de alguem pra guardar no historico.
 *
 * O historico grava o nome junto do id de proposito (ver auditoria.js): quem
 * sai do servidor continua aparecendo no que fez.
 */
const nomeDe = (userId) => q.get('SELECT username FROM users WHERE id = ?', userId)?.username ?? userId;

/** Só aceita cor em #rrggbb; qualquer outra coisa vira "sem cor". */
function corValida(bruto) {
  const cor = String(bruto ?? '').trim();
  return /^#[0-9a-fA-F]{6}$/.test(cor) ? cor.toLowerCase() : null;
}

/** Servidores dos quais eu sou membro. */
guildRoutes.get('/', (req, res) => {
  const rows = q.all(
    `SELECT g.*, gm.role FROM guild_members gm
     JOIN guilds g ON g.id = gm.guild_id
     WHERE gm.user_id = ?
     ORDER BY gm.joined_at`,
    req.user.id,
  );
  res.json({ guilds: rows.map(guildSummary) });
});

/** Cria um servidor novo, ja com um canal de texto e um de voz. */
guildRoutes.post('/', (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  if (name.length < 2 || name.length > 64) {
    return res.status(400).json({ error: 'nome do servidor precisa ter de 2 a 64 caracteres' });
  }
  const isPublic = req.body?.isPublic ? 1 : 0;
  const now = Date.now();
  const guildId = newId();

  tx(() => {
    q.run(
      'INSERT INTO guilds (id, name, icon_url, owner_id, is_public, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      guildId, name, null, req.user.id, isPublic, now,
    );
    q.run(
      'INSERT INTO guild_members (guild_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)',
      guildId, req.user.id, 'owner', now,
    );
    // @everyone e a base de tudo: as permissoes de qualquer membro comecam
    // nele e sao ajustadas por cargos e overrides por cima.
    q.run(
      `INSERT INTO roles (id, guild_id, name, color, position, permissions, is_default, created_at)
       VALUES (?, ?, '@everyone', NULL, 0, ?, 1, ?)`,
      newId(), guildId, PERMISSOES_PADRAO, now,
    );
    q.run(
      'INSERT INTO channels (id, guild_id, name, type, position, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      newId(), guildId, 'geral', 'text', 0, now,
    );
    // O canal de voz ja nasce aqui; ele so ganha audio de verdade na Etapa 3.
    q.run(
      'INSERT INTO channels (id, guild_id, name, type, position, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      newId(), guildId, 'Sala de voz', 'voice', 0, now,
    );
  });

  res.status(201).json({ guild: guildDetail(guildId, req.user.id) });
});

/** Detalhe do servidor: canais + membros. */
guildRoutes.get('/:guildId', (req, res) => {
  if (!membership(req.params.guildId, req.user.id)) {
    return res.status(403).json({ error: 'voce nao e membro desse servidor' });
  }
  const guild = guildDetail(req.params.guildId, req.user.id);
  if (!guild) return res.status(404).json({ error: 'servidor nao encontrado' });
  res.json({ guild });
});

/** Renomear o servidor, mudar a descrição ou se ele é público (pra convites). */
guildRoutes.patch('/:guildId', requirePerm(PERM.GERENCIAR_SERVIDOR), (req, res) => {
  const { guildId } = req.params;
  const patch = {};

  if (req.body?.name !== undefined) {
    const name = String(req.body.name).trim();
    if (name.length < 2 || name.length > 64) {
      return res.status(400).json({ error: 'nome do servidor precisa ter de 2 a 64 caracteres' });
    }
    patch.name = name;
  }

  if (req.body?.description !== undefined) {
    const description = String(req.body.description).trim();
    if (description.length > 300) {
      return res.status(400).json({ error: 'a descricao passa de 300 caracteres' });
    }
    patch.description = description || null;
  }

  if (req.body?.isPublic !== undefined) {
    patch.is_public = req.body.isPublic ? 1 : 0;
  }

  if (!Object.keys(patch).length) return res.status(400).json({ error: 'nada pra alterar' });

  for (const [column, value] of Object.entries(patch)) {
    q.run(`UPDATE guilds SET ${column} = ? WHERE id = ?`, value, guildId);
  }

  const guild = guildDetail(guildId, req.user.id);
  registrar(guildId, req.user, ACAO.SERVIDOR_ATUALIZADO, {
    detalhe: Object.keys(patch).map((c) => ({
      name: 'nome', description: 'descrição', is_public: 'visibilidade',
    }[c] ?? c)).join(', '),
  });
  emitToGuild(guildId, 'guild:updated', guild);
  res.json({ guild });
});

/** Ícone do servidor: mesma regra do avatar de usuário (ver lib/images.js). */
guildRoutes.post('/:guildId/icon', requirePerm(PERM.GERENCIAR_SERVIDOR), upload.single('file'), (req, res) => {
  const { guildId } = req.params;
  if (!req.file) return res.status(400).json({ error: 'nenhum arquivo enviado' });

  const kind = sniffImage(req.file.buffer);
  if (!kind) {
    return res.status(400).json({ error: 'formato nao suportado (use png, jpg, webp ou gif)' });
  }

  const crop = parseCrop(req.body?.crop);
  if (kind.animated && !crop) {
    return res.status(400).json({ error: 'imagem animada precisa vir com os dados do recorte' });
  }

  const anterior = q.get('SELECT icon_url FROM guilds WHERE id = ?', guildId);
  const filename = `${guildId}-${crypto.randomBytes(8).toString('hex')}.${kind.ext}`;
  fs.writeFileSync(path.join(config.uploadsDir, filename), req.file.buffer);
  removeFile(anterior?.icon_url);

  q.run(
    'UPDATE guilds SET icon_url = ?, icon_crop = ? WHERE id = ?',
    `/uploads/${filename}`, kind.animated ? JSON.stringify(crop) : null, guildId,
  );

  const guild = guildDetail(guildId, req.user.id);
  emitToGuild(guildId, 'guild:updated', guild);
  res.json({ guild });
});

guildRoutes.delete('/:guildId/icon', requirePerm(PERM.GERENCIAR_SERVIDOR), (req, res) => {
  const { guildId } = req.params;
  const anterior = q.get('SELECT icon_url FROM guilds WHERE id = ?', guildId);
  removeFile(anterior?.icon_url);
  q.run('UPDATE guilds SET icon_url = NULL, icon_crop = NULL WHERE id = ?', guildId);

  const guild = guildDetail(guildId, req.user.id);
  emitToGuild(guildId, 'guild:updated', guild);
  res.json({ guild });
});

/** Erros do multer (arquivo grande demais) viram mensagem legivel. */
guildRoutes.use((err, _req, res, next) => {
  if (err?.code === 'LIMIT_FILE_SIZE') {
    const mb = Math.round(config.maxAvatarBytes / (1024 * 1024));
    return res.status(413).json({ error: `arquivo passa de ${mb} MB` });
  }
  return next(err);
});

/* -------------------------------- canais -------------------------------- */

guildRoutes.post('/:guildId/channels', requireRole('admin'), (req, res) => {
  const { guildId } = req.params;
  const name = String(req.body?.name ?? '').trim().replace(/\s+/g, ' ');
  const type = req.body?.type === 'voice' ? 'voice' : 'text';
  if (name.length < 1 || name.length > 48) {
    return res.status(400).json({ error: 'nome do canal precisa ter de 1 a 48 caracteres' });
  }

  const position = q.get(
    'SELECT COALESCE(MAX(position), -1) + 1 AS next FROM channels WHERE guild_id = ? AND type = ?',
    guildId, type,
  ).next;

  const channel = { id: newId(), guild_id: guildId, name, type, position, created_at: Date.now() };
  q.run(
    'INSERT INTO channels (id, guild_id, name, type, position, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    channel.id, guildId, name, type, position, channel.created_at,
  );

  const dto = channelDto(channel);
  registrar(guildId, req.user, ACAO.CANAL_CRIADO, {
    alvo: channel.id, alvoLabel: name, detalhe: type === 'voice' ? 'canal de voz' : 'canal de texto',
  });
  emitToGuild(guildId, 'channel:created', dto);
  res.status(201).json({ channel: dto });
});

/**
 * Reordenar canais (arrastando na barra lateral).
 *
 * Recebe a ORDEM INTEIRA de uma vez, e não "o canal X foi pro lugar 3": a
 * lista toda chega como o cliente quer que ela fique, e aqui só se reescreve
 * position de cima pra baixo. Isso deixa o resultado igual mesmo se dois
 * pedidos chegarem juntos - o último a gravar vence e a lista continua
 * coerente, em vez de ficar com dois canais na mesma posição.
 *
 * `categoryId` vem junto porque arrastar pra dentro de uma categoria é a
 * mesma gesto - separar em duas rotas obrigaria o cliente a mandar dois
 * pedidos pra um arrasto só.
 */
guildRoutes.patch('/:guildId/channels-ordem', requirePerm(PERM.GERENCIAR_CANAIS), (req, res) => {
  const { guildId } = req.params;
  const ordem = Array.isArray(req.body?.ordem) ? req.body.ordem : null;
  if (!ordem) return res.status(400).json({ error: 'ordem precisa ser uma lista' });

  const doServidor = new Set(
    q.all('SELECT id FROM channels WHERE guild_id = ?', guildId).map((c) => c.id),
  );
  const categorias = new Set(
    q.all('SELECT id FROM categories WHERE guild_id = ?', guildId).map((c) => c.id),
  );

  tx(() => {
    ordem.forEach((item, i) => {
      const id = String(item?.id ?? '');
      // Ignora id de fora deste servidor: sem isso daria pra reordenar (ou
      // sequestrar pra uma categoria daqui) canal de um servidor alheio.
      if (!doServidor.has(id)) return;
      const bruta = item?.categoryId == null ? null : String(item.categoryId);
      const categoryId = bruta && categorias.has(bruta) ? bruta : null;
      q.run('UPDATE channels SET position = ?, category_id = ? WHERE id = ?', i, categoryId, id);
    });
  });

  const guild = guildDetail(guildId, req.user.id);
  emitToGuild(guildId, 'guild:updated', guild);
  res.json({ guild });
});

/** Renomear canal, mudar o assunto do topo ou movê-lo de categoria. */
guildRoutes.patch('/:guildId/channels/:channelId', requirePerm(PERM.GERENCIAR_CANAIS), (req, res) => {
  const { guildId, channelId } = req.params;
  const channel = q.get('SELECT * FROM channels WHERE id = ? AND guild_id = ?', channelId, guildId);
  if (!channel) return res.status(404).json({ error: 'canal nao encontrado' });

  const name = req.body?.name === undefined
    ? channel.name : String(req.body.name).trim().replace(/\s+/g, ' ').slice(0, 48);
  const topic = req.body?.topic === undefined
    ? channel.topic : (String(req.body.topic).trim().slice(0, 200) || null);
  const categoryId = req.body?.categoryId === undefined
    ? channel.category_id : (String(req.body.categoryId || '') || null);

  if (!name) return res.status(400).json({ error: 'nome do canal nao pode ficar vazio' });

  q.run(
    'UPDATE channels SET name = ?, topic = ?, category_id = ? WHERE id = ?',
    name, topic, categoryId, channelId,
  );
  const dto = channelDto(q.get('SELECT * FROM channels WHERE id = ?', channelId));
  emitToGuild(guildId, 'channel:updated', dto);
  res.json({ channel: dto });
});

/* ------------------------------ categorias ------------------------------ */

guildRoutes.post('/:guildId/categories', requirePerm(PERM.GERENCIAR_CANAIS), (req, res) => {
  const { guildId } = req.params;
  const name = String(req.body?.name ?? '').trim().slice(0, 48);
  if (!name) return res.status(400).json({ error: 'nome da categoria nao pode ficar vazio' });

  const position = q.get(
    'SELECT COALESCE(MAX(position), -1) + 1 AS next FROM categories WHERE guild_id = ?', guildId,
  ).next;
  const category = { id: newId(), name, position };
  q.run(
    'INSERT INTO categories (id, guild_id, name, position, created_at) VALUES (?, ?, ?, ?, ?)',
    category.id, guildId, name, position, Date.now(),
  );
  emitToGuild(guildId, 'category:created', { guildId, category });
  res.status(201).json({ category });
});

guildRoutes.delete('/:guildId/categories/:categoryId', requirePerm(PERM.GERENCIAR_CANAIS), (req, res) => {
  const { guildId, categoryId } = req.params;
  // Os canais de dentro não somem junto: voltam a ficar soltos no topo.
  tx(() => {
    q.run('UPDATE channels SET category_id = NULL WHERE category_id = ?', categoryId);
    q.run('DELETE FROM categories WHERE id = ? AND guild_id = ?', categoryId, guildId);
  });
  emitToGuild(guildId, 'category:deleted', { guildId, categoryId });
  res.json({ ok: true });
});

/* ------------------- permissoes especificas de um canal ------------------ */

guildRoutes.put('/:guildId/channels/:channelId/overwrites', requirePerm(PERM.GERENCIAR_CANAIS), (req, res) => {
  const { guildId, channelId } = req.params;
  if (!q.get('SELECT 1 FROM channels WHERE id = ? AND guild_id = ?', channelId, guildId)) {
    return res.status(404).json({ error: 'canal nao encontrado' });
  }
  const targetType = req.body?.targetType === 'user' ? 'user' : 'role';
  const targetId = String(req.body?.targetId ?? '');
  const allow = Number(req.body?.allow) || 0;
  const deny = Number(req.body?.deny) || 0;
  if (!targetId) return res.status(400).json({ error: 'targetId ausente' });

  if (allow === 0 && deny === 0) {
    q.run(
      'DELETE FROM channel_overwrites WHERE channel_id = ? AND target_id = ? AND target_type = ?',
      channelId, targetId, targetType,
    );
  } else {
    q.run(
      `INSERT OR REPLACE INTO channel_overwrites (channel_id, target_id, target_type, allow, deny)
       VALUES (?, ?, ?, ?, ?)`,
      channelId, targetId, targetType, allow, deny,
    );
  }
  emitToGuild(guildId, 'channel:overwrites', { guildId, channelId });
  res.json({ ok: true });
});

guildRoutes.get('/:guildId/channels/:channelId/overwrites', requirePerm(PERM.GERENCIAR_CANAIS), (req, res) => {
  const rows = q.all('SELECT * FROM channel_overwrites WHERE channel_id = ?', req.params.channelId);
  res.json({
    overwrites: rows.map((o) => ({
      targetId: o.target_id, targetType: o.target_type, allow: o.allow, deny: o.deny,
    })),
  });
});

guildRoutes.delete('/:guildId/channels/:channelId', requireRole('admin'), (req, res) => {
  const { guildId, channelId } = req.params;
  const channel = q.get('SELECT * FROM channels WHERE id = ? AND guild_id = ?', channelId, guildId);
  if (!channel) return res.status(404).json({ error: 'canal nao encontrado' });

  const textChannels = q.get(
    'SELECT COUNT(*) AS n FROM channels WHERE guild_id = ? AND type = ?', guildId, 'text',
  ).n;
  if (channel.type === 'text' && textChannels <= 1) {
    return res.status(400).json({ error: 'o servidor precisa ter pelo menos um canal de texto' });
  }

  q.run('DELETE FROM channels WHERE id = ?', channelId);
  if (channel.type === 'voice') dropVoiceRoom(getIo(), channelId, guildId);
  registrar(guildId, req.user, ACAO.CANAL_APAGADO, { alvo: channelId, alvoLabel: channel.name });
  emitToGuild(guildId, 'channel:deleted', { id: channelId, guildId });
  res.json({ ok: true });
});

/* ------------------------------- convites ------------------------------- */

guildRoutes.post('/:guildId/invites', requireRole('admin'), (req, res) => {
  const { guildId } = req.params;
  const maxUses = Number.isInteger(req.body?.maxUses) ? req.body.maxUses : null;
  const expiresInHours = Number(req.body?.expiresInHours) || null;

  const code = newInviteCode();
  q.run(
    `INSERT INTO invites (code, guild_id, created_by, uses, max_uses, expires_at, created_at)
     VALUES (?, ?, ?, 0, ?, ?, ?)`,
    code, guildId, req.user.id, maxUses,
    expiresInHours ? Date.now() + expiresInHours * 3600000 : null,
    Date.now(),
  );
  registrar(guildId, req.user, ACAO.CONVITE_CRIADO, {
    alvo: code,
    alvoLabel: code,
    detalhe: [
      maxUses ? `${maxUses} usos` : 'usos ilimitados',
      expiresInHours ? `expira em ${expiresInHours}h` : 'nunca expira',
    ].join(', '),
  });
  res.status(201).json({ invite: { code, guildId, maxUses, expiresInHours } });
});

guildRoutes.get('/:guildId/invites', requireRole('admin'), (req, res) => {
  const rows = q.all(
    'SELECT * FROM invites WHERE guild_id = ? ORDER BY created_at DESC',
    req.params.guildId,
  );
  res.json({
    invites: rows.map((i) => ({
      code: i.code, uses: i.uses, maxUses: i.max_uses, expiresAt: i.expires_at,
    })),
  });
});

guildRoutes.delete('/:guildId/invites/:code', requireRole('admin'), (req, res) => {
  const { guildId, code } = req.params;
  const alvo = code.toUpperCase();
  const removeu = q.run('DELETE FROM invites WHERE guild_id = ? AND code = ?', guildId, alvo).changes;
  if (removeu) registrar(guildId, req.user, ACAO.CONVITE_APAGADO, { alvo, alvoLabel: alvo });
  res.json({ ok: true });
});

/**
 * Quantas mensagens não lidas em cada canal do servidor.
 *
 * Sai da marca de leitura (read_state) em vez de guardar um contador: assim a
 * conta continua certa mesmo se a pessoa ficar dias sem abrir o app, e não
 * existe contador pra dessincronizar.
 */
guildRoutes.get('/:guildId/unread', (req, res) => {
  const { guildId } = req.params;
  if (!membership(guildId, req.user.id)) {
    return res.status(403).json({ error: 'voce nao e membro desse servidor' });
  }
  // Sem marca de leitura, o corte é a data em que a pessoa entrou no
  // servidor - senão quem acabou de entrar veria o histórico inteiro como
  // não lido logo de cara.
  const desde = membership(guildId, req.user.id).joined_at;
  const linhas = q.all(
    `SELECT c.id AS channel_id, COUNT(m.id) AS nao_lidas
     FROM channels c
     LEFT JOIN read_state r ON r.channel_id = c.id AND r.user_id = ?
     LEFT JOIN messages m ON m.channel_id = c.id
          AND m.author_id != ?
          AND m.created_at > COALESCE(r.last_read_at, ?)
     WHERE c.guild_id = ? AND c.type = 'text'
     GROUP BY c.id`,
    req.user.id, req.user.id, desde, guildId,
  );
  res.json({
    unread: Object.fromEntries(
      linhas.filter((l) => l.nao_lidas > 0).map((l) => [l.channel_id, l.nao_lidas]),
    ),
  });
});

/* -------------------------------- membros -------------------------------- */

guildRoutes.patch('/:guildId/members/:userId', requireRole('owner'), (req, res) => {
  const { guildId, userId } = req.params;
  const role = req.body?.role;
  if (role !== 'admin' && role !== 'member') {
    return res.status(400).json({ error: 'cargo precisa ser admin ou member' });
  }
  if (userId === req.user.id) {
    return res.status(400).json({ error: 'o dono nao pode mudar o proprio cargo' });
  }
  const changed = q.run(
    'UPDATE guild_members SET role = ? WHERE guild_id = ? AND user_id = ? AND role != ?',
    role, guildId, userId, 'owner',
  ).changes;
  if (!changed) return res.status(404).json({ error: 'membro nao encontrado' });

  registrar(guildId, req.user, ACAO.MEMBRO_CARGO, {
    alvo: userId, alvoLabel: nomeDe(userId), detalhe: role === 'admin' ? 'promovido a admin' : 'rebaixado a membro',
  });
  emitToGuild(guildId, 'member:updated', { guildId, userId, role });
  res.json({ ok: true });
});

/** Apelido: dá pra mudar o próprio sempre; o dos outros exige permissão. */
guildRoutes.patch('/:guildId/members/:userId/nickname', (req, res) => {
  const { guildId, userId } = req.params;
  if (!membership(guildId, userId)) return res.status(404).json({ error: 'membro nao encontrado' });

  const meuProprio = userId === req.user.id;
  if (!meuProprio && !can(guildId, req.user.id, PERM.GERENCIAR_APELIDOS)) {
    return res.status(403).json({ error: 'permissao insuficiente' });
  }
  if (!meuProprio && !podeAgirSobre(guildId, req.user.id, userId)) {
    return res.status(403).json({ error: 'essa pessoa esta acima de voce na hierarquia' });
  }

  const bruto = String(req.body?.nickname ?? '').trim();
  if (bruto.length > 32) return res.status(400).json({ error: 'apelido passa de 32 caracteres' });
  const nickname = bruto || null;

  q.run('UPDATE guild_members SET nickname = ? WHERE guild_id = ? AND user_id = ?', nickname, guildId, userId);
  emitToGuild(guildId, 'member:updated', { guildId, userId, nickname });
  res.json({ ok: true, nickname });
});

/** Castigo temporário: a pessoa continua no servidor mas não fala nem entra em call. */
guildRoutes.post('/:guildId/members/:userId/timeout', requirePerm(PERM.SILENCIAR_MEMBROS), (req, res) => {
  const { guildId, userId } = req.params;
  if (!podeAgirSobre(guildId, req.user.id, userId)) {
    return res.status(403).json({ error: 'nao da pra castigar essa pessoa' });
  }
  const minutos = Number(req.body?.minutos);
  if (!Number.isFinite(minutos) || minutos < 0 || minutos > 60 * 24 * 28) {
    return res.status(400).json({ error: 'duracao invalida' });
  }
  const ate = minutos > 0 ? Date.now() + minutos * 60000 : null;
  q.run('UPDATE guild_members SET timeout_until = ? WHERE guild_id = ? AND user_id = ?', ate, guildId, userId);
  registrar(guildId, req.user, ACAO.MEMBRO_CASTIGO, {
    alvo: userId,
    alvoLabel: nomeDe(userId),
    detalhe: minutos > 0 ? `${minutos} min` : 'castigo retirado',
  });
  emitToGuild(guildId, 'member:updated', { guildId, userId, timeoutUntil: ate });
  res.json({ ok: true, timeoutUntil: ate });
});

/** Banir = expulsar e impedir de entrar de novo pelo convite. */
guildRoutes.post('/:guildId/bans/:userId', requirePerm(PERM.BANIR), (req, res) => {
  const { guildId, userId } = req.params;
  if (!podeAgirSobre(guildId, req.user.id, userId)) {
    return res.status(403).json({ error: 'nao da pra banir essa pessoa' });
  }
  const reason = String(req.body?.reason ?? '').trim().slice(0, 200) || null;
  tx(() => {
    q.run(
      `INSERT OR REPLACE INTO guild_bans (guild_id, user_id, reason, banned_by, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      guildId, userId, reason, req.user.id, Date.now(),
    );
    q.run('DELETE FROM guild_members WHERE guild_id = ? AND user_id = ?', guildId, userId);
  });
  registrar(guildId, req.user, ACAO.MEMBRO_BANIDO, {
    alvo: userId, alvoLabel: nomeDe(userId), detalhe: reason,
  });
  emitToGuild(guildId, 'member:left', { guildId, userId });
  getIo()?.to(`user:${userId}`).emit('guild:banned', { guildId });
  res.json({ ok: true });
});

guildRoutes.delete('/:guildId/bans/:userId', requirePerm(PERM.BANIR), (req, res) => {
  const { guildId, userId } = req.params;
  const removeu = q.run('DELETE FROM guild_bans WHERE guild_id = ? AND user_id = ?', guildId, userId).changes;
  if (removeu) {
    registrar(guildId, req.user, ACAO.MEMBRO_DESBANIDO, { alvo: userId, alvoLabel: nomeDe(userId) });
  }
  res.json({ ok: true });
});

guildRoutes.get('/:guildId/bans', requirePerm(PERM.BANIR), (req, res) => {
  const rows = q.all(
    `SELECT b.*, u.username, a.username AS por_quem
       FROM guild_bans b
       JOIN users u ON u.id = b.user_id
       LEFT JOIN users a ON a.id = b.banned_by
      WHERE b.guild_id = ? ORDER BY b.created_at DESC`,
    req.params.guildId,
  );
  res.json({
    bans: rows.map((b) => ({
      userId: b.user_id,
      username: b.username,
      reason: b.reason,
      bannedBy: b.por_quem ?? null,
      createdAt: b.created_at,
    })),
  });
});

/* ---------------------------- registro de auditoria ---------------------- */

guildRoutes.get('/:guildId/audit', requirePerm(PERM.GERENCIAR_SERVIDOR), (req, res) => {
  res.json({ entradas: listarAuditoria(req.params.guildId, 150) });
});

/* --------------------------------- cargos -------------------------------- */

const roleDto = (r) => ({
  id: r.id, name: r.name, color: r.color, position: r.position,
  permissions: r.permissions, isDefault: Boolean(r.is_default),
});

guildRoutes.get('/:guildId/roles', (req, res) => {
  if (!membership(req.params.guildId, req.user.id)) {
    return res.status(403).json({ error: 'voce nao e membro desse servidor' });
  }
  const rows = q.all('SELECT * FROM roles WHERE guild_id = ? ORDER BY position DESC', req.params.guildId);
  res.json({ roles: rows.map(roleDto) });
});

guildRoutes.post('/:guildId/roles', requirePerm(PERM.GERENCIAR_CARGOS), (req, res) => {
  const { guildId } = req.params;
  const name = String(req.body?.name ?? '').trim();
  if (name.length < 1 || name.length > 32) {
    return res.status(400).json({ error: 'nome do cargo precisa ter de 1 a 32 caracteres' });
  }
  const color = corValida(req.body?.color);
  const permissions = Number(req.body?.permissions) || 0;

  const position = q.get(
    'SELECT COALESCE(MAX(position), 0) + 1 AS next FROM roles WHERE guild_id = ?', guildId,
  ).next;

  const role = {
    id: newId(), guild_id: guildId, name, color, position, permissions,
    is_default: 0, created_at: Date.now(),
  };
  q.run(
    `INSERT INTO roles (id, guild_id, name, color, position, permissions, is_default, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
    role.id, guildId, name, color, position, permissions, role.created_at,
  );
  registrar(guildId, req.user, ACAO.CARGO_CRIADO, { alvo: role.id, alvoLabel: name });
  emitToGuild(guildId, 'role:updated', { guildId, role: roleDto(role) });
  res.status(201).json({ role: roleDto(role) });
});

guildRoutes.patch('/:guildId/roles/:roleId', requirePerm(PERM.GERENCIAR_CARGOS), (req, res) => {
  const { guildId, roleId } = req.params;
  const role = q.get('SELECT * FROM roles WHERE id = ? AND guild_id = ?', roleId, guildId);
  if (!role) return res.status(404).json({ error: 'cargo nao encontrado' });

  // Ninguem edita um cargo igual ou acima do proprio - senao daria pra se
  // promover editando o cargo de quem esta em cima.
  if (!role.is_default && highestPosition(guildId, req.user.id) <= role.position) {
    return res.status(403).json({ error: 'esse cargo esta acima de voce' });
  }

  const name = req.body?.name === undefined ? role.name : String(req.body.name).trim().slice(0, 32);
  const color = req.body?.color === undefined ? role.color : corValida(req.body.color);
  const permissions = req.body?.permissions === undefined
    ? role.permissions : (Number(req.body.permissions) || 0);
  // O @everyone e a base de todo mundo; deixar ele virar administrador
  // transformaria o servidor inteiro em dono.
  const limpas = role.is_default ? (permissions & ~PERM.ADMINISTRADOR) : permissions;

  q.run(
    'UPDATE roles SET name = ?, color = ?, permissions = ? WHERE id = ?',
    name || role.name, color, limpas, roleId,
  );
  const atualizado = q.get('SELECT * FROM roles WHERE id = ?', roleId);
  registrar(guildId, req.user, ACAO.CARGO_ATUALIZADO, { alvo: roleId, alvoLabel: atualizado.name });
  emitToGuild(guildId, 'role:updated', { guildId, role: roleDto(atualizado) });
  res.json({ role: roleDto(atualizado) });
});

guildRoutes.delete('/:guildId/roles/:roleId', requirePerm(PERM.GERENCIAR_CARGOS), (req, res) => {
  const { guildId, roleId } = req.params;
  const role = q.get('SELECT * FROM roles WHERE id = ? AND guild_id = ?', roleId, guildId);
  if (!role) return res.status(404).json({ error: 'cargo nao encontrado' });
  if (role.is_default) return res.status(400).json({ error: 'o @everyone nao pode ser apagado' });
  if (highestPosition(guildId, req.user.id) <= role.position) {
    return res.status(403).json({ error: 'esse cargo esta acima de voce' });
  }

  q.run('DELETE FROM roles WHERE id = ?', roleId);
  registrar(guildId, req.user, ACAO.CARGO_APAGADO, { alvo: roleId, alvoLabel: role.name });
  emitToGuild(guildId, 'role:deleted', { guildId, roleId });
  res.json({ ok: true });
});

/** Dar/tirar cargo de alguem. */
guildRoutes.put('/:guildId/members/:userId/roles/:roleId', requirePerm(PERM.GERENCIAR_CARGOS), (req, res) => {
  const { guildId, userId, roleId } = req.params;
  const role = q.get('SELECT * FROM roles WHERE id = ? AND guild_id = ?', roleId, guildId);
  if (!role || !membership(guildId, userId)) return res.status(404).json({ error: 'nao encontrado' });
  if (highestPosition(guildId, req.user.id) <= role.position) {
    return res.status(403).json({ error: 'esse cargo esta acima de voce' });
  }
  q.run(
    'INSERT OR IGNORE INTO member_roles (guild_id, user_id, role_id) VALUES (?, ?, ?)',
    guildId, userId, roleId,
  );
  emitToGuild(guildId, 'member:updated', {
    guildId, userId, roles: rolesOf(guildId, userId).map((r) => r.id),
  });
  res.json({ ok: true });
});

guildRoutes.delete('/:guildId/members/:userId/roles/:roleId', requirePerm(PERM.GERENCIAR_CARGOS), (req, res) => {
  const { guildId, userId, roleId } = req.params;
  const role = q.get('SELECT * FROM roles WHERE id = ? AND guild_id = ?', roleId, guildId);
  if (!role) return res.status(404).json({ error: 'cargo nao encontrado' });
  if (highestPosition(guildId, req.user.id) <= role.position) {
    return res.status(403).json({ error: 'esse cargo esta acima de voce' });
  }
  q.run(
    'DELETE FROM member_roles WHERE guild_id = ? AND user_id = ? AND role_id = ?',
    guildId, userId, roleId,
  );
  emitToGuild(guildId, 'member:updated', {
    guildId, userId, roles: rolesOf(guildId, userId).map((r) => r.id),
  });
  res.json({ ok: true });
});

/** Expulsar alguem (admin+) ou sair do servidor por conta propria. */
guildRoutes.delete('/:guildId/members/:userId', (req, res) => {
  const { guildId, userId } = req.params;
  const target = membership(guildId, userId);
  if (!target) return res.status(404).json({ error: 'membro nao encontrado' });

  const leavingMyself = userId === req.user.id;
  if (!leavingMyself && !hasRole(guildId, req.user.id, 'admin')) {
    return res.status(403).json({ error: 'permissao insuficiente' });
  }
  if (target.role === 'owner') {
    return res.status(400).json({ error: 'o dono nao pode sair nem ser expulso' });
  }

  q.run('DELETE FROM guild_members WHERE guild_id = ? AND user_id = ?', guildId, userId);
  // Sair por conta própria não é ação de moderação - só expulsão vira registro.
  if (!leavingMyself) {
    registrar(guildId, req.user, ACAO.MEMBRO_EXPULSO, { alvo: userId, alvoLabel: nomeDe(userId) });
  }
  emitToGuild(guildId, 'member:left', { guildId, userId });
  res.json({ ok: true });
});

/**
 * Excluir o servidor inteiro. Só o dono, e sem volta.
 *
 * Apaga as tabelas na mão em vez de contar com o ON DELETE CASCADE do
 * schema: o banco roda sem `PRAGMA foreign_keys = ON`, então as cascatas
 * declaradas lá são decorativas - confiar nelas deixaria mensagem, reação e
 * marca de leitura órfãs no banco pra sempre. Ligar o pragma resolveria no
 * papel, mas num banco que já rodou tempo sem ele qualquer violação antiga
 * viraria erro em produção; apagar explicitamente é o caminho sem surpresa.
 *
 * Tudo numa transação só: ou some inteiro, ou não some nada.
 */
guildRoutes.delete('/:guildId', requireRole('owner'), (req, res) => {
  const { guildId } = req.params;
  const guild = q.get('SELECT * FROM guilds WHERE id = ?', guildId);
  if (!guild) return res.status(404).json({ error: 'servidor nao encontrado' });

  const canais = q.all('SELECT id FROM channels WHERE guild_id = ?', guildId).map((c) => c.id);
  const membros = q.all('SELECT user_id FROM guild_members WHERE guild_id = ?', guildId)
    .map((m) => m.user_id);

  tx(() => {
    for (const canalId of canais) {
      // As reações apontam pro id da mensagem, não pro canal - por isso
      // precisam sair antes das mensagens, enquanto ainda dá pra achá-las.
      q.run(
        'DELETE FROM message_reactions WHERE message_id IN (SELECT id FROM messages WHERE channel_id = ?)',
        canalId,
      );
      q.run('DELETE FROM messages WHERE channel_id = ?', canalId);
      q.run('DELETE FROM channel_overwrites WHERE channel_id = ?', canalId);
      q.run('DELETE FROM read_state WHERE channel_id = ?', canalId);
      q.run("DELETE FROM notification_settings WHERE scope_type = 'channel' AND scope_id = ?", canalId);
    }
    q.run("DELETE FROM notification_settings WHERE scope_type = 'guild' AND scope_id = ?", guildId);
    q.run('DELETE FROM channels WHERE guild_id = ?', guildId);
    q.run('DELETE FROM categories WHERE guild_id = ?', guildId);
    q.run('DELETE FROM member_roles WHERE guild_id = ?', guildId);
    q.run('DELETE FROM roles WHERE guild_id = ?', guildId);
    q.run('DELETE FROM guild_members WHERE guild_id = ?', guildId);
    q.run('DELETE FROM invites WHERE guild_id = ?', guildId);
    q.run('DELETE FROM guild_bans WHERE guild_id = ?', guildId);
    q.run('DELETE FROM audit_log WHERE guild_id = ?', guildId);
    q.run('DELETE FROM guilds WHERE id = ?', guildId);
  });

  // Só depois que o banco confirmou: derruba as calls e avisa todo mundo.
  const io = getIo();
  for (const canalId of canais) dropVoiceRoom(io, canalId, guildId);
  if (guild.icon_url) removeFile(guild.icon_url);

  for (const userId of membros) io?.to(`user:${userId}`).emit('guild:deleted', { guildId });

  res.json({ ok: true });
});
