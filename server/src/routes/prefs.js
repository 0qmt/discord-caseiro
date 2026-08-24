import { Router } from 'express';
import { q } from '../db.js';
import { requireAuth } from '../lib/auth.js';
import { sharesGuild } from '../lib/permissions.js';

export const prefRoutes = Router();
prefRoutes.use(requireAuth);

/* ---------------------------- notas privadas ---------------------------- */

/**
 * Anotacao sobre outra pessoa. E privada de verdade: fica presa ao autor,
 * nunca aparece pro alvo nem pra mais ninguem, e nao gera evento nenhum.
 */
prefRoutes.get('/notes/:userId', (req, res) => {
  const row = q.get(
    'SELECT note FROM user_notes WHERE author_id = ? AND target_id = ?',
    req.user.id, req.params.userId,
  );
  res.json({ note: row?.note ?? '' });
});

prefRoutes.put('/notes/:userId', (req, res) => {
  const { userId } = req.params;
  if (userId === req.user.id) return res.status(400).json({ error: 'nota sobre voce mesmo nao faz sentido' });
  if (!q.get('SELECT 1 FROM users WHERE id = ?', userId)) {
    return res.status(404).json({ error: 'usuario nao encontrado' });
  }
  // Mesma regra do perfil: so anota sobre quem voce ao menos divide servidor.
  if (!sharesGuild(req.user.id, userId)) {
    return res.status(403).json({ error: 'voces nao dividem nenhum servidor' });
  }

  const note = String(req.body?.note ?? '').trim().slice(0, 500);
  if (!note) {
    q.run('DELETE FROM user_notes WHERE author_id = ? AND target_id = ?', req.user.id, userId);
    return res.json({ note: '' });
  }
  q.run(
    `INSERT INTO user_notes (author_id, target_id, note, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(author_id, target_id) DO UPDATE SET note = excluded.note, updated_at = excluded.updated_at`,
    req.user.id, userId, note, Date.now(),
  );
  res.json({ note });
});

/* ------------------------ nivel de notificacao ------------------------ */

const ESCOPOS = new Set(['guild', 'channel', 'dm']);
const NIVEIS = new Set(['all', 'mentions', 'none']);

/** Tudo que a pessoa configurou, de uma vez - o cliente guarda em memoria. */
prefRoutes.get('/notifications', (req, res) => {
  const rows = q.all('SELECT * FROM notification_settings WHERE user_id = ?', req.user.id);
  res.json({
    settings: rows.map((r) => ({
      scopeType: r.scope_type, scopeId: r.scope_id, level: r.level, mutedUntil: r.muted_until,
    })),
  });
});

/**
 * Define nivel e/ou silencio de um servidor, canal ou conversa.
 * `mutedUntil` em milissegundos absolutos; null tira o silencio.
 */
prefRoutes.put('/notifications', (req, res) => {
  const scopeType = String(req.body?.scopeType ?? '');
  const scopeId = String(req.body?.scopeId ?? '');
  const level = String(req.body?.level ?? 'all');
  if (!ESCOPOS.has(scopeType) || !scopeId) return res.status(400).json({ error: 'escopo invalido' });
  if (!NIVEIS.has(level)) return res.status(400).json({ error: 'nivel invalido' });

  const bruto = req.body?.mutedUntil;
  const mutedUntil = bruto === null || bruto === undefined ? null : Number(bruto);
  if (mutedUntil !== null && !Number.isFinite(mutedUntil)) {
    return res.status(400).json({ error: 'mutedUntil invalido' });
  }

  // Nivel padrao e sem silencio = e o mesmo que nao ter configuracao nenhuma.
  if (level === 'all' && mutedUntil === null) {
    q.run(
      'DELETE FROM notification_settings WHERE user_id = ? AND scope_type = ? AND scope_id = ?',
      req.user.id, scopeType, scopeId,
    );
    return res.json({ scopeType, scopeId, level: 'all', mutedUntil: null });
  }

  q.run(
    `INSERT INTO notification_settings (user_id, scope_type, scope_id, level, muted_until)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id, scope_type, scope_id)
     DO UPDATE SET level = excluded.level, muted_until = excluded.muted_until`,
    req.user.id, scopeType, scopeId, level, mutedUntil,
  );
  res.json({ scopeType, scopeId, level, mutedUntil });
});
