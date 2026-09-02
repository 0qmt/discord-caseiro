import { useEffect, useMemo, useRef, useState } from 'react';
import { VoiceClient } from './voice.js';

const VAZIO = {
  channelId: null,
  socketId: null,
  local: { camera: null, screen: null },
  connecting: false,
  error: null,
  self: {
    muted: false, hasMic: false, camera: false, screen: false, speaking: false,
    screenStats: null, telaResolucaoId: null, telaFpsId: null,
  },
  peers: [],
};

/**
 * Liga o VoiceClient ao React.
 *
 * `voice` é o estado da nossa call; `rooms` é quem está em cada canal de voz do
 * servidor, inclusive nos canais em que não estamos — é o que a barra lateral
 * mostra embaixo do nome do canal.
 */
const MOTIVO_DE_KICK = {
  'outra-sessao': 'Você entrou nessa chamada por outro dispositivo ou aba - esta sessão foi desconectada.',
  expulso: 'Você foi removido dessa chamada.',
};

export function useVoice(socket) {
  const [voice, setVoice] = useState(VAZIO);
  const [rooms, setRooms] = useState({});
  // socketId do alvo -> { votos, necessario } - só existe enquanto a votação
  // dessa pessoa estiver em aberto no canal em que estamos.
  const [votacoes, setVotacoes] = useState({});
  // Convite mais recente pra entrar numa call; null quando não há nenhum.
  const [convite, setConvite] = useState(null);
  const [watch, setWatch] = useState({ sessions: [], proposals: [] });
  const clientRef = useRef(null);

  useEffect(() => {
    if (!socket) { setVoice(VAZIO); setRooms({}); setVotacoes({}); setConvite(null); setWatch({ sessions: [], proposals: [] }); return undefined; }

    const client = new VoiceClient(socket, setVoice);
    clientRef.current = client;

    const aoSincronizar = ({ rooms: inicial }) => setRooms(inicial ?? {});
    const aoMudarParticipantes = ({ channelId, participants }) => {
      setRooms((prev) => {
        if (!participants.length) {
          const next = { ...prev };
          delete next[channelId];
          return next;
        }
        return { ...prev, [channelId]: participants };
      });
      // Quem saiu do canal não pode continuar com uma votação pendente contra ele.
      const presentes = new Set(participants.map((p) => p.socketId));
      setVotacoes((prev) => {
        const next = Object.fromEntries(Object.entries(prev).filter(([alvoId]) => presentes.has(alvoId)));
        return Object.keys(next).length === Object.keys(prev).length ? prev : next;
      });
    };

    // O servidor manda embora quando a mesma conta entra numa call por outro
    // lugar, ou quando dono/admin/votação expulsa - o "motivo" distingue as
    // duas telas; encerra tudo aqui (mic, câmera, tela, pares) de qualquer jeito.
    const aoSerExpulso = ({ motivo } = {}) => clientRef.current?.leave({
      avisarServidor: false,
      motivo: MOTIVO_DE_KICK[motivo] ?? MOTIVO_DE_KICK['outra-sessao'],
    });

    const aoVotar = ({ socketId, votos, necessario }) =>
      setVotacoes((prev) => ({ ...prev, [socketId]: { votos, necessario } }));

    const aoConvidar = (payload) => setConvite(payload);
    const aoSerModerado = (payload) => clientRef.current?.aplicarModeracao(payload);
    const aoSerMovido = ({ channelId }) => clientRef.current?.moverPara(channelId);
    const aoWatch = ({ session, sessions, proposals } = {}) => setWatch({
      sessions: Array.isArray(sessions) ? sessions : (session ? [session] : []),
      proposals: Array.isArray(proposals) ? proposals : [],
    });

    socket.on('voice:sync', aoSincronizar);
    socket.on('voice:participants', aoMudarParticipantes);
    socket.on('voice:kicked', aoSerExpulso);
    socket.on('voice:votacao', aoVotar);
    socket.on('voice:convite', aoConvidar);
    socket.on('voice:moderado', aoSerModerado);
    socket.on('voice:mover-para', aoSerMovido);
    socket.on('watch:sync', aoWatch);
    socket.on('watch:update', aoWatch);

    return () => {
      socket.off('voice:sync', aoSincronizar);
      socket.off('voice:participants', aoMudarParticipantes);
      socket.off('voice:kicked', aoSerExpulso);
      socket.off('voice:votacao', aoVotar);
      socket.off('voice:convite', aoConvidar);
      socket.off('voice:moderado', aoSerModerado);
      socket.off('voice:mover-para', aoSerMovido);
      socket.off('watch:sync', aoWatch);
      socket.off('watch:update', aoWatch);
      client.destroy();
      clientRef.current = null;
      setVoice(VAZIO);
      setRooms({});
      setVotacoes({});
      setConvite(null);
      setWatch({ sessions: [], proposals: [] });
    };
  }, [socket]);

  // Sair da call encerra qualquer votação que estivéssemos acompanhando.
  useEffect(() => {
    if (!voice.channelId) { setVotacoes({}); setWatch({ sessions: [], proposals: [] }); }
  }, [voice.channelId]);

  const actions = useMemo(() => ({
    join: (channelId) => clientRef.current?.join(channelId),
    leave: () => clientRef.current?.leave(),
    toggleMute: () => clientRef.current?.toggleMute(),
    toggleCamera: () => clientRef.current?.toggleCamera(),
    toggleScreen: () => clientRef.current?.toggleScreen(),
    mudarQualidadeTela: (resolucaoId, fpsId) =>
      clientRef.current?.mudarQualidadeTela(resolucaoId, fpsId),
    clearError: () => clientRef.current?.clearError(),
    toggleDeafen: () => clientRef.current?.toggleDeafen(),
    definirVolume: (socketId, v) => clientRef.current?.definirVolume(socketId, v),
    volumeDe: (socketId) => clientRef.current?.volumeDe(socketId) ?? 1,
    alternarSilencioLocal: (socketId) => clientRef.current?.alternarSilencioLocal(socketId),
    estaSilenciadoLocal: (socketId) => clientRef.current?.estaSilenciadoLocal(socketId) ?? false,
    moderar: (socketId, mudanca) => clientRef.current?.moderar(socketId, mudanca),
    mover: (socketId, paraCanal) => clientRef.current?.mover(socketId, paraCanal),
    expulsar: (socketId) => clientRef.current?.expulsar(socketId),
    votarExpulsao: (socketId) => clientRef.current?.votarExpulsao(socketId),
    convidar: (userId) => clientRef.current?.convidar(userId),
    limparConvite: () => setConvite(null),
    watchStart: (channelId, media) => new Promise((resolve) => socket?.emit('watch:start', { channelId, media }, resolve)),
    watchJoin: (channelId, sessionId) => new Promise((resolve) => socket?.emit('watch:join', { channelId, sessionId }, resolve)),
    watchLeave: (channelId, sessionId) => new Promise((resolve) => socket?.emit('watch:leave', { channelId, sessionId }, resolve)),
    watchStop: (channelId, sessionId) => new Promise((resolve) => socket?.emit('watch:stop', { channelId, sessionId }, resolve)),
    watchControl: (channelId, sessionId, control) => new Promise((resolve) => socket?.emit('watch:control', { channelId, sessionId, ...control }, resolve)),
    watchProposeControl: (channelId, sessionId, control) => new Promise((resolve) => socket?.emit('watch:propose-control', { channelId, sessionId, ...control }, resolve)),
    watchVoteControl: (channelId, proposalId, approve = true) => new Promise((resolve) => socket?.emit('watch:vote-control', { channelId, proposalId, approve }, resolve)),
  }), [socket]);

  return { voice, voiceRooms: rooms, voiceVotacoes: votacoes, voiceConvite: convite, voiceWatch: watch, voiceActions: actions };
}
