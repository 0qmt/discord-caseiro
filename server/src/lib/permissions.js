import { q } from '../db.js';

const RANK = { member: 0, admin: 1, owner: 2 };

/**
 * Permissoes como bitfield. Cada uma e um bit; o conjunto de um cargo e a
 * soma (OR) dos bits que ele libera. Ficam abaixo de 1<<30 de proposito: as
 * operacoes bit a bit do JS trabalham em 32 bits com sinal, e passar disso
 * silenciosamente vira numero negativo.
 */
export const PERM = {
  VER_CANAL: 1 << 0,
  ENVIAR_MENSAGEM: 1 << 1,
  GERENCIAR_MENSAGENS: 1 << 2,
  ANEXAR_ARQUIVOS: 1 << 3,
  MENCIONAR_TODOS: 1 << 4,
  FALAR: 1 << 5,
  OUVIR: 1 << 6,
  TRANSMITIR: 1 << 7,
  SILENCIAR_MEMBROS: 1 << 8,
  ENSURDECER_MEMBROS: 1 << 9,
  MOVER_MEMBROS: 1 << 10,
  GERENCIAR_CANAIS: 1 << 11,
  GERENCIAR_CARGOS: 1 << 12,
  GERENCIAR_SERVIDOR: 1 << 13,
  EXPULSAR: 1 << 14,
  BANIR: 1 << 15,
  CRIAR_CONVITE: 1 << 16,
  GERENCIAR_APELIDOS: 1 << 17,
  ADMINISTRADOR: 1 << 18,
};

/** O que um membro sem cargo nenhum pode fazer. */
export const PERMISSOES_PADRAO = PERM.VER_CANAL | PERM.ENVIAR_MENSAGEM | PERM.ANEXAR_ARQUIVOS
  | PERM.FALAR | PERM.OUVIR | PERM.TRANSMITIR | PERM.CRIAR_CONVITE;

const TUDO = Object.values(PERM).reduce((acc, bit) => acc | bit, 0);

/** Cargos customizados de alguem, do mais baixo pro mais alto na hierarquia. */
export function rolesOf(guildId, userId) {
  return q.all(
    `SELECT r.* FROM roles r
     JOIN member_roles mr ON mr.role_id = r.id
     WHERE mr.guild_id = ? AND mr.user_id = ?
     ORDER BY r.position ASC`,
    guildId, userId,
  );
}

/** O cargo @everyone do servidor (criado junto com ele). */
export const defaultRole = (guildId) =>
  q.get('SELECT * FROM roles WHERE guild_id = ? AND is_default = 1', guildId);

/**
 * Posicao mais alta que a pessoa alcanca. Serve pra hierarquia: ninguem
 * gerencia quem esta igual ou acima dele. Dono fica sempre acima de todos.
 */
export function highestPosition(guildId, userId) {
  const m = membership(guildId, userId);
  if (!m) return -1;
  if (m.role === 'owner') return Number.MAX_SAFE_INTEGER;
  const cargos = rolesOf(guildId, userId);
  const maior = cargos.reduce((max, r) => Math.max(max, r.position), 0);
  // Admin do modelo antigo continua valendo como um degrau acima de membro.
  return m.role === 'admin' ? Math.max(maior, 1) : maior;
}

/**
 * Permissoes que a pessoa tem no servidor inteiro, antes de qualquer
 * override de canal.
 */
export function basePermissions(guildId, userId) {
  const m = membership(guildId, userId);
  if (!m) return 0;
  // Dono nunca e barrado por nada - e a saida de emergencia se alguem
  // configurar os cargos errado e se trancar pra fora.
  if (m.role === 'owner') return TUDO;

  const everyone = defaultRole(guildId);
  let bits = everyone ? everyone.permissions : PERMISSOES_PADRAO;
  for (const cargo of rolesOf(guildId, userId)) bits |= cargo.permissions;
  // Admin do modelo antigo (anterior aos cargos customizados) continua
  // valendo como administrador de verdade.
  if (m.role === 'admin') bits |= PERM.ADMINISTRADOR;

  return (bits & PERM.ADMINISTRADOR) ? TUDO : bits;
}

/**
 * Permissoes dentro de UM canal: parte das do servidor e aplica os overrides,
 * do mais generico pro mais especifico (@everyone -> cargos -> a pessoa).
 * Em cada nivel, negar entra antes de permitir.
 */
