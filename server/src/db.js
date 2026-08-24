import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export const db = new DatabaseSync(config.dbPath);
db.exec(fs.readFileSync(path.join(here, 'schema.sql'), 'utf8'));

/**
 * Migracoes simples: adiciona colunas que apareceram depois que o banco ja
 * existia. CREATE TABLE IF NOT EXISTS nao cobre isso.
 */
function addColumnIfMissing(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (columns.includes(column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  console.log(`[db] coluna ${table}.${column} adicionada`);
}

addColumnIfMissing('users', 'avatar_crop', 'TEXT');
addColumnIfMissing('users', 'banner_url', 'TEXT');
addColumnIfMissing('users', 'banner_crop', 'TEXT');
addColumnIfMissing('users', 'bio', 'TEXT');
addColumnIfMissing('messages', 'attachment_url', 'TEXT');
addColumnIfMissing('messages', 'attachment_type', 'TEXT');
addColumnIfMissing('messages', 'attachment_name', 'TEXT');
addColumnIfMissing('dm_messages', 'attachment_url', 'TEXT');
addColumnIfMissing('dm_messages', 'attachment_type', 'TEXT');
addColumnIfMissing('dm_messages', 'attachment_name', 'TEXT');
// Sem UNIQUE aqui (ALTER TABLE do SQLite nao aceita) - a unicidade e
// garantida na rota (ver users.js), igual ja acontece com o email.
addColumnIfMissing('users', 'handle', 'TEXT');

// Responder / editar / fixar mensagem.
addColumnIfMissing('messages', 'reply_to_id', 'TEXT');
addColumnIfMissing('messages', 'edited_at', 'INTEGER');
addColumnIfMissing('messages', 'pinned_at', 'INTEGER');
addColumnIfMissing('dm_messages', 'reply_to_id', 'TEXT');
addColumnIfMissing('dm_messages', 'edited_at', 'INTEGER');

// Apelido por servidor e castigo temporario (timeout).
addColumnIfMissing('guild_members', 'nickname', 'TEXT');
addColumnIfMissing('guild_members', 'timeout_until', 'INTEGER');

// Canais: assunto no topo e a categoria em que aparecem.
addColumnIfMissing('channels', 'topic', 'TEXT');
addColumnIfMissing('channels', 'category_id', 'TEXT');

// Presenca: o status que a pessoa escolheu e o que ela esta fazendo agora
// (nome do jogo/programa detectado pelo app de desktop).
addColumnIfMissing('users', 'status', "TEXT NOT NULL DEFAULT 'online'");

/**
 * Todo servidor precisa de um cargo @everyone pra ser a base das permissoes.
 * Os que nasceram antes dos cargos customizados ganham o deles aqui, com as
 * permissoes padrao - assim nada muda de comportamento pra quem ja usava.
 */
function garantirCargoEveryone() {
  const semCargo = db.prepare(
    `SELECT g.id FROM guilds g
     WHERE NOT EXISTS (SELECT 1 FROM roles r WHERE r.guild_id = g.id AND r.is_default = 1)`,
  ).all();
  if (semCargo.length === 0) return;

  // 1<<0|1<<1|1<<3|1<<5|1<<6|1<<7|1<<16 = ver canal, enviar, anexar, falar,
  // ouvir, transmitir e criar convite. Repetido literal aqui de proposito:
  // db.js roda antes de tudo e nao deve depender de outro modulo.
  const padrao = 0b1_0000_0000_1110_1011;
  const inserir = db.prepare(
    `INSERT INTO roles (id, guild_id, name, color, position, permissions, is_default, created_at)
     VALUES (?, ?, '@everyone', NULL, 0, ?, 1, ?)`,
  );
  for (const g of semCargo) {
    inserir.run(Date.now().toString(36) + Math.random().toString(16).slice(2, 14), g.id, padrao, Date.now());
  }
  console.log(`[db] cargo @everyone criado em ${semCargo.length} servidor(es)`);
}

garantirCargoEveryone();

console.log(`[db] SQLite pronto em ${config.dbPath}`);

/**
 * node:sqlite so aceita null/number/string/bigint/Buffer como parametro.
 * Booleans e undefined explodem, entao normalizamos aqui uma vez so.
 */
function normalize(params) {
  return params.map((p) => {
    if (p === undefined) return null;
    if (typeof p === 'boolean') return p ? 1 : 0;
    return p;
  });
}

export const q = {
  all: (sql, ...params) => db.prepare(sql).all(...normalize(params)),
  get: (sql, ...params) => db.prepare(sql).get(...normalize(params)) ?? null,
  run: (sql, ...params) => db.prepare(sql).run(...normalize(params)),
};

/** Executa uma funcao dentro de uma transacao. */
export function tx(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
