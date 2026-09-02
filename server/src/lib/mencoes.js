import { q } from '../db.js';

const TOKEN_MENCAO = /<@([a-z0-9]+|everyone)>/gi;

/** Extrai os alvos codificados, sem confiar no texto visível do nome. */
export function alvosCodificados(content) {
  const alvos = new Set();
  for (const match of String(content ?? '').matchAll(TOKEN_MENCAO)) {
    alvos.add(match[1].toLowerCase() === 'everyone' ? 'everyone' : match[1]);
  }
  return alvos;
}

/** Resolve tokens apenas contra IDs que realmente pertencem ao servidor. */
export function resolverDestinatarios(content, memberIds, authorId) {
  const tokens = alvosCodificados(content);
  const membros = new Set(memberIds);
  const destinatarios = new Set();

  if (tokens.has('everyone')) {
    for (const id of membros) {
      if (id !== authorId) destinatarios.add(id);
    }
  }

  for (const id of tokens) {
    if (id !== 'everyone' && id !== authorId && membros.has(id)) destinatarios.add(id);
  }
  return [...destinatarios];
}

/**
 * Mantém os recibos de uma mensagem em sincronia após envio ou edição.
 * Recibos que continuam válidos preservam read_at; só alvos realmente novos
 * voltam como não lidos e geram um novo evento.
 */
export function sincronizarMencoes({ messageId, guildId, channelId, authorId, content, createdAt }) {
  const membros = q.all('SELECT user_id FROM guild_members WHERE guild_id = ?', guildId)
    .map((row) => row.user_id);
  const desejados = new Set(resolverDestinatarios(content, membros, authorId));
  const atuais = q.all('SELECT user_id FROM message_mentions WHERE message_id = ?', messageId)
    .map((row) => row.user_id);
  const atuaisSet = new Set(atuais);
  const adicionados = [...desejados].filter((id) => !atuaisSet.has(id));
  const removidos = atuais.filter((id) => !desejados.has(id));

  for (const userId of removidos) {
    q.run('DELETE FROM message_mentions WHERE message_id = ? AND user_id = ?', messageId, userId);
  }
  for (const userId of adicionados) {
    q.run(
      `INSERT OR IGNORE INTO message_mentions
       (message_id, user_id, guild_id, channel_id, created_at, read_at)
       VALUES (?, ?, ?, ?, ?, NULL)`,
      messageId, userId, guildId, channelId, createdAt,
    );
  }

  return { adicionados, removidos, destinatarios: [...desejados] };
}
