/**
 * Preferência de ENTRADA de áudio (microfone), escolhida em Configurações >
 * Voz e vídeo: qual dispositivo usar, se o supressor de ruído fica ligado, e
 * o ganho (sensibilidade/volume do microfone - "mais forte"/"mais fraco").
 *
 * Mesmo padrão do audioOutput.js: guardado localmente, pub-sub pra quem
 * estiver com o microfone aberto (voice.js) aplicar a mudança na hora, sem
 * precisar sair e entrar de novo na call.
 */
const CHAVE = 'discord-caseiro:entrada-audio';

const PADRAO = { deviceId: '', noiseSuppression: true, ganho: 1 };

let ouvintes = [];

export function getEntradaAudio() {
  try {
    const bruto = localStorage.getItem(CHAVE);
    if (!bruto) return { ...PADRAO };
    return { ...PADRAO, ...JSON.parse(bruto) };
  } catch {
    return { ...PADRAO };
  }
}

export function setEntradaAudio(parcial) {
  const novo = { ...getEntradaAudio(), ...parcial };
  try {
    localStorage.setItem(CHAVE, JSON.stringify(novo));
  } catch {
    // localStorage indisponível (modo privado etc.) - a escolha só não persiste.
  }
  ouvintes.forEach((cb) => cb(novo));
  return novo;
}

export function assinarEntradaAudio(cb) {
  ouvintes.push(cb);
  return () => { ouvintes = ouvintes.filter((o) => o !== cb); };
}
