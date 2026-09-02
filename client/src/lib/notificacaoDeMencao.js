/** A visibilidade entra junto do foco porque uma aba oculta pode ainda reportar foco. */
export function appEstaEmPrimeiroPlano(doc = globalThis.document) {
  return Boolean(doc?.hasFocus?.() && doc.visibilityState === 'visible');
}

/** A notificação do Windows só é redundante no canal já aberto e em foco. */
export function deveExibirNotificacaoNativaDeMencao({ channelId, activeChannelId, dmMode, appFocado }) {
  return !appFocado || dmMode || channelId !== activeChannelId;
}

let contextoDeAudio = null;

/** Toque curto de dois tons, gerado localmente e sem carregar mídia externa. */
export function tocarSomDeMencao() {
  try {
    const AudioContext = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    if (!AudioContext) return;
    contextoDeAudio ??= new AudioContext();
    if (contextoDeAudio.state === 'suspended') contextoDeAudio.resume().catch(() => {});

    const agora = contextoDeAudio.currentTime;
    const ganho = contextoDeAudio.createGain();
    ganho.gain.setValueAtTime(0.0001, agora);
    ganho.gain.exponentialRampToValueAtTime(0.11, agora + 0.012);
    ganho.gain.exponentialRampToValueAtTime(0.0001, agora + 0.32);
    ganho.connect(contextoDeAudio.destination);

    for (const [frequencia, inicio, duracao] of [[659.25, 0, 0.13], [987.77, 0.12, 0.2]]) {
      const oscilador = contextoDeAudio.createOscillator();
      oscilador.type = 'sine';
      oscilador.frequency.setValueAtTime(frequencia, agora + inicio);
      oscilador.connect(ganho);
      oscilador.start(agora + inicio);
      oscilador.stop(agora + inicio + duracao);
    }
  } catch {
    // Falha de áudio nunca impede o recebimento ou o contador da menção.
  }
}
