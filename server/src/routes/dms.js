import { Router } from 'express';
import { q } from '../db.js';
import { requireAuth } from '../lib/auth.js';
import { newId } from '../lib/ids.js';
import { sharesGuild } from '../lib/permissions.js';
import { dmMessageDto, publicUser } from '../lib/serialize.js';

export const dmRoutes = Router();
dmRoutes.use(requireAuth);

/** true se o usuario faz parte dessa conversa. */
function dmChannelOf(dmChannelId, userId) {
  const row = q.get('SELECT * FROM dm_channels WHERE id = ?', dmChannelId);
  if (!row) return null;
  if (row.user_a_id !== userId && row.user_b_id !== userId) return null;
  return row;
}

const otherUserId = (dm, meId) => (dm.user_a_id === meId ? dm.user_b_id : dm.user_a_id);

/** Lista de conversas, ordenada pela mensagem mais recente (ou criacao, se nenhuma ainda). */
dmRoutes.get('/', (req, res) => {
  const meId = req.user.id;
  const rows = q.all(
    `SELECT dc.*,
       (SELECT content    FROM dm_messages WHERE dm_channel_id = dc.id ORDER BY id DESC LIMIT 1) AS last_content,
       (SELECT created_at FROM dm_messages WHERE dm_channel_id = dc.id ORDER BY id DESC LIMIT 1) AS last_created_at,
       (SELECT author_id  FROM dm_messages WHERE dm_channel_id = dc.id ORDER BY id DESC LIMIT 1) AS last_author_id
     FROM dm_channels dc
     WHERE dc.user_a_id = ? OR dc.user_b_id = ?
     ORDER BY COALESCE(last_created_at, dc.created_at) DESC`,
    meId, meId,
  );

  const conversations = rows.map((row) => {
    const other = q.get('SELECT * FROM users WHERE id = ?', otherUserId(row, meId));
    return {
      id: row.id,
      otherUser: publicUser(other),
      lastMessage: row.last_content == null ? null : {
        content: row.last_content,
        createdAt: row.last_created_at,
        authorId: row.last_author_id,
      },
    };
  }).filter((c) => c.otherUser); // usuario apagado (nao acontece hoje, mas por seguranca)

  res.json({ conversations });
});

/** Com quem dá pra abrir uma conversa nova: gente que divide algum servidor com voce. */
dmRoutes.get('/contatos', (req, res) => {
  const contatos = q.all(
    `SELECT DISTINCT u.* FROM users u
     JOIN guild_members gm ON gm.user_id = u.id
     WHERE u.id != ?
       AND gm.guild_id IN (SELECT guild_id FROM guild_members WHERE user_id = ?)
     ORDER BY u.username COLLATE NOCASE`,
    req.user.id, req.user.id,
  );
  res.json({ contatos: contatos.map(publicUser) });
});

/** Pega a conversa com alguem, criando se ainda nao existir. */
dmRoutes.post('/', (req, res) => {
  const otherId = String(req.body?.userId ?? '');
  if (!otherId || otherId === req.user.id) {
    return res.status(400).json({ error: 'usuario invalido' });
  }
  if (!sharesGuild(req.user.id, otherId)) {
    return res.status(403).json({ error: 'voces nao dividem nenhum servidor' });
  }

  const [a, b] = [req.user.id, otherId].sort();
  let row = q.get('SELECT * FROM dm_channels WHERE user_a_id = ? AND user_b_id = ?', a, b);
  if (!row) {
    row = { id: newId(), user_a_id: a, user_b_id: b, created_at: Date.now() };
    q.run(
      'INSERT INTO dm_channels (id, user_a_id, user_b_id, created_at) VALUES (?, ?, ?, ?)',
      row.id, a, b, row.created_at,
    );
  }

  const other = q.get('SELECT * FROM users WHERE id = ?', otherId);
  res.json({ conversation: { id: row.id, otherUser: publicUser(other), lastMessage: null } });
});

/**
 * Historico de uma conversa, paginado de tras pra frente:
 * GET /api/dms/:dmChannelId/messages?before=<messageId>&limit=50
 */
dmRoutes.get('/:dmChannelId/messages', (req, res) => {
  const { dmChannelId } = req.params;
  if (!dmChannelOf(dmChannelId, req.user.id)) {
    return res.status(404).json({ error: 'conversa nao encontrada' });
  }

  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
  const before = req.query.before ? String(req.query.before) : null;

  const rows = before
    ? q.all(
        `SELECT m.*, u.username, u.avatar_url, u.avatar_crop FROM dm_messages m
         JOIN users u ON u.id = m.author_id
         WHERE m.dm_channel_id = ? AND m.id < ?
         ORDER BY m.id DESC LIMIT ?`,
        dmChannelId, before, limit,
      )
    : q.all(
        `SELECT m.*, u.username, u.avatar_url, u.avatar_crop FROM dm_messages m
         JOIN users u ON u.id = m.author_id
         WHERE m.dm_channel_id = ?
         ORDER BY m.id DESC LIMIT ?`,
        dmChannelId, limit,
      );

  res.json({
    messages: rows.reverse().map(dmMessageDto),
    hasMore: rows.length === limit,
  });
});
