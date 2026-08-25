import { q } from '../db.js';

/** Nunca devolvemos password_hash nem email de terceiros pro cliente. */
export const publicUser = (u) =>
  u && {
    id: u.id,
    username: u.username,
    handle: u.handle ?? null,
    avatarUrl: u.avatar_url ?? null,
    // Recorte guardado em porcentagem; so vem preenchido para GIF, que e
    // recortado na hora de exibir para nao perder a animacao.
    avatarCrop: u.avatar_crop ? JSON.parse(u.avatar_crop) : null,
  };

/** Perfil completo: so vai pro card, nao pra cada mensagem do chat. */
export const profileDto = (u) => ({
  ...publicUser(u),
  bannerUrl: u.banner_url ?? null,
  bannerCrop: u.banner_crop ? JSON.parse(u.banner_crop) : null,
  bio: u.bio ?? null,
  createdAt: u.created_at,
  themePrimary: u.theme_primary ?? null,
  themeAccent: u.theme_accent ?? null,
  themePosition: u.theme_position ?? null,
});

export const selfUser = (u) => ({ ...profileDto(u), email: u.email });

export const channelDto = (c) => ({
  id: c.id,
  guildId: c.guild_id,
  name: c.name,
  type: c.type,
  position: c.position,
  topic: c.topic ?? null,
  categoryId: c.category_id ?? null,
});

/**
 * Reacoes agrupadas por emoji, com a contagem e quem reagiu. Serve pra
 * mensagem de canal e de DM (os ids nao se repetem entre as duas tabelas).
 */
export function reactionsOf(messageId) {
  const linhas = q.all(
    'SELECT emoji, user_id FROM message_reactions WHERE message_id = ? ORDER BY created_at',
    messageId,
  );
  const porEmoji = new Map();
  for (const { emoji, user_id: userId } of linhas) {
    if (!porEmoji.has(emoji)) porEmoji.set(emoji, []);
    porEmoji.get(emoji).push(userId);
  }
  return [...porEmoji].map(([emoji, userIds]) => ({ emoji, count: userIds.length, userIds }));
}

/** null quando a mensagem nao tem anexo (a maioria). */
const attachmentDto = (m) => (m.attachment_url ? {
  url: m.attachment_url, type: m.attachment_type, name: m.attachment_name,
} : null);

/**
 * Previa da mensagem respondida: so o suficiente pra desenhar a linha de cima
 * ("fulano: texto..."), sem puxar anexo nem reacao de novo.
 */
function replyPreview(replyToId, tabela) {
  if (!replyToId) return null;
  const coluna = tabela === 'dm_messages' ? 'dm_channel_id' : 'channel_id';
  const m = q.get(
    `SELECT m.id, m.content, m.${coluna} AS parent, u.username, u.id AS author_id
     FROM ${tabela} m JOIN users u ON u.id = m.author_id WHERE m.id = ?`,
    replyToId,
  );
  // Mensagem respondida pode ter sido apagada: some a previa, nao quebra nada.
  if (!m) return null;
  return {
    id: m.id,
    authorId: m.author_id,
    username: m.username,
    content: m.content.slice(0, 120),
  };
}

export const messageDto = (m) => ({
  id: m.id,
  channelId: m.channel_id,
  content: m.content,
  createdAt: m.created_at,
  editedAt: m.edited_at ?? null,
  pinnedAt: m.pinned_at ?? null,
  attachment: attachmentDto(m),
  replyTo: replyPreview(m.reply_to_id, 'messages'),
  reactions: reactionsOf(m.id),
  author: publicUser({
    id: m.author_id, username: m.username, avatar_url: m.avatar_url, avatar_crop: m.avatar_crop,
  }),
});

export const dmMessageDto = (m) => ({
  id: m.id,
  dmChannelId: m.dm_channel_id,
  content: m.content,
  createdAt: m.created_at,
  editedAt: m.edited_at ?? null,
  attachment: attachmentDto(m),
  replyTo: replyPreview(m.reply_to_id, 'dm_messages'),
  reactions: reactionsOf(m.id),
  author: publicUser({
    id: m.author_id, username: m.username, avatar_url: m.avatar_url, avatar_crop: m.avatar_crop,
  }),
});

export const guildSummary = (g) => ({
  id: g.id,
  name: g.name,
  iconUrl: g.icon_url ?? null,
  iconCrop: g.icon_crop ? JSON.parse(g.icon_crop) : null,
  description: g.description ?? null,
  ownerId: g.owner_id,
  isPublic: Boolean(g.is_public),
  role: g.role ?? null,
});

/** Guild com canais, categorias, cargos e membros - o cliente consome direto. */
export function guildDetail(guildId, viewerId) {
  const g = q.get('SELECT * FROM guilds WHERE id = ?', guildId);
  if (!g) return null;
  const me = q.get('SELECT role FROM guild_members WHERE guild_id = ? AND user_id = ?', guildId, viewerId);

  // Cargos de todo mundo de uma vez: uma consulta pro servidor inteiro em vez
  // de uma por membro, que e o que deixaria a lista lenta com gente demais.
  const cargosPorMembro = new Map();
  for (const linha of q.all('SELECT user_id, role_id FROM member_roles WHERE guild_id = ?', guildId)) {
    if (!cargosPorMembro.has(linha.user_id)) cargosPorMembro.set(linha.user_id, []);
    cargosPorMembro.get(linha.user_id).push(linha.role_id);
  }

  return {
    ...guildSummary({ ...g, role: me?.role ?? null }),
    categories: q
      .all('SELECT id, name, position FROM categories WHERE guild_id = ? ORDER BY position', guildId),
    roles: q
      .all('SELECT * FROM roles WHERE guild_id = ? ORDER BY position DESC', guildId)
      .map((r) => ({
        id: r.id, name: r.name, color: r.color, position: r.position,
        permissions: r.permissions, isDefault: Boolean(r.is_default),
      })),
    channels: q
      .all('SELECT * FROM channels WHERE guild_id = ? ORDER BY type, position, created_at', guildId)
      .map(channelDto),
    members: q
      .all(
        `SELECT u.*, gm.role, gm.nickname, gm.timeout_until FROM guild_members gm
         JOIN users u ON u.id = gm.user_id
         WHERE gm.guild_id = ?
         ORDER BY CASE gm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,
                  u.username COLLATE NOCASE`,
        guildId,
      )
      .map((m) => ({
        ...publicUser(m),
        role: m.role,
        nickname: m.nickname ?? null,
        timeoutUntil: m.timeout_until ?? null,
        roles: cargosPorMembro.get(m.id) ?? [],
      })),
  };
}
