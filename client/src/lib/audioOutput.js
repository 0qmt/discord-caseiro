/**
 * Preferência de saída de áudio (alto-falante/fone escolhido em Configurações
 * > Voz e vídeo). Guardada localmente e aplicada a toda tag <audio> que a
 * chamada cria - por isso o pub-sub: cada <audio> se inscreve pra saber na
 * hora se a pessoa trocar de dispositivo no meio de uma call.
 */
const CHAVE = 'discord-caseiro:saida-audio';

let ouvintes = [];

export function getSaidaAudio() {
  try {
    return localStorage.getItem(CHAVE) ?? '';
  } catch {
    return '';
  }
}

export function setSaidaAudio(deviceId) {
  try {
    localStorage.setItem(CHAVE, deviceId);
  } catch {
    // localStorage indisponível (modo privado etc.) - a escolha só não persiste.
  }
  ouvintes.forEach((cb) => cb(deviceId));
}

export function assinarSaidaAudio(cb) {
  ouvintes.push(cb);
  return () => { ouvintes = ouvintes.filter((o) => o !== cb); };
}
