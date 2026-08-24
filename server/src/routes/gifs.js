import { Router } from 'express';
import { config } from '../config.js';
import { requireAuth } from '../lib/auth.js';

export const gifRoutes = Router();
gifRoutes.use(requireAuth);

const GIPHY_BASE = 'https://api.giphy.com/v1/gifs';

/** Só os campos que o cliente usa - a resposta do Giphy vem enorme. */
function simplificar(item) {
  const original = item.images?.original;
  const fixedWidth = item.images?.fixed_width_small ?? item.images?.fixed_width;
  return {
    id: item.id,
    url: original?.url ?? null,
    width: Number(original?.width) || null,
    height: Number(original?.height) || null,
    previewUrl: fixedWidth?.url ?? original?.url ?? null,
    previewWidth: Number(fixedWidth?.width) || null,
    previewHeight: Number(fixedWidth?.height) || null,
  };
}

async function giphy(caminho, params) {
  if (!config.giphyApiKey) return null;
  const url = new URL(`${GIPHY_BASE}/${caminho}`);
  url.searchParams.set('api_key', config.giphyApiKey);
  url.searchParams.set('rating', 'pg-13');
  for (const [chave, valor] of Object.entries(params)) url.searchParams.set(chave, valor);

  const resposta = await fetch(url);
  if (!resposta.ok) return null;
  const corpo = await resposta.json();
  return corpo.data?.map(simplificar) ?? [];
}

gifRoutes.get('/trending', async (_req, res) => {
  const gifs = await giphy('trending', { limit: 24 }).catch(() => null);
  if (gifs === null) return res.status(503).json({ error: 'busca de gif indisponivel' });
  res.json({ gifs });
});

gifRoutes.get('/buscar', async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  if (!q) return res.status(400).json({ error: 'faltou o termo de busca' });

  const gifs = await giphy('search', { q, limit: 24 }).catch(() => null);
  if (gifs === null) return res.status(503).json({ error: 'busca de gif indisponivel' });
  res.json({ gifs });
});
