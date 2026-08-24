import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import cors from 'cors';
import express from 'express';
import { config, SERVER_ROOT } from './config.js';
import './db.js';
import { turnServers } from './lib/turn.js';
import { attachRealtime } from './realtime.js';
import { adminRoutes } from './routes/admin.js';
import { attachmentRoutes } from './routes/attachments.js';
import { authRoutes } from './routes/auth.js';
import { channelRoutes } from './routes/channels.js';
import { dmRoutes } from './routes/dms.js';
import { gifRoutes } from './routes/gifs.js';
import { guildRoutes } from './routes/guilds.js';
import { inviteRoutes } from './routes/invites.js';
import { prefRoutes } from './routes/prefs.js';
import { userRoutes } from './routes/users.js';

const app = express();
app.disable('x-powered-by');
app.use(cors({ origin: config.clientOrigins, credentials: true }));
app.use(express.json({ limit: '256kb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, registrationOpen: config.allowRegistration, uptime: process.uptime() });
});

/**
 * Servidores que o WebRTC usa pra descobrir o caminho entre dois pares:
 * STUN pra maioria dos casos, TURN (credenciais geradas na hora, ver
 * lib/turn.js) pra quando os dois lados estao atras de rede fechada e a
 * conexao direta nao rola - o caso da gente com a Vivo bloqueando entrada.
 */
app.get('/api/ice', (_req, res) => {
  res.json({ iceServers: [...config.iceServers, ...turnServers()] });
});

// Pasta onde `desktop/scripts/publicar.js` deixa o instalador mais recente,
// o latest.yml (electron-updater le isso pra saber se tem versao nova) e um
// version.json (a pagina de download le esse, mais simples que parsear yaml).
// No-cache em tudo: latest.yml e version.json precisam refletir o build mais
// recente na hora, e os arquivos aqui sao pequenos - cachear nao compensa.
app.use('/updates', express.static(config.updatesDir, { maxAge: 0, etag: false }));

app.use('/api/auth', authRoutes);
app.use('/api/guilds', guildRoutes);
app.use('/api/channels', channelRoutes);
app.use('/api/dms', dmRoutes);
app.use('/api/invites', inviteRoutes);
app.use('/api/users', userRoutes);
app.use('/api/attachments', attachmentRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/gifs', gifRoutes);
app.use('/api/prefs', prefRoutes);

// Avatares. O nome do arquivo ja e unico por upload, entao pode cachear forte.
app.use('/uploads', express.static(config.uploadsDir, { maxAge: '365d', immutable: true }));

// A pagina "baixe o app" mora em /baixar, separada do cliente (que mora na
// raiz). Mesmo padrao de cache do cliente: assets com hash cacheiam pra
// sempre, o index.html nunca cacheia.
const landingDist = path.resolve(SERVER_ROOT, '../landing/dist');
if (fs.existsSync(landingDist)) {
  app.use('/baixar/assets', express.static(path.join(landingDist, 'assets'), {
    maxAge: '365d', immutable: true,
  }));
  app.use('/baixar', express.static(landingDist, { index: false }));
  app.get('/baixar', (_req, res) => {
    res.set('Cache-Control', 'no-cache');
    res.sendFile(path.join(landingDist, 'index.html'));
  });
  console.log(`[http] servindo a pagina de download de ${landingDist}`);
}

// Em producao o proprio backend serve o build do cliente, tudo numa porta so.
const clientDist = path.resolve(SERVER_ROOT, '../client/dist');
if (fs.existsSync(clientDist)) {
  // Os arquivos dentro de /assets tem hash no nome (o Vite troca o nome a
  // cada build), entao podem cachear pra sempre sem risco. O index.html e o
  // oposto: ele e quem aponta pro hash certo, e se o navegador/Electron
  // guardar uma copia velha dele, a pessoa fica presa numa versao antiga do
  // app pra sempre, mesmo depois de um build novo - por isso nunca cacheado.
  app.use('/assets', express.static(path.join(clientDist, 'assets'), {
    maxAge: '365d', immutable: true,
  }));
  app.use(express.static(clientDist, { index: false }));
  app.get(/^(?!\/(api|uploads)\/).*/, (_req, res) => {
    res.set('Cache-Control', 'no-cache');
    res.sendFile(path.join(clientDist, 'index.html'));
  });
  console.log(`[http] servindo o cliente de ${clientDist}`);
}

app.use((err, _req, res, _next) => {
  console.error('[erro]', err);
  res.status(500).json({ error: 'erro interno no servidor' });
});

const server = http.createServer(app);
attachRealtime(server);

server.listen(config.port, '0.0.0.0', () => {
  console.log(`[http] API + WebSocket em http://localhost:${config.port}`);
  console.log(`[http] na rede local, use o IP da maquina na mesma porta`);
});
