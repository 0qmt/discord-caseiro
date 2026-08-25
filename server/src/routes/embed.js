import dns from 'node:dns/promises';
import net from 'node:net';
import { Router } from 'express';
import { requireAuth } from '../lib/auth.js';

export const embedRoutes = Router();
embedRoutes.use(requireAuth);

const TIMEOUT_MS = 5000;
const MAX_BYTES = 512 * 1024; // 512kb basta de sobra pro <head> de qualquer site
const CACHE_TTL_MS = 30 * 60 * 1000;
const cache = new Map(); // url -> { em, dado }

/** Nunca deixa o servidor virar proxy pra buscar coisa da própria rede local. */
function ipPrivadoOuLocal(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a === 0;
  }
  return ip === '::1' || ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe80');
}

async function urlEhSegura(url) {
  if (!['http:', 'https:'].includes(url.protocol)) return false;
  try {
    const { address } = await dns.lookup(url.hostname);
    return !ipPrivadoOuLocal(address);
  } catch {
    return false;
  }
}

const metaTag = (html, prop) => {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']*)["']`, 'i',
  );
  return html.match(re)?.[1]
    ?? html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${prop}["']`, 'i'))?.[1]
    ?? null;
};

function decodificarEntidades(texto) {
  if (!texto) return texto;
  return texto
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'");
}

/** api.fxtwitter.com devolve o post inteiro em JSON, nada de scraping de HTML. */
async function buscarViaFxtwitter(alvo, urlOriginal) {
  const controlador = new AbortController();
  const timer = setTimeout(() => controlador.abort(), TIMEOUT_MS);
  try {
    const resposta = await fetch(alvo, { signal: controlador.signal, headers: { Accept: 'application/json' } });
    if (!resposta.ok) return null;
    const { tweet } = await resposta.json();
    if (!tweet) return null;

    const imagem = tweet.media?.photos?.[0]?.url
      ?? tweet.media?.videos?.[0]?.thumbnail_url
      ?? tweet.author?.avatar_url
      ?? null;

    return {
      url: urlOriginal.href,
      site: 'X (Twitter)',
      titulo: `${tweet.author?.name ?? 'alguém'} (@${tweet.author?.screen_name ?? '?'})`,
      descricao: tweet.text ?? null,
      imagem,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * X/Twitter só devolve as tags reais do post (texto, autor, imagem) pros
 * robôs oficiais deles - qualquer outro User-Agent recebe sempre a mesma
 * capa genérica "X / Post". O fxtwitter.com é um espelho público feito
 * exatamente pra isso: mesma URL, mesmo conteúdo, mas com as tags de
 * verdade abertas pra qualquer um. A gente só troca o host pra BUSCAR os
 * dados - o link que a pessoa clica continua sendo o x.com original.
 */
function espelhoParaMetadados(url) {
  if (['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'].includes(url.hostname)) {
    const espelho = new URL(url);
    espelho.hostname = 'api.fxtwitter.com';
    return espelho;
  }
  return url;
}

async function buscarMetadados(urlTexto) {
  const url = new URL(urlTexto);
  if (!(await urlEhSegura(url))) return null;

  const alvo = espelhoParaMetadados(url);
  const usaFxtwitter = alvo !== url;

  if (usaFxtwitter) {
    const dado = await buscarViaFxtwitter(alvo, url);
    if (dado) return dado;
    // Se o espelho falhar por qualquer motivo, cai pro scraping normal
    // (que na pior das hipóteses devolve a capa genérica, não erro).
  }

  const controlador = new AbortController();
  const timer = setTimeout(() => controlador.abort(), TIMEOUT_MS);
  try {
    const resposta = await fetch(url, {
      signal: controlador.signal,
      redirect: 'follow',
      headers: {
        // Vários sites (X/Twitter incluso) só devolvem as tags de preview
        // pra quem se identifica como um bot de preview conhecido.
        'User-Agent': 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)',
        Accept: 'text/html',
      },
    });
    if (!resposta.ok || !resposta.headers.get('content-type')?.includes('text/html')) return null;

    const reader = resposta.body.getReader();
    let recebido = '';
    let bytes = 0;
    while (bytes < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      recebido += Buffer.from(value).toString('utf8');
      if (/<\/head>/i.test(recebido)) break;
    }
    reader.cancel().catch(() => {});

    const titulo = decodificarEntidades(metaTag(recebido, 'og:title'))
      || recebido.match(/<title>([^<]*)<\/title>/i)?.[1] || null;
    const descricao = decodificarEntidades(metaTag(recebido, 'og:description') ?? metaTag(recebido, 'description'));
    let imagem = metaTag(recebido, 'og:image');
    if (imagem && !/^https?:\/\//i.test(imagem)) imagem = new URL(imagem, url).href;
    const site = decodificarEntidades(metaTag(recebido, 'og:site_name')) || url.hostname.replace(/^www\./, '');

    if (!titulo && !descricao && !imagem) return null;
    return { url: url.href, site, titulo, descricao, imagem };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

embedRoutes.get('/', async (req, res) => {
  const bruto = String(req.query.url ?? '');
  let url;
  try {
    url = new URL(bruto);
  } catch {
    return res.status(400).json({ error: 'url invalida' });
  }

  const chave = url.href;
  const emCache = cache.get(chave);
  if (emCache && Date.now() - emCache.em < CACHE_TTL_MS) {
    return res.json({ embed: emCache.dado });
  }

  const dado = await buscarMetadados(chave);
  cache.set(chave, { em: Date.now(), dado });
  res.json({ embed: dado });
});
