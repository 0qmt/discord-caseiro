/** Conversões de cor pro seletor: hex <-> HSV, e uma lista de "usadas recentemente". */

export function hexParaHsv(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? '');
  if (!m) return { h: 0, s: 0, v: 0 };
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  let h = 0;
  if (delta !== 0) {
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : delta / max;
  return { h, s, v: max };
}

export function hsvParaHex({ h, s, v }) {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let [r, g, b] = [0, 0, 0];
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];

  const canal = (v2) => Math.round((v2 + m) * 255).toString(16).padStart(2, '0');
  return `#${canal(r)}${canal(g)}${canal(b)}`;
}

export const corValida = (v) => /^#[0-9a-f]{6}$/i.test(v ?? '');

/**
 * Altura da "tela" do gradiente do tema de perfil, em px. É um valor fixo
 * (não a altura real do cartão, que varia com o tanto de texto) porque as
 * duas superfícies do cartão (faixa e corpo) precisam fatiar o MESMO
 * gradiente contínuo, não desenhar cada uma o seu — senão, com banner
 * próprio, o corpo mostraria o gradiente inteiro espremido numa área menor
 * em vez de continuar de onde a faixa parou.
 */
export const ALTURA_TELA_TEMA = 640;

export const POSICAO_PADRAO = 55;

/**
 * Altura da faixa (banner) dentro da tela de 640px, em %. O cartão tem
 * min(420px, 92vw) de largura e a faixa usa aspect-ratio 5/2 (ver
 * .profile-banner em styles.css) - então 420 * 2/5 = 168px de faixa.
 */
const ALTURA_FAIXA_PCT = (168 / ALTURA_TELA_TEMA) * 100;

/**
 * Receita tirada direto do CSS de verdade do Discord (inspecionei o HTML
 * salvo de um perfil real): a cor principal fica CHAPADA, sem misturar nada,
 * do topo até o fim da faixa - só depois disso começa a virar a cor de
 * destaque. Por cima de tudo entra uma segunda camada, um preto
 * semi-transparente (mais forte em cima, mais fraco embaixo), que é o que
 * faz a cor escolhida parecer discreta em vez de gritar na tela - sem essa
 * camada um vermelho puro fica com uma aparência de alerta, não de tema.
 *
 * `posicao` (0-100) é onde a cor de destaque termina de assumir - no
 * Discord isso é fixo (a altura do rodapé do cartão); aqui virou uma barra
 * ajustável, porque dá mais controle sem custar nada a mais.
 */
export function estiloGradiente(primaria, destaque, posicao = POSICAO_PADRAO) {
  if (!corValida(primaria) || !corValida(destaque)) return null;
  const pos = Math.max(ALTURA_FAIXA_PCT + 1, Math.min(100, Number(posicao) || 0));

  const escrim = `linear-gradient(
    to bottom,
    rgba(0, 0, 0, .55) 0%,
    rgba(0, 0, 0, .55) ${ALTURA_FAIXA_PCT}%,
    rgba(0, 0, 0, .18) 100%
  )`;
  const cores = `linear-gradient(
    to bottom,
    ${primaria} 0%,
    ${primaria} ${ALTURA_FAIXA_PCT}%,
    ${destaque} ${pos}%
  )`;

  return {
    // Propriedades separadas de propósito, nunca o shorthand "background":
    // ele reseta backgroundSize/backgroundRepeat pro valor inicial mesmo
    // quando aparece antes deles no mesmo objeto de estilo.
    backgroundImage: `${escrim}, ${cores}`,
    backgroundSize: `100% ${ALTURA_TELA_TEMA}px`,
    backgroundRepeat: 'no-repeat',
  };
}

const CHAVE_RECENTES = 'discord-caseiro:cores-recentes';
const MAX_RECENTES = 5;

export function coresRecentes() {
  try {
    const lista = JSON.parse(localStorage.getItem(CHAVE_RECENTES) ?? '[]');
    return Array.isArray(lista) ? lista.filter(corValida).slice(0, MAX_RECENTES) : [];
  } catch {
    return [];
  }
}

/** Galeria de temas prontos: pares [cor principal, cor de destaque]. */
export const TEMAS_PRONTOS = [
  ['#1a0a0a', '#440808'],
  ['#1c1033', '#4b2ea3'],
  ['#3a1f0a', '#7a4a2a'],
  ['#1c2733', '#5c7a99'],
  ['#0f2e26', '#2f9e78'],
  ['#1a2350', '#5a4fcf'],
  ['#2a1550', '#2a7ac9'],
  ['#3a2600', '#e0a300'],
  ['#0a2e33', '#1fa3c9'],
  ['#33230f', '#a6793d'],
  ['#0d1a40', '#0d1a40'],
  ['#0f1a12', '#3ba55d'],
];

export function guardarCorRecente(hex) {
  if (!corValida(hex)) return;
  const atual = coresRecentes().filter((c) => c.toLowerCase() !== hex.toLowerCase());
  const nova = [hex, ...atual].slice(0, MAX_RECENTES);
  localStorage.setItem(CHAVE_RECENTES, JSON.stringify(nova));
}
