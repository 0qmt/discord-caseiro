import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const SERVER_ROOT = path.resolve(here, '..');
export const DATA_DIR = path.resolve(SERVER_ROOT, process.env.DB_PATH ?? '../data/app.db', '..');

export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
export const UPDATES_DIR = path.join(DATA_DIR, 'updates');
export const REPORTS_DIR = path.join(DATA_DIR, 'reports');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOADS_DIR, { recursive: true });
fs.mkdirSync(UPDATES_DIR, { recursive: true });
fs.mkdirSync(REPORTS_DIR, { recursive: true });

/**
 * O segredo do JWT precisa sobreviver a reinicios, senao todo mundo e
 * deslogado toda vez que o servidor cai. Se nao vier do .env, geramos uma vez
 * e guardamos no disco ao lado do banco.
 */
function resolveJwtSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const file = path.join(DATA_DIR, '.jwt-secret');
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
  const secret = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(file, secret, { mode: 0o600 });
  console.log(`[config] JWT_SECRET gerado automaticamente em ${file}`);
  return secret;
}

export const config = {
  port: Number(process.env.PORT ?? 3001),
  clientOrigins: (process.env.CLIENT_ORIGIN ?? 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  jwtSecret: resolveJwtSecret(),
  tokenTtl: '30d',
  dbPath: path.resolve(SERVER_ROOT, process.env.DB_PATH ?? '../data/app.db'),
  allowRegistration: (process.env.ALLOW_REGISTRATION ?? 'true') !== 'false',
  uploadsDir: UPLOADS_DIR,
  updatesDir: UPDATES_DIR,
  reportsDir: REPORTS_DIR,
  maxAvatarBytes: Number(process.env.MAX_AVATAR_MB ?? 20) * 1024 * 1024,
  maxAttachmentBytes: Number(process.env.MAX_ATTACHMENT_MB ?? 25) * 1024 * 1024,
  giphyApiKey: process.env.GIPHY_API_KEY || null,
  iceServers: [
    { urls: (process.env.STUN_URL ?? 'stun:stun.l.google.com:19302').split(',') },
  ],
  /*
   * TURN entra quando os dois lados da chamada estao atras de rede fechada
   * (o caso da gente: a Vivo bloqueia entrada) e a conexao direta via STUN
   * nao rola. Ja passamos por um "sem cadastro" que nao respondia de
   * verdade, e por um serviço pago com cota gratuita que estourou rapido -
   * agora e self-hosted: coturn rodando num container ao lado do servidor
   * (ver docker-compose.yml e lib/turn.js), com porta encaminhada de
   * verdade no roteador de casa - por isso o endereço é fixo, sem precisar
   * de nenhum túnel que expira e reconecta com outro host toda hora (era
   * assim quando o coturn rodava dentro do Termux, sem porta própria).
   */
  turn: {
    host: process.env.TURN_HOST ?? null,
    port: Number(process.env.TURN_PORT ?? 3478),
    username: process.env.TURN_USERNAME ?? 'dcuser',
    password: process.env.TURN_PASSWORD ?? 'c43cf32f0b10817f4a34b9f2',
  },
};
