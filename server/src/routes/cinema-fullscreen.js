import { Router } from 'express';

const HOSTS_PERMITIDOS = new Set([
  'superflixapi.beer',
  'www.superflixapi.beer',
]);

export function normalizarPlayerUrl(bruto) {
  try {
    const url = new URL(String(bruto ?? ''));
    if (url.protocol !== 'https:' || !HOSTS_PERMITIDOS.has(url.hostname.toLowerCase())) return null;
    return url.toString();
  } catch {
    return null;
  }
}

const escaparAtributo = (valor) => valor
  .replaceAll('&', '&amp;')
  .replaceAll('"', '&quot;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;');

export function renderizarCinemaFullscreen(playerUrl) {
  const src = escaparAtributo(playerUrl);
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>Orbit Cinema</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; background: #000; }
    iframe { position: fixed; inset: 0; width: 100vw; height: 100vh; border: 0; background: #000; }
  </style>
</head>
<body>
  <iframe
    src="${src}"
    title="Orbit Cinema"
    allow="autoplay *; encrypted-media *; picture-in-picture *; fullscreen *; clipboard-write *"
    allowfullscreen
    referrerpolicy="strict-origin-when-cross-origin"
  ></iframe>
</body>
</html>`;
}

export const cinemaFullscreenRoutes = Router();

cinemaFullscreenRoutes.get('/', (req, res) => {
  const playerUrl = normalizarPlayerUrl(req.query.src);
  if (!playerUrl) {
    res.status(400).type('html').send('<!doctype html><title>Player invalido</title><body style="background:#000;color:#fff;font-family:sans-serif">Player invalido.</body>');
    return;
  }

  res.set({
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'; frame-src https://superflixapi.beer https://www.superflixapi.beer; style-src 'unsafe-inline'",
  });
  res.type('html').send(renderizarCinemaFullscreen(playerUrl));
});
