import fs from 'node:fs/promises';
import path from 'node:path';
import { Router } from 'express';
import { config } from '../config.js';

export const mobileUpdateRoutes = Router();

function validManifest(value) {
  return value
    && value.schemaVersion === 1
    && value.packageName === 'com.discordcaseiro.app'
    && Number.isSafeInteger(value.versionCode)
    && value.versionCode > 0
    && typeof value.versionName === 'string'
    && /^\/mobile-updates\/[a-zA-Z0-9._-]+\.apk$/.test(value.url)
    && typeof value.sha256 === 'string'
    && /^[a-fA-F0-9]{64}$/.test(value.sha256)
    && Number.isSafeInteger(value.size)
    && value.size > 0;
}

mobileUpdateRoutes.get('/update', async (_req, res, next) => {
  try {
    const raw = await fs.readFile(path.join(config.mobileUpdatesDir, 'latest.json'), 'utf8');
    const manifest = JSON.parse(raw);
    if (!validManifest(manifest)) {
      console.error('[mobile-update] latest.json invalido; manifesto nao sera servido');
      return res.status(503).json({ error: 'atualizacao temporariamente indisponivel' });
    }
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    return res.json(manifest);
  } catch (err) {
    if (err?.code === 'ENOENT') return res.status(204).end();
    return next(err);
  }
});
