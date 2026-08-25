PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  username      TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  avatar_url    TEXT,
  avatar_crop   TEXT,
  banner_url    TEXT,
  banner_crop   TEXT,
  bio           TEXT,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS guilds (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  icon_url   TEXT,
  owner_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_public  INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS guild_members (
  guild_id  TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  user_id   TEXT NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  role      TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner','admin','member')),
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, user_id)
);

CREATE TABLE IF NOT EXISTS channels (
  id         TEXT PRIMARY KEY,
  guild_id   TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  type       TEXT NOT NULL DEFAULT 'text' CHECK (type IN ('text','voice')),
  position   INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id         TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  author_id  TEXT NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  content    TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS invites (
  code       TEXT PRIMARY KEY,
  guild_id   TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  created_by TEXT NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  uses       INTEGER NOT NULL DEFAULT 0,
  max_uses   INTEGER,
  expires_at INTEGER,
  created_at INTEGER NOT NULL
);

-- Conversa 1:1. user_a_id sempre o menor id dos dois (em ordem de texto), pra
-- UNIQUE pegar o par independente de quem comecou a conversa.
CREATE TABLE IF NOT EXISTS dm_channels (
  id         TEXT PRIMARY KEY,
  user_a_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  UNIQUE (user_a_id, user_b_id)
);

CREATE TABLE IF NOT EXISTS dm_messages (
  id            TEXT PRIMARY KEY,
  dm_channel_id TEXT NOT NULL REFERENCES dm_channels(id) ON DELETE CASCADE,
  author_id     TEXT NOT NULL REFERENCES users(id)       ON DELETE CASCADE,
  content       TEXT NOT NULL,
  created_at    INTEGER NOT NULL
);

-- Agrupador visual de canais na barra lateral. Tabela separada (em vez de um
-- tipo novo em channels.type) porque o CHECK daquela coluna nao pode ser
-- alterado depois que o banco existe.
CREATE TABLE IF NOT EXISTS categories (
  id         TEXT PRIMARY KEY,
  guild_id   TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  position   INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

-- Cargo = cor + conjunto de permissoes (bitfield) + posicao na hierarquia.
-- Quem esta mais em cima (position maior) manda em quem esta embaixo.
CREATE TABLE IF NOT EXISTS roles (
  id          TEXT PRIMARY KEY,
  guild_id    TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  color       TEXT,
  position    INTEGER NOT NULL DEFAULT 0,
  permissions INTEGER NOT NULL DEFAULT 0,
  is_default  INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS member_roles (
  guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  user_id  TEXT NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  role_id  TEXT NOT NULL REFERENCES roles(id)  ON DELETE CASCADE,
  PRIMARY KEY (guild_id, user_id, role_id)
);

-- Permissao especifica de um canal pra um cargo ou pessoa: o que ele
-- explicitamente libera (allow) e o que explicitamente bloqueia (deny).
-- Negar sempre ganha de permitir; o que nao aparece em nenhum dos dois herda.
CREATE TABLE IF NOT EXISTS channel_overwrites (
  channel_id  TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  target_id   TEXT NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('role','user')),
  allow       INTEGER NOT NULL DEFAULT 0,
  deny        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (channel_id, target_id, target_type)
);

-- Vale pra mensagem de canal e de DM: os ids sao unicos entre as duas tabelas
-- (mesmo gerador), entao uma tabela so da conta das duas.
CREATE TABLE IF NOT EXISTS message_reactions (
  message_id TEXT NOT NULL,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji      TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (message_id, user_id, emoji)
);

-- Anotacao privada sobre alguem: so quem escreveu enxerga, nunca sai pra rede
-- de outra pessoa.
CREATE TABLE IF NOT EXISTS user_notes (
  author_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  note       TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (author_id, target_id)
);

-- Nivel de notificacao por servidor/canal/DM, e ate quando esta silenciado.
CREATE TABLE IF NOT EXISTS notification_settings (
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope_type  TEXT NOT NULL CHECK (scope_type IN ('guild','channel','dm')),
  scope_id    TEXT NOT NULL,
  level       TEXT NOT NULL DEFAULT 'all' CHECK (level IN ('all','mentions','none')),
  muted_until INTEGER,
  PRIMARY KEY (user_id, scope_type, scope_id)
);

-- Ate onde a pessoa ja leu cada canal - e o que alimenta o contador de
-- nao-lidas sem precisar guardar um registro por mensagem.
CREATE TABLE IF NOT EXISTS read_state (
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel_id   TEXT NOT NULL,
  last_read_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, channel_id)
);

CREATE TABLE IF NOT EXISTS guild_bans (
  guild_id   TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  reason     TEXT,
  banned_by  TEXT NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, user_id)
);

-- Registro de auditoria: quem fez o que no servidor.
--
-- `actor_label` e `target_label` guardam o NOME de quem agiu e de quem levou
-- a acao no momento em que ela aconteceu, de proposito. Se guardasse so o id
-- e fosse buscar o nome na hora de exibir, uma pessoa que saiu do servidor
-- viraria uma linha em branco no historico - e historico que apaga sozinho
-- nao serve pra nada. O id fica junto pra quando ainda der pra resolver.
--
-- `detalhe` e texto livre (ex.: o motivo do banimento, o cargo mexido).
CREATE TABLE IF NOT EXISTS audit_log (
  id           TEXT PRIMARY KEY,
  guild_id     TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  actor_id     TEXT NOT NULL,
  actor_label  TEXT NOT NULL,
  acao         TEXT NOT NULL,
  target_id    TEXT,
  target_label TEXT,
  detalhe      TEXT,
  created_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_guild      ON audit_log(guild_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_channel  ON messages(channel_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reactions_message ON message_reactions(message_id);
CREATE INDEX IF NOT EXISTS idx_roles_guild       ON roles(guild_id, position DESC);
CREATE INDEX IF NOT EXISTS idx_member_roles_user ON member_roles(guild_id, user_id);
CREATE INDEX IF NOT EXISTS idx_overwrites_chan   ON channel_overwrites(channel_id);
CREATE INDEX IF NOT EXISTS idx_categories_guild  ON categories(guild_id, position);
CREATE INDEX IF NOT EXISTS idx_members_user      ON guild_members(user_id);
CREATE INDEX IF NOT EXISTS idx_channels_guild    ON channels(guild_id, position);
CREATE INDEX IF NOT EXISTS idx_invites_guild     ON invites(guild_id);
CREATE INDEX IF NOT EXISTS idx_dm_messages_dm    ON dm_messages(dm_channel_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dm_channels_a     ON dm_channels(user_a_id);
CREATE INDEX IF NOT EXISTS idx_dm_channels_b     ON dm_channels(user_b_id);
