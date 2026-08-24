import { useEffect } from 'react';

/**
 * Liga a detecção de jogo do app de desktop na presença do servidor.
 *
 * Só faz algo dentro do Electron (é lá que existe `window.appDesktop`). No
 * navegador não tem como saber o que está rodando na máquina, e tudo bem: a
 * pessoa ainda pode escrever a atividade na mão com /jogando.
 */
export function useDeteccaoDeJogo(socket, { ativo, manualRef }) {
  useEffect(() => {
    const ponte = typeof window !== 'undefined' ? window.appDesktop : null;
    if (!socket || !ativo || !ponte?.aoDetectarJogo) return undefined;

    return ponte.aoDetectarJogo((nome) => {
      // Quem escreveu a atividade na mão (/jogando) manda mais que a
      // detecção automática - senão o próximo ciclo apagaria o que a pessoa
      // escolheu escrever.
      if (manualRef?.current) return;
      socket.emit('presence:set', { activity: nome ? `Jogando ${nome}` : null });
    });
  }, [socket, ativo]);
}

/**
 * Marca como "ausente" depois de um tempo sem mexer no teclado nem no mouse,
 * e volta pra online no primeiro sinal de vida - igual ao Discord.
 */
const OCIOSO_MS = 10 * 60 * 1000;

export function useAusenciaAutomatica(socket, { statusEscolhido }) {
  useEffect(() => {
    // Se a pessoa escolheu "não perturbe" ou "invisível" na mão, respeitamos:
    // ficar trocando pra ausente por trás seria ignorar a escolha dela.
    if (!socket || (statusEscolhido !== 'online' && statusEscolhido !== 'idle')) return undefined;

    let ocioso = false;
    let timer = null;

    const voltar = () => {
      if (ocioso) {
        ocioso = false;
        socket.emit('presence:set', { status: 'online' });
      }
      clearTimeout(timer);
      timer = setTimeout(() => {
        ocioso = true;
        socket.emit('presence:set', { status: 'idle' });
      }, OCIOSO_MS);
    };

    const eventos = ['mousemove', 'keydown', 'mousedown', 'wheel', 'touchstart'];
    for (const e of eventos) window.addEventListener(e, voltar, { passive: true });
    voltar();

    return () => {
      clearTimeout(timer);
      for (const e of eventos) window.removeEventListener(e, voltar);
    };
  }, [socket, statusEscolhido]);
}
