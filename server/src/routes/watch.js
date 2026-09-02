import { Router } from 'express';
import { requireAuth } from '../lib/auth.js';

export const watchRoutes = Router();
watchRoutes.use(requireAuth);

const SUPERFLIX_BASE = 'https://superflixapi.beer';
const TIMEOUT_MS = 9000;
const CACHE_TTL_MS = 30 * 60 * 1000;
const cache = new Map();

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit || Date.now() - hit.em > CACHE_TTL_MS) return null;
  return hit.dado;
}

function cacheSet(key, dado) {
  cache.set(key, { em: Date.now(), dado });
  return dado;
}

async function fetchJson(url) {
  const cached = cacheGet(url);
  if (cached) return cached;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json,text/plain;q=.9,*/*;q=.5',
        'User-Agent': 'DiscordCaseiro/0.1 (+watch-together)',
      },
    });
    if (!response.ok) throw new Error(`http ${response.status}`);
    return cacheSet(url, await response.json());
  } finally {
    clearTimeout(timer);
  }
}

function imdbSuggestionUrl(query) {
  const clean = String(query ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const first = clean[0]?.match(/[a-z0-9]/) ? clean[0] : 'x';
  return `https://v3.sg.media-imdb.com/suggestion/${first}/${encodeURIComponent(clean || 'a')}.json`;
}

function posterOf(item) {
  const url = item?.i?.imageUrl;
  return typeof url === 'string' ? url.replace(/\._V1_[^/]*\.jpg$/i, '._V1_.jpg') : null;
}

function kindOf(item) {
  const qid = String(item?.qid ?? '').toLowerCase();
  const q = String(item?.q ?? '').toLowerCase();
  if (qid.includes('tv') || q.includes('tv series') || q.includes('mini-series')) return 'serie';
  if (qid.includes('movie') || q.includes('feature') || q.includes('movie')) return 'filme';
  return null;
}

function normalizeSearchItem(item) {
  const kind = kindOf(item);
  if (!kind || !/^tt\d+$/.test(String(item?.id ?? ''))) return null;
  return {
    id: item.id,
    imdbId: item.id,
    kind,
    title: item.l ?? item.id,
    year: item.y ?? null,
    years: item.yr ?? item.tl ?? null,
    cast: item.s ?? null,
    poster: posterOf(item),
  };
}

watchRoutes.get('/search', async (req, res) => {
  const query = String(req.query.q ?? '').trim();
  const kind = String(req.query.kind ?? 'serie');
  if (query.length < 2) return res.json({ results: [] });

  try {
    const data = await fetchJson(imdbSuggestionUrl(query));
    const results = (data?.d ?? [])
      .map(normalizeSearchItem)
      .filter(Boolean)
      .filter((item) => kind === 'todos' || item.kind === kind)
      .slice(0, 12);
    return res.json({ results });
  } catch {
    return res.status(502).json({ error: 'nao consegui buscar os titulos agora' });
  }
});

function stripHtml(html) {
  return String(html ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim() || null;
}

watchRoutes.get('/episodes', async (req, res) => {
  const imdbId = String(req.query.imdbId ?? '');
  if (!/^tt\d+$/.test(imdbId)) return res.status(400).json({ error: 'imdb invalido' });

  try {
    const show = await fetchJson(`https://api.tvmaze.com/lookup/shows?imdb=${encodeURIComponent(imdbId)}`);
    const episodesRaw = await fetchJson(`https://api.tvmaze.com/shows/${show.id}/episodes`);
    const episodes = (episodesRaw ?? []).map((ep) => ({
      id: ep.id,
      season: ep.season,
      number: ep.number,
      title: ep.name ?? `Episodio ${ep.number}`,
      summary: stripHtml(ep.summary),
      airdate: ep.airdate ?? null,
      poster: ep.image?.medium ?? ep.image?.original ?? null,
    })).filter((ep) => ep.season && ep.number);

    return res.json({
      show: {
        id: show.id,
        imdbId,
        title: show.name,
        summary: stripHtml(show.summary),
        poster: show.image?.original ?? show.image?.medium ?? null,
      },
      episodes,
    });
  } catch {
    return res.status(502).json({ error: 'nao consegui carregar os episodios desse titulo' });
  }
});

watchRoutes.post('/player', (req, res) => {
  const { kind, imdbId, season, episode, title, poster, subtitle } = req.body ?? {};
  const cleanKind = kind === 'filme' ? 'filme' : 'serie';
  if (!/^tt\d+$/.test(String(imdbId ?? ''))) return res.status(400).json({ error: 'imdb invalido' });

  let path = `/${cleanKind}/${imdbId}`;
  if (cleanKind === 'serie') {
    const s = Number(season);
    const e = Number(episode);
    if (!Number.isInteger(s) || !Number.isInteger(e) || s < 1 || e < 1) {
      return res.status(400).json({ error: 'episodio invalido' });
    }
    path += `/${s}/${e}`;
  }

  const url = new URL(path, SUPERFLIX_BASE).href + (cleanKind === 'serie' ? '#noEpList' : '');
  return res.json({
    media: {
      id: `${cleanKind}:${imdbId}:${season ?? 0}:${episode ?? 0}`,
      kind: cleanKind,
      imdbId,
      title: String(title ?? imdbId).slice(0, 120),
      subtitle: String(subtitle ?? '').slice(0, 120),
      poster: typeof poster === 'string' ? poster : null,
      url,
    },
  });
});