export function channelPermissions(channelId, userId) {
  const canal = q.get('SELECT guild_id FROM channels WHERE id = ?', channelId);
  if (!canal) return 0;

  let bits = basePermissions(canal.guild_id, userId);
  if (bits === TUDO) return TUDO;

  const overwrites = q.all('SELECT * FROM channel_overwrites WHERE channel_id = ?', channelId);
  if (overwrites.length === 0) return bits;

  const aplicar = (ow) => { bits = (bits & ~ow.deny) | ow.allow; };

  const everyone = defaultRole(canal.guild_id);
  const doEveryone = everyone && overwrites.find(
    (o) => o.target_type === 'role' && o.target_id === everyone.id,
  );
  if (doEveryone) aplicar(doEveryone);

  // Cargos entram todos juntos: junta o que negam e o que liberam antes de
  // aplicar, senao a ordem entre dois cargos do mesmo nivel mudaria o
  // resultado sem motivo.
  const meusCargos = new Set(rolesOf(canal.guild_id, userId).map((r) => r.id));
  let deny = 0;
  let allow = 0;
  for (const ow of overwrites) {
    if (ow.target_type !== 'role' || !meusCargos.has(ow.target_id)) continue;
    deny |= ow.deny;
    allow |= ow.allow;
  }
  bits = (bits & ~deny) | allow;

  const meu = overwrites.find((o) => o.target_type === 'user' && o.target_id === userId);
  if (meu) aplicar(meu);

  return bits;
}

/** true se a pessoa tem a permissao no servidor (sem olhar canal). */
export const can = (guildId, userId, bit) => (basePermissions(guildId, userId) & bit) !== 0;

/** true se a pessoa tem a permissao dentro daquele canal. */
export const canInChannel = (channelId, userId, bit) =>
  (channelPermissions(channelId, userId) & bit) !== 0;

/**
 * Hierarquia: so da pra moderar quem esta estritamente abaixo de voce. O dono
 * passa por cima de todo mundo, e ninguem passa por cima do dono.
 */
export function podeAgirSobre(guildId, autorId, alvoId) {
  if (autorId === alvoId) return false;
  const alvo = membership(guildId, alvoId);
  if (!alvo || alvo.role === 'owner') return false;
  const autor = membership(guildId, autorId);
  if (!autor) return false;
  if (autor.role === 'owner') return true;
  return highestPosition(guildId, autorId) > highestPosition(guildId, alvoId);
}

/** Ainda esta de castigo? (timeout) */
export function estaDeCastigo(guildId, userId) {
  const m = membership(guildId, userId);
  return Boolean(m?.timeout_until && m.timeout_until > Date.now());
}

/** Retorna a linha de guild_members, ou null se o usuario nao for membro. */
export function membership(guildId, userId) {
  return q.get('SELECT * FROM guild_members WHERE guild_id = ? AND user_id = ?', guildId, userId);
}

export function isMember(guildId, userId) {
  return membership(guildId, userId) !== null;
}

/** true se o usuario tem pelo menos o cargo pedido ('member' | 'admin' | 'owner'). */
export function hasRole(guildId, userId, minimum) {
  const m = membership(guildId, userId);
  if (!m) return false;
  return RANK[m.role] >= RANK[minimum];
}

/** Descobre a guild de um canal (usado pra validar acesso a mensagens). */
export function guildIdOfChannel(channelId) {
  const row = q.get('SELECT guild_id FROM channels WHERE id = ?', channelId);
  return row?.guild_id ?? null;
}

/** Os dois participantes de uma conversa direta, ou null se ela nao existe. */
export function dmParticipants(dmChannelId) {
  const row = q.get('SELECT user_a_id, user_b_id FROM dm_channels WHERE id = ?', dmChannelId);
  return row ? [row.user_a_id, row.user_b_id] : null;
}

/** Perfil e DM só existem entre quem divide pelo menos um servidor. */
export function sharesGuild(a, b) {
  return q.get(
    `SELECT 1 FROM guild_members m1
     JOIN guild_members m2 ON m1.guild_id = m2.guild_id
     WHERE m1.user_id = ? AND m2.user_id = ? LIMIT 1`,
    a, b,
  ) !== null;
}

/** Helper pra rotas: 403 se nao tiver a permissao (bit de PERM). */
export function requirePerm(bit) {
  return (req, res, next) => {
    const guildId = req.params.guildId ?? req.body?.guildId;
    if (!guildId) return res.status(400).json({ error: 'guildId ausente' });
    if (!can(guildId, req.user.id, bit)) {
      return res.status(403).json({ error: 'permissao insuficiente' });
    }
    next();
  };
}

/** Helper pra rotas: 403 se nao tiver o cargo. */
export function requireRole(minimum) {
  return (req, res, next) => {
    const guildId = req.params.guildId ?? req.body?.guildId;
    if (!guildId) return res.status(400).json({ error: 'guildId ausente' });
    if (!hasRole(guildId, req.user.id, minimum)) {
      return res.status(403).json({ error: 'permissao insuficiente' });
    }
    next();
  };
}
