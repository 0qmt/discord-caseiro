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

async function readManifest() {
  const raw = await fs.readFile(path.join(config.mobileUpdatesDir, 'latest.json'), 'utf8');
  const manifest = JSON.parse(raw);
  if (!validManifest(manifest)) throw new Error('manifesto mobile invalido');
  return manifest;
}

mobileUpdateRoutes.get('/update', async (_req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  try {
    return res.json(await readManifest());
  } catch (err) {
    if (err?.code === 'ENOENT') return res.status(204).end();
    if (err?.message === 'manifesto mobile invalido') {
      console.error('[mobile-update] latest.json invalido; manifesto nao sera servido');
      return res.status(503).json({ error: 'atualizacao temporariamente indisponivel' });
    }
    return next(err);
  }
});

mobileUpdateRoutes.get('/download', async (_req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  try {
    const manifest = await readManifest();
    return res.redirect(302, manifest.url);
  } catch (err) {
    if (err?.code === 'ENOENT') return res.status(404).send('APK Android ainda nao publicado.');
    if (err?.message === 'manifesto mobile invalido') {
      return res.status(503).send('Atualizacao Android temporariamente indisponivel.');
    }
    return next(err);
  }
});
