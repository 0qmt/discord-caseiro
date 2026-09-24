export const VOLUME_PADRAO = 1;
export const VOLUME_MAXIMO_NORMAL = 2;
export const VOLUME_MAXIMO_AMPLIFICADO = 4;

function numeroFinito(valor, fallback = VOLUME_PADRAO) {
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : fallback;
}

/**
 * Limita o volume individual conforme a faixa que a pessoa confirmou.
 * O valor tambem e o ganho linear aplicado no Web Audio: 4 = ganho 4.0.
 */
export function limitarVolumeIndividual(valor, amplificado = false) {
  const maximo = amplificado ? VOLUME_MAXIMO_AMPLIFICADO : VOLUME_MAXIMO_NORMAL;
  return Math.max(0, Math.min(maximo, numeroFinito(valor)));
}

/** Volume HTML e apenas o fallback: a API nativa nao aceita nada acima de 1. */
export function limitarVolumeHtml(valor) {
  return Math.max(0, Math.min(1, numeroFinito(valor)));
}

/** Mantem explicita a relacao exibida na interface: 400% vira ganho real 4.0. */
export function ganhoDoVolumeIndividual(valor) {
  return Math.max(0, Math.min(VOLUME_MAXIMO_AMPLIFICADO, numeroFinito(valor)));
}

export function suportaGanhoWebAudio(escopo = globalThis) {
  const AudioContext = escopo?.AudioContext || escopo?.webkitAudioContext;
  return Boolean(
    AudioContext
    && typeof AudioContext.prototype?.createMediaStreamSource === 'function'
    && typeof AudioContext.prototype?.createGain === 'function',
  );
}
