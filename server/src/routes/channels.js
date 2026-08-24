import { Router } from 'express';
import { q } from '../db.js';
import { requireAuth } from '../lib/auth.js';
import { guildIdOfChannel, isMember } from '../lib/permissions.js';
import { messageDto } from '../lib/serialize.js';

export const channelRoutes = Router();
channelRoutes.use(requireAuth);

/**
 * Historico de um canal, paginado de tras pra frente:
 * GET /api/channels/:channelId/messages?before=<messageId>&limit=50
 */
channelRoutes.get('/:channelId/messages', (req, res) => {
  const { channelId } = req.params;
  const guildId = guildIdOfChannel(channelId);
  if (!guildId) return res.status(404).json({ error: 'canal nao encontrado' });
  if (!isMember(guildId, req.user.id)) {
    return res.status(403).json({ error: 'voce nao e membro desse servidor' });
  }

  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
  const before = req.query.before ? String(req.query.before) : null;

  // Os IDs comecam com o timestamp em base36, entao a ordem lexicografica
  // do ID e a mesma ordem cronologica - da pra paginar sem JOIN extra.
  const rows = before
    ? q.all(
        `SELECT m.*, u.username, u.avatar_url, u.avatar_crop FROM messages m
         JOIN users u ON u.id = m.author_id
         WHERE m.channel_id = ? AND m.id < ?
         ORDER BY m.id DESC LIMIT ?`,
        channelId, before, limit,
      )
    : q.all(
        `SELECT m.*, u.username, u.avatar_url, u.avatar_crop FROM messages m
         JOIN users u ON u.id = m.author_id
         WHERE m.channel_id = ?
         ORDER BY m.id DESC LIMIT ?`,
        channelId, limit,
      );

  res.json({
    messages: rows.reverse().map(messageDto),
    hasMore: rows.length === limit,
  });
});

/** As mensagens fixadas do canal, mais recente primeiro. */
channelRoutes.get('/:channelId/pins', (req, res) => {
  const { channelId } = req.params;
  const guildId = guildIdOfChannel(channelId);
  if (!guildId) return res.status(404).json({ error: 'canal nao encontrado' });
  if (!isMember(guildId, req.user.id)) {
    return res.status(403).json({ error: 'voce nao e membro desse servidor' });
  }
  const rows = q.all(
    `SELECT m.*, u.username, u.handle, u.avatar_url, u.avatar_crop FROM messages m
     JOIN users u ON u.id = m.author_id
     WHERE m.channel_id = ? AND m.pinned_at IS NOT NULL
     ORDER BY m.pinned_at DESC LIMIT 50`,
    channelId,
  );
  res.json({ messages: rows.map(messageDto) });
});

/**
 * Busca dentro do canal. Simples de proposito: LIKE em cima do texto, que
 * pra um servidor de amigos resolve sem precisar de indice de texto completo.
 */
channelRoutes.get('/:channelId/search', (req, res) => {
  const { channelId } = req.params;
  const guildId = guildIdOfChannel(channelId);
  if (!guildId) return res.status(404).json({ error: 'canal nao encontrado' });
  if (!isMember(guildId, req.user.id)) {
    return res.status(403).json({ error: 'voce nao e membro desse servidor' });
  }
  const termo = String(req.query.q ?? '').trim();
  if (termo.length < 2) return res.json({ messages: [] });

  const rows = q.all(
    `SELECT m.*, u.username, u.handle, u.avatar_url, u.avatar_crop FROM messages m
     JOIN users u ON u.id = m.author_id
     WHERE m.channel_id = ? AND m.content LIKE ? ESCAPE '\\'
     ORDER BY m.id DESC LIMIT 50`,
    channelId, `%${termo.replace(/[\\%_]/g, (c) => `\\${c}`)}%`,
  );
  res.json({ messages: rows.map(messageDto) });
});
