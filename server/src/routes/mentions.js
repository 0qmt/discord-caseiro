import { Router } from 'express';
import { requireAuth } from '../lib/auth.js';
import { getIo } from '../lib/bus.js';
import { guildIdOfChannel, isMember } from '../lib/permissions.js';
import { q } from '../db.js';

export const mentionRoutes = Router();
mentionRoutes.use(requireAuth);

/** Menções pendentes de todos os servidores do usuário, agrupadas por canal. */
mentionRoutes.get('/unread', (req, res) => {
  const rows = q.all(
    `SELECT guild_id, channel_id, COUNT(*) AS count
     FROM message_mentions
     WHERE user_id = ? AND read_at IS NULL
     GROUP BY guild_id, channel_id`,
    req.user.id,
  );
  res.json({
    mentions: Object.fromEntries(rows.map((row) => [row.channel_id, {
      guildId: row.guild_id,
      count: row.count,
    }])),
  });
});

/** Limpa apenas as menções do canal escolhido; foco de janela não chama isto. */
mentionRoutes.post('/channels/:channelId/read', (req, res) => {
  const { channelId } = req.params;
  const guildId = guildIdOfChannel(channelId);
  if (!guildId) return res.status(404).json({ error: 'canal nao encontrado' });
  if (!isMember(guildId, req.user.id)) {
    return res.status(403).json({ error: 'voce nao e membro desse servidor' });
  }
  const result = q.run(
    `UPDATE message_mentions SET read_at = ?
     WHERE user_id = ? AND channel_id = ? AND read_at IS NULL`,
    Date.now(), req.user.id, channelId,
  );
  getIo()?.to(`user:${req.user.id}`).emit('mention:read', { guildId, channelId });
  return res.json({ ok: true, acknowledged: Number(result.changes) });
});
