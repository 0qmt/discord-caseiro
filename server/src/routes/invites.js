import { Router } from 'express';
import { q } from '../db.js';
import { requireAuth } from '../lib/auth.js';
import { emitToGuild } from '../lib/bus.js';
import { membership } from '../lib/permissions.js';
import { guildDetail, publicUser } from '../lib/serialize.js';

export const inviteRoutes = Router();
inviteRoutes.use(requireAuth);

function loadUsableInvite(code) {
  const invite = q.get('SELECT * FROM invites WHERE code = ?', code.toUpperCase());
  if (!invite) return { error: 'convite invalido' };
  if (invite.expires_at && invite.expires_at < Date.now()) return { error: 'convite expirado' };
  if (invite.max_uses !== null && invite.uses >= invite.max_uses) {
    return { error: 'convite ja atingiu o limite de usos' };
  }
  return { invite };
}

/** Espiar o convite antes de entrar (nome do servidor, quantos membros). */
inviteRoutes.get('/:code', (req, res) => {
  const { invite, error } = loadUsableInvite(req.params.code);
  if (error) return res.status(404).json({ error });

  const guild = q.get('SELECT * FROM guilds WHERE id = ?', invite.guild_id);
  const memberCount = q.get(
    'SELECT COUNT(*) AS n FROM guild_members WHERE guild_id = ?', invite.guild_id,
  ).n;

  res.json({
    invite: {
      code: invite.code,
      guild: { id: guild.id, name: guild.name, iconUrl: guild.icon_url ?? null, memberCount },
      alreadyMember: membership(guild.id, req.user.id) !== null,
    },
  });
});

/** Entrar no servidor usando o codigo. */
inviteRoutes.post('/:code/join', (req, res) => {
  const { invite, error } = loadUsableInvite(req.params.code);
  if (error) return res.status(400).json({ error });

  if (membership(invite.guild_id, req.user.id)) {
    return res.json({ guild: guildDetail(invite.guild_id, req.user.id), alreadyMember: true });
  }

  q.run(
    'INSERT INTO guild_members (guild_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)',
    invite.guild_id, req.user.id, 'member', Date.now(),
  );
  q.run('UPDATE invites SET uses = uses + 1 WHERE code = ?', invite.code);

  emitToGuild(invite.guild_id, 'member:joined', {
    guildId: invite.guild_id,
    member: { ...publicUser(req.user), role: 'member' },
  });

  res.status(201).json({ guild: guildDetail(invite.guild_id, req.user.id), alreadyMember: false });
});
