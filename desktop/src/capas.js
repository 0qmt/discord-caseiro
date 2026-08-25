const https = require('node:https');

/**
 * A capa do jogo que aparece na presença.
 *
 * Duas fontes, nessa ordem:
 *
 * 1. **CDN da Steam**, pros jogos que estão lá. É a arte oficial, bonita, e
 *    não precisa de chave nem de conta - a Steam serve essas imagens abertas
 *    porque elas são feitas pra ser embutidas em loja e review.
 * 2. **Ícone do próprio .exe** (ver `iconeDoExecutavel` no main.js), pro
 *    resto. Roblox, Fortnite, Minecraft e League não estão na Steam, e o
 *    ícone do executável deles é justamente o logo oficial.
 *
 * Usa `capsule_sm_120` (a menor) de propósito: a `header.jpg` tem 30-60KB, e
 * isso vira base64 dentro de cada atualização de presença que trafega por
 * WebSocket. A pequena fica em 2-6KB e some na largura de banda.
 */

const STEAM_CDN = 'https://cdn.cloudflare.steamstatic.com/steam/apps';

/** Nome bonito (o mesmo de CONHECIDOS em jogos.js) -> appid na Steam. */
const NA_STEAM = new Map(Object.entries({
  'Counter-Strike 2': 730,
  'Counter-Strike': 730,
  'Dota 2': 570,
  'GTA V': 271590,
  'Rocket League': 252950,
  Terraria: 105600,
  'Stardew Valley': 413150,
  'Elden Ring': 1245620,
  'Cyberpunk 2077': 1091500,
  "Baldur's Gate 3": 1086940,
  Palworld: 1623730,
  'Helldivers 2': 553850,
  Rust: 252490,
  Phasmophobia: 739630,
  'Lethal Company': 1966720,
  'Among Us': 945360,
  'Hollow Knight': 367520,
  Celeste: 504230,
  Hades: 1145360,
  Factorio: 427520,
  'Red Dead Redemption 2': 1174180,
  'The Witcher 3': 292030,
  'Forza Horizon 5': 1551360,
  Warframe: 230410,
  'Destiny 2': 1085660,
  Starfield: 1716740,
  'Dead by Daylight': 381210,
  'Apex Legends': 1172470,
  'The Forest': 242760,
}));

/** Cabe numa atualização de presença sem pesar (o servidor corta em 24KB). */
const MAX_BYTES = 12 * 1024;

/**
 * Já buscadas nesta sessão. A arte de um jogo não muda, então buscar de novo
 * a cada vez que a pessoa abre o jogo seria só tráfego repetido.
 */
const cache = new Map();

function baixar(url) {
  return new Promise((resolve) => {
    const req = https.get(url, { timeout: 6000 }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return resolve(null); }
      const pedacos = [];
      let total = 0;
      res.on('data', (p) => {
        total += p.length;
        // Aborta na hora se vier grande demais, em vez de baixar tudo pra
        // descartar depois.
        if (total > MAX_BYTES) { req.destroy(); return resolve(null); }
        pedacos.push(p);
      });
      res.on('end', () => resolve(Buffer.concat(pedacos)));
      res.on('error', () => resolve(null));
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

/**
 * Capa do jogo como data URI, ou null quando ele não está na Steam (aí quem
 * assume é o ícone do executável).
 *
 * Nunca deixa um erro de rede virar exceção: sem capa a presença continua
 * funcionando, só com o ícone genérico - não vale derrubar a detecção
 * inteira porque a CDN piscou.
 */
async function capaDaSteam(nomeDoJogo) {
  if (cache.has(nomeDoJogo)) return cache.get(nomeDoJogo);

  const appid = NA_STEAM.get(nomeDoJogo);
  if (!appid) {
    cache.set(nomeDoJogo, null);
    return null;
  }

  const bytes = await baixar(`${STEAM_CDN}/${appid}/capsule_sm_120.jpg`);
  const uri = bytes ? `data:image/jpeg;base64,${bytes.toString('base64')}` : null;
  cache.set(nomeDoJogo, uri);
  return uri;
}

module.exports = { capaDaSteam, NA_STEAM };
