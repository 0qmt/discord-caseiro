/**
 * Tema de cor do app inteiro (sidebar, fundos, tudo) - não confundir com o
 * gradiente do CARTÃO DE PERFIL (cor.js), que é outra coisa.
 *
 * A receita é a mesma que o Discord usa de verdade (inspecionei o CSS
 * salvo de uma conta com tema custom ativo). Tem dois modos, que nunca
 * ficam ligados ao mesmo tempo:
 *
 *  - "cor": toda cor de fundo do app vem escrita como
 *    `color-mix(in oklab, <cor original> 100%, var(--custom-theme-base-color)
 *    var(--custom-theme-base-color-amount))` - duas variáveis globais
 *    controlam tudo, e com amount 0% o color-mix devolve a cor de sempre.
 *
 *  - "gradiente": o Discord pinta um `linear-gradient(<ângulo>deg, cor1,
 *    cor2)` FIXO atrás da janela inteira (background-attachment: fixed),
 *    e cada superfície mostra um pedacinho dele por baixo de um véu preto
 *    translúcido (pra não brigar com o texto por cima). A gente reproduz
 *    isso com duas camadas de `background` empilhadas em cada token de
 *    fundo: o véu (cuja opacidade é `--custom-theme-gradient-veu`) por
 *    cima do gradiente (`--custom-theme-gradient-imagem`) por cima da cor
 *    sólida de sempre - ver styles.css. Com veu 0 e imagem "none" as duas
 *    camadas ficam transparentes e a cor sólida de sempre aparece normal.
 *
 * O resto do app nem sabe que isso existe - é só CSS ligado o tempo
 * inteiro, sem custo nem risco pra quem nunca abriu a aba de temas.
 */

const CHAVE = 'discord-caseiro:tema-app';
const VEU_GRADIENTE = 0.55;

function limparVariaveis(raiz) {
  raiz.removeProperty('--custom-theme-base-color');
  raiz.removeProperty('--custom-theme-base-color-amount');
  raiz.removeProperty('--custom-theme-gradient-imagem');
  raiz.removeProperty('--custom-theme-gradient-veu');
}

export function aplicarTemaApp(cor, intensidade) {
  const raiz = document.documentElement.style;
  limparVariaveis(raiz);
  if (!cor) return;
  raiz.setProperty('--custom-theme-base-color', cor);
  raiz.setProperty('--custom-theme-base-color-amount', `${intensidade}%`);
}

export function aplicarGradienteApp(cor1, cor2, angulo) {
  const raiz = document.documentElement.style;
  limparVariaveis(raiz);
  if (!cor1 || !cor2) return;
  raiz.setProperty('--custom-theme-gradient-imagem', `linear-gradient(${angulo}deg, ${cor1}, ${cor2})`);
  raiz.setProperty('--custom-theme-gradient-veu', String(VEU_GRADIENTE));
}

/** @returns {{tipo:'cor', cor:string, intensidade:number} | {tipo:'gradiente', cor1:string, cor2:string, angulo:number} | null} */
export function temaAppSalvo() {
  try {
    const bruto = JSON.parse(localStorage.getItem(CHAVE) ?? 'null');
    if (!bruto) return null;
    if (bruto.tipo === 'gradiente' && typeof bruto.cor1 === 'string' && typeof bruto.cor2 === 'string') {
      return { tipo: 'gradiente', cor1: bruto.cor1, cor2: bruto.cor2, angulo: Number(bruto.angulo) || 0 };
    }
    if (typeof bruto.cor === 'string') {
      return { tipo: 'cor', cor: bruto.cor, intensidade: Number(bruto.intensidade) || 50 };
    }
    return null;
  } catch {
    return null;
  }
}

export function salvarTemaAppCor(cor, intensidade) {
  localStorage.setItem(CHAVE, JSON.stringify({ tipo: 'cor', cor, intensidade }));
}

export function salvarTemaAppGradiente(cor1, cor2, angulo) {
  localStorage.setItem(CHAVE, JSON.stringify({ tipo: 'gradiente', cor1, cor2, angulo }));
}

export function removerTemaApp() {
  localStorage.removeItem(CHAVE);
}

/** Aplica o que estiver salvo, seja qual for o modo - chame em cima do que já estava valendo. */
export function reaplicarTemaSalvo() {
  const salvo = temaAppSalvo();
  if (!salvo) { aplicarTemaApp(null, 0); return; }
  if (salvo.tipo === 'gradiente') aplicarGradienteApp(salvo.cor1, salvo.cor2, salvo.angulo);
  else aplicarTemaApp(salvo.cor, salvo.intensidade);
}

/** Chamado uma vez, cedo, pra já subir com o tema de quem já tinha efetivado um. */
export function restaurarTemaAppInicial() {
  reaplicarTemaSalvo();
}
