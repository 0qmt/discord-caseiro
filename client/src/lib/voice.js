import { emitAck } from '../socket.js';
import { getEntradaAudio, assinarEntradaAudio } from './audioInput.js';

/**
 * Cliente de voz/vídeo em malha (cada um conecta com cada um).
 *
 * Duas decisões que evitam quase todos os problemas clássicos de WebRTC:
 *
 * 1. Quem chega faz as ofertas para quem já estava. Como só um lado oferece,
 *    nunca acontece de as duas pontas negociarem ao mesmo tempo (glare), e
 *    não precisa de "perfect negotiation".
 *
 * 2. A conexão tem três linhas de mídia numa ordem fixa: áudio, vídeo da
 *    câmera e vídeo da tela. Ligar a câmera ou a tela depois é só um
 *    replaceTrack, que NÃO renegocia — e numa malha renegociação é
 *    justamente o que costuma travar tudo.
 *
 *    Só quem oferece cria os transceivers. Quem responde adota os que o
 *    setRemoteDescription criou: o Chrome não reaproveita transceivers
 *    pré-criados para casar com as m-lines de uma oferta, e o resultado
 *    seria a conexão fechar em sendonly, sem áudio de volta.
 */

/** A ordem das linhas de mídia, combinada entre as duas pontas. */
const SLOTS = ['audio', 'camera', 'screen'];

/**
 * Restrições de mídia do microfone, montadas na hora a partir do que a
 * pessoa escolheu em Configurações > Voz e vídeo (dispositivo e supressor
 * de ruído - ver audioInput.js). `autoGainControl` fica sempre ligado: é o
 * ganho automático do NAVEGADOR, que não conflita com o ganho manual
 * nosso (ver `abrirMicrofone`) - um estabiliza o volume, o outro ajusta o
 * quanto mais forte/fraco a pessoa quer.
 */
function montarRestricoesMic() {
  const { deviceId, noiseSuppression } = getEntradaAudio();
  return {
    audio: {
      echoCancellation: true,
      noiseSuppression,
      autoGainControl: true,
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    },
  };
}

const LIMIAR_FALA = 0.02;
const INTERVALO_ESTATISTICAS = 2000;

/**
 * Resolução e fps de tela compartilhada são escolhidos em dois eixos
 * independentes — dá pra combinar qualquer resolução com qualquer
 * velocidade (ex.: 1080p a 15fps pra economizar banda, ou 1080p a 60fps pra
 * jogo). Números de referência de banda em LIMITES-E-RISCOS.md.
 */
export const RESOLUCOES_TELA = [
  { id: '480p', label: '480p', width: 854, height: 480 },
  { id: '720p', label: '720p', width: 1280, height: 720 },
  { id: '1080p', label: '1080p', width: 1920, height: 1080 },
  { id: 'fonte', label: 'Nativa', width: null, height: null },
];

export const FPS_TELA = [
  { id: '15', label: '15 fps' },
  { id: '30', label: '30 fps' },
  { id: '60', label: '60 fps' },
];

export const RESOLUCAO_PADRAO = RESOLUCOES_TELA[1];
export const FPS_PADRAO = FPS_TELA[1];

/** Monta as constraints de vídeo do getDisplayMedia/applyConstraints. */
function constraintsDaQualidade(resolucao, fps) {
  const video = { frameRate: { ideal: Number(fps.id), max: Number(fps.id) } };
  if (resolucao.width && resolucao.height) {
    video.width = { ideal: resolucao.width, max: resolucao.width };
    video.height = { ideal: resolucao.height, max: resolucao.height };
  }
  return video;
}

/** Extrai a linha outbound-rtp de vídeo de um RTCRtpSender. */
async function statsDoEmissor(transceiver) {
  if (!transceiver) return null;
  for (const relatorio of await transceiver.sender.getStats()) {
    const r = relatorio[1];
    if (r.type === 'outbound-rtp' && r.kind === 'video') return r;
  }
  return null;
}

/** Extrai a linha inbound-rtp de vídeo de um RTCRtpReceiver. */
async function statsDoReceptor(transceiver) {
  if (!transceiver) return null;
  for (const relatorio of await transceiver.receiver.getStats()) {
    const r = relatorio[1];
    if (r.type === 'inbound-rtp' && r.kind === 'video') return r;
  }
  return null;
}

const statsIguais = (a, b) => {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.fps === b.fps && a.width === b.width && a.height === b.height && a.kbps === b.kbps;
};

export class VoiceClient {
  constructor(socket, onChange) {
    this.socket = socket;
    this.onChange = onChange;

    this.channelId = null;
    this.connecting = false;
    this.error = null;
    this.connectionStatus = 'connected';
    this.reconexaoCanal = null;

    this.iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
    this.micStream = null;
    this.cameraStream = null;
    this.screenStream = null;
    // Lembra a última qualidade escolhida entre uma call e outra.
    this.resolucaoTela = RESOLUCAO_PADRAO;
    this.fpsTela = FPS_PADRAO;

    this.self = {
      muted: false, hasMic: false, camera: false, screen: false, speaking: false,
      deafened: false, screenStats: null, telaResolucaoId: null, telaFpsId: null,
    };
    // Volume e silêncio por pessoa são LOCAIS: valem só pro que eu ouço, não
    // vão pro servidor e não mudam nada pros outros.
    this.volumes = new Map();
    this.silenciadosLocal = new Set();
    this.mutadoAntesDeEnsurdecer = false;
    this.peers = new Map();
    // Quem e quem no canal, e o ultimo estado (mic/camera/tela) que soubemos
    // de cada um. O "voice:participants" as vezes chega ANTES de existir um
    // RTCPeerConnection pra essa pessoa (a oferta dela ainda esta a caminho),
    // entao guardamos aqui pra nao perder a informacao: sem isso, o par
    // nasceria sempre com o estado padrao (like "tem microfone") mesmo
    // quando o servidor ja tinha avisado o contrario.
    this.participantes = new Map();
    this.estadosConhecidos = new Map();

    this.analisadores = new Map();   // chave -> { analyser, dados }
    this.audioContext = null;
    this.timerFala = null;

    // bytes/tempo anteriores por chave, pra calcular kbps entre duas leituras.
    this.statsAnteriores = new Map();
    this.timerStats = null;

    this.aoSinal = this.aoSinal.bind(this);
    this.aoEntrarAlguem = this.aoEntrarAlguem.bind(this);
    this.aoSairAlguem = this.aoSairAlguem.bind(this);
    this.aoConectar = this.aoConectar.bind(this);
    this.aoDesconectar = this.aoDesconectar.bind(this);

    socket.on('voice:signal', this.aoSinal);
    socket.on('voice:participants', this.aoEntrarAlguem);
    socket.on('voice:left', this.aoSairAlguem);
    socket.on('connect', this.aoConectar);
    socket.on('disconnect', this.aoDesconectar);

    this.pararDeOuvirEntrada = assinarEntradaAudio((prefs) => this.aoMudarEntradaAudio(prefs));
  }

  /* ------------------------------ estado ------------------------------ */

  snapshot() {
    return {
      channelId: this.channelId,
      socketId: this.socketId ?? null,
      connectionStatus: this.connectionStatus,
      connecting: this.connecting,
      error: this.error,
      self: { ...this.self },
      local: { camera: this.cameraStream, screen: this.screenStream },
      peers: [...this.peers.entries()].map(([socketId, peer]) => ({
        socketId,
        user: peer.user,
        state: peer.state,
        media: peer.media,
        speaking: peer.speaking,
        screenStats: peer.screenStats ?? null,
        connectionState: peer.pc?.connectionState ?? 'new',
        // Já resolvido aqui pra o <audio> só ter que obedecer.
        volume: this.volumeParaTocar(socketId),
        silenciadoLocal: this.silenciadosLocal.has(socketId),
      })),
    };
  }

  avisar() {
    this.onChange?.(this.snapshot());
  }

  /* ----------------------------- reconexao ---------------------------- */

  aoDesconectar() {
    if (!this.channelId) { this.connectionStatus = 'offline'; this.avisar(); return; }
    this.reconexaoCanal = this.channelId;
    for (const socketId of [...this.peers.keys()]) this.removerPar(socketId);
    this.channelId = null; this.socketId = null; this.connecting = true;
    this.connectionStatus = 'reconnecting';
    this.self = { ...this.self, camera: false, screen: false, speaking: false };
    this.error = 'Conexao perdida. Tentando voltar para a chamada...';
    this.avisar();
  }

  aoConectar() {
    this.connectionStatus = 'connected';
    const canal = this.reconexaoCanal; this.reconexaoCanal = null;
    if (canal) this.join(canal, { preservarMidia: true }); else this.avisar();
  }

  /* ------------------------------- entrar ------------------------------ */

  async join(channelId, { preservarMidia = false } = {}) {
    if (this.channelId) this.leave();

    this.connecting = true;
    this.error = null;
    this.connectionStatus = preservarMidia ? 'reconnecting' : 'connecting';
    this.avisar();

    // O microfone é opcional: sem ele (ou sem permissão) a pessoa ainda entra
    // na call, só pra ouvir os outros e ver o que for compartilhado - igual
    // ao Discord. O aviso fica guardado pra mostrar depois que entrar.
    let avisoDeMic = null;
    if (!this.micStream) try {
      await this.abrirMicrofone();
    } catch (err) {
      this.micStream = null;
      avisoDeMic = err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError'
        ? 'nenhum microfone encontrado - você entrou só pra ouvir'
        : err.name === 'NotAllowedError'
          ? 'microfone bloqueado - você entrou só pra ouvir'
          : `não consegui abrir o microfone (${err.name}) - você entrou só pra ouvir`;
    }

    try {
      const resposta = await fetch('/api/ice');
      const { iceServers } = await resposta.json();
      if (Array.isArray(iceServers) && iceServers.length) this.iceServers = iceServers;
    } catch {
      // Sem a lista do servidor seguimos com o STUN padrão.
    }
    // Ajuda a diagnosticar "fica negociando": mostra se o TURN self-hosted
    // veio na lista ou se sobrou só o STUN público (aí ninguém atrás de NAT
    // fechado consegue conectar).
    console.log('[voz] servidores de ICE:', this.iceServers.map((s) => s.urls));

    const resposta = await emitAck(this.socket, 'voice:join', { channelId });
    if (resposta?.error) {
      this.connecting = false;
      this.error = resposta.error;
      this.pararMicrofone();
      this.avisar();
      return;
    }

    this.channelId = resposta.channelId;
    this.socketId = resposta.socketId;
    this.connecting = false;
    this.self = {
      muted: !this.micStream,
      hasMic: Boolean(this.micStream),
      camera: preservarMidia && Boolean(this.cameraStream),
      screen: preservarMidia && Boolean(this.screenStream),
      speaking: false,
      screenStats: null,
      telaResolucaoId: null,
      telaFpsId: null,
    };
    // Aviso não bloqueante: aparece igual a um erro, mas não impede a call.
    this.error = avisoDeMic;
    this.connectionStatus = 'connected';
    // O servidor assume hasMic=true até o primeiro voice:state — se entramos
    // sem microfone, os outros precisam saber disso desde já.
    this.publicarEstado();

    this.iniciarDeteccaoDeFala();
    this.iniciarEstatisticas();
    if (this.micStream) this.observarFala('self', this.micStream);

    // Nós somos quem chegou: oferecemos para todo mundo que já estava.
    for (const participante of resposta.participants) {
      this.criarPar(participante.socketId, participante.user, participante.state, true);
    }

    this.avisar();
  }

  /**
   * `avisarServidor: false` é pro caso do servidor já saber que saímos (ele
   * mandou embora porque a mesma conta entrou de outro lugar) - aí não faz
   * sentido mandar voice:leave de volta. `motivo` vira o aviso que fica na
   * tela no lugar do de sempre (ex.: "sem microfone").
   */
  leave({ avisarServidor = true, motivo = null } = {}) {
    if (avisarServidor && this.channelId) this.socket.emit('voice:leave', { channelId: this.channelId });

    for (const socketId of [...this.peers.keys()]) this.removerPar(socketId);

    this.pararMicrofone();
    this.pararCamera();
    this.pararTela();

    if (this.timerFala) { clearInterval(this.timerFala); this.timerFala = null; }
    this.analisadores.clear();
    this.audioContext?.close().catch(() => {});
    this.audioContext = null;

    this.pararEstatisticas();

    this.participantes.clear();
    this.estadosConhecidos.clear();
    this.channelId = null;
    // Some com avisos e erros da call anterior (ex.: "sem microfone"), senão
    // ficam grudados no painel depois de sair - a não ser que este leave()
    // já venha com um motivo novo pra mostrar no lugar.
    this.error = motivo;
    this.self = {
      muted: false, hasMic: false, camera: false, screen: false, speaking: false,
      screenStats: null, telaResolucaoId: null, telaFpsId: null,
    };
    this.avisar();
  }

  destroy() {
    this.leave();
    this.socket.off('voice:signal', this.aoSinal);
    this.socket.off('voice:participants', this.aoEntrarAlguem);
    this.socket.off('voice:left', this.aoSairAlguem);
    this.socket.off('connect', this.aoConectar);
    this.socket.off('disconnect', this.aoDesconectar);
    this.pararDeOuvirEntrada?.();
  }

  /* -------------------------------- pares ------------------------------ */

  criarPar(socketId, user, state, souOOfertante) {
    if (this.peers.has(socketId)) return this.peers.get(socketId);

    const pc = new RTCPeerConnection({ iceServers: this.iceServers });

    const estadoPadrao = { muted: false, hasMic: true, camera: false, screen: false };
    const peer = {
      user: user ?? this.participantes.get(socketId) ?? null,
      pc,
      transceivers: null,
      state: state ?? this.estadosConhecidos.get(socketId) ?? estadoPadrao,
      media: { audio: null, camera: null, screen: null },
      speaking: false,
      screenStats: null,
      pendentes: [],
    };
    this.peers.set(socketId, peer);

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) this.sinalizar(socketId, { candidate });
      // "typ host" = rede local, "typ srflx" = STUN (NAT simples), "typ relay"
      // = TURN. Quando ninguém consegue conectar direto (NAT fechado dos dois
      // lados), só um candidato "relay" salva a chamada - se ele nunca
      // aparecer aqui, o problema é o TURN, não a rede da outra pessoa.
      console.log(
        `[voz] candidato ICE pra ${socketId}:`,
        candidate ? `tipo ${candidate.type}` : '(fim da coleta)',
      );
    };

    pc.oniceconnectionstatechange = () => {
      console.log(`[voz] ICE com ${socketId}: ${pc.iceConnectionState}`);
    };

    pc.onicegatheringstatechange = () => {
      console.log(`[voz] coleta de candidatos com ${socketId}: ${pc.iceGatheringState}`);
    };

    pc.ontrack = ({ track, transceiver }) => {
      // Pela posição da linha de mídia: vale para os dois lados, e vale
      // mesmo quando o ontrack dispara antes de adotarmos os transceivers.
      const slot = SLOTS[pc.getTransceivers().indexOf(transceiver)] ?? 'audio';
      console.log(`[voz] recebendo ${slot} de ${socketId} (track ${track.id}, enabled=${track.enabled})`);
      peer.media = { ...peer.media, [slot]: new MediaStream([track]) };
      if (slot === 'audio') this.observarFala(socketId, peer.media.audio);
      this.avisar();
    };

    pc.onconnectionstatechange = () => {
      console.log(`[voz] conexão com ${socketId}: ${pc.connectionState}`);
      if (pc.connectionState === 'failed') {
        console.log(`[voz] tentando de novo com ${socketId} (restartIce)`);
        pc.restartIce();
      }
      this.avisar();
    };

    if (souOOfertante) {
      peer.transceivers = {
        audio: pc.addTransceiver('audio', { direction: 'sendrecv' }),
        camera: pc.addTransceiver('video', { direction: 'sendrecv' }),
        screen: pc.addTransceiver('video', { direction: 'sendrecv' }),
      };
      this.enviarNossasFaixas(peer);
      this.oferecer(socketId, peer);
    }

    this.avisar();
    return peer;
  }

  async oferecer(socketId, peer) {
    const offer = await peer.pc.createOffer();
    await peer.pc.setLocalDescription(offer);
    this.sinalizar(socketId, { description: peer.pc.localDescription });
  }

  removerPar(socketId) {
    const peer = this.peers.get(socketId);
    if (!peer) return;
    peer.pc.onicecandidate = null;
    peer.pc.ontrack = null;
    peer.pc.onconnectionstatechange = null;
    peer.pc.close();
    this.peers.delete(socketId);
    this.analisadores.delete(socketId);
    this.statsAnteriores.delete(`${socketId}-screen`);
    this.avisar();
  }

  sinalizar(to, payload) {
    this.socket.emit('voice:signal', { to, channelId: this.channelId, payload });
  }

  async aoSinal({ from, payload }) {
    let peer = this.peers.get(from);
    console.log(`[voz] sinal de ${from}:`, payload.description?.type ?? (payload.candidate ? 'candidate' : '?'));

    if (payload.description) {
      if (payload.description.type === 'offer') {
        // Alguém chegou depois de nós e está oferecendo.
        if (!peer) peer = this.criarPar(from, null, null, false);
        await peer.pc.setRemoteDescription(payload.description);
        this.adotarTransceivers(peer);
        await this.drenarPendentes(peer);
        const answer = await peer.pc.createAnswer();
        await peer.pc.setLocalDescription(answer);
        this.sinalizar(from, { description: peer.pc.localDescription });
      } else if (peer) {
        await peer.pc.setRemoteDescription(payload.description);
        await this.drenarPendentes(peer);
      }
      this.avisar();
      return;
    }

    if (payload.candidate && peer) {
      // ICE pode chegar antes do SDP; nesse caso fica na fila.
      if (peer.pc.remoteDescription) {
        await peer.pc.addIceCandidate(payload.candidate)
          .catch((err) => console.warn(`[voz] candidato de ${from} recusado:`, err.message));
      } else {
        peer.pendentes.push(payload.candidate);
      }
    }
  }

  /**
   * Depois de aplicar a oferta, os transceivers existem: viram nossos, na
   * mesma ordem combinada, e passam a mandar as nossas faixas também.
   */
  adotarTransceivers(peer) {
    if (peer.transceivers) return;
    const lista = peer.pc.getTransceivers();
    peer.transceivers = {
      audio: lista[0], camera: lista[1], screen: lista[2],
    };
    for (const t of lista.slice(0, 3)) {
      if (t) t.direction = 'sendrecv';
    }
    this.enviarNossasFaixas(peer);
  }

  async drenarPendentes(peer) {
    const fila = peer.pendentes;
    peer.pendentes = [];
    for (const candidate of fila) {
      await peer.pc.addIceCandidate(candidate).catch(() => {});
    }
  }

  /** A lista completa do canal chega a cada mudança; sincronizamos com ela. */
  aoEntrarAlguem({ channelId, participants }) {
    if (channelId !== this.channelId) return;

    const presentes = new Set();
    for (const p of participants) {
      if (p.socketId === this.socketId) continue;
      presentes.add(p.socketId);
      const peer = this.peers.get(p.socketId);
      // Não criamos conexão aqui: quem chega é que oferece. Guardamos o
      // estado mesmo sem par ainda (a oferta pode demorar mais que esse
      // aviso pra chegar), e atualizamos direto quem já está conectado.
      this.participantes.set(p.socketId, p.user);
      this.estadosConhecidos.set(p.socketId, p.state);
      if (peer) { peer.state = p.state; peer.user = p.user; }
    }

    for (const socketId of [...this.peers.keys()]) {
      if (!presentes.has(socketId)) this.removerPar(socketId);
    }
    this.avisar();
  }

  aoSairAlguem({ channelId, socketId }) {
    if (channelId === this.channelId) this.removerPar(socketId);
  }

  /* ------------------------------- faixas ------------------------------ */

  enviarNossasFaixas(peer) {
    if (!peer.transceivers) return;
    const mic = this.micStream?.getAudioTracks()[0] ?? null;
    const cam = this.cameraStream?.getVideoTracks()[0] ?? null;
    const tela = this.screenStream?.getVideoTracks()[0] ?? null;
    peer.transceivers.audio.sender.replaceTrack(mic).catch(() => {});
    peer.transceivers.camera.sender.replaceTrack(cam).catch(() => {});
    peer.transceivers.screen.sender.replaceTrack(tela).catch(() => {});
  }

  /** Troca uma faixa em todos os pares de uma vez, sem renegociar nada. */
  substituirEmTodos(slot, track) {
    for (const peer of this.peers.values()) {
      peer.transceivers?.[slot]?.sender.replaceTrack(track).catch(() => {});
    }
  }

  publicarEstado() {
    this.socket.emit('voice:state', {
      channelId: this.channelId,
      muted: this.self.muted,
      hasMic: this.self.hasMic,
      camera: this.self.camera,
      screen: this.self.screen,
      deafened: this.self.deafened,
    });
  }

  /** Moderador mandou você pra outro canal: sai daqui e entra lá. */
  moverPara(channelId) {
    this.join(channelId);
  }

  /** Silenciar/ensurdecer alguém no servidor (precisa de permissão). */
  moderar(socketId, mudanca) {
    if (!this.channelId) return;
    this.socket.emit('voice:moderar', { channelId: this.channelId, socketId, ...mudanca });
  }

  /** Arrastar alguém pra outro canal de voz. */
  mover(socketId, paraCanal) {
    if (!this.channelId) return;
    this.socket.emit('voice:mover', { channelId: this.channelId, socketId, paraCanal });
  }

  /**
   * Ensurdecer: para de ouvir todo mundo E corta o próprio microfone junto
   * (não faz sentido continuar falando sem ouvir a resposta). Ao religar, o
   * microfone volta pro estado em que estava antes.
   */
  toggleDeafen() {
    this.self.deafened = !this.self.deafened;

    if (this.self.deafened) {
      this.mutadoAntesDeEnsurdecer = this.self.muted;
      this.self.muted = true;
      this.self.speaking = false;
    } else {
      this.self.muted = this.mutadoAntesDeEnsurdecer ?? false;
    }

    for (const track of this.micStream?.getAudioTracks() ?? []) {
      track.enabled = !this.self.muted;
    }
    this.publicarEstado();
    this.avisar();
  }

  /**
   * Volume de UMA pessoa, só pra mim (0 a 2 = 0% a 200%). É estado local: não
   * vai pro servidor nem afeta o que os outros ouvem.
   */
  definirVolume(socketId, volume) {
    this.volumes.set(socketId, Math.max(0, Math.min(2, volume)));
    this.avisar();
  }

  volumeDe(socketId) {
    return this.volumes.get(socketId) ?? 1;
  }

  alternarSilencioLocal(socketId) {
    if (this.silenciadosLocal.has(socketId)) this.silenciadosLocal.delete(socketId);
    else this.silenciadosLocal.add(socketId);
    this.avisar();
  }

  estaSilenciadoLocal(socketId) {
    return this.silenciadosLocal.has(socketId);
  }

  /** O volume final de um par, já considerando ensurdecer e silêncio local. */
  volumeParaTocar(socketId) {
    if (this.self.deafened || this.silenciadosLocal.has(socketId)) return 0;
    return this.volumeDe(socketId);
  }

  /** Dono/admin expulsa direto - o servidor confere a permissão de novo. */
  expulsar(socketId) {
    if (!this.channelId) return;
    this.socket.emit('voice:expulsar', { channelId: this.channelId, socketId });
  }

  /** Voto de expulsão - o próprio servidor conta e expulsa quando bate a maioria. */
  votarExpulsao(socketId) {
    if (!this.channelId) return;
    this.socket.emit('voice:votar-expulsao', { channelId: this.channelId, socketId });
  }

  /** Convida alguém do mesmo servidor pra entrar na call em que estamos agora. */
  convidar(userId) {
    if (!this.channelId) return;
    this.socket.emit('voice:convidar', { userId });
  }

  /** Some com a mensagem de erro sem precisar tentar entrar de novo. */
  clearError() {
    if (!this.error) return;
    this.error = null;
    this.avisar();
  }

  /**
   * Silêncio imposto por um moderador. Diferente do mute normal: a pessoa não
   * consegue tirar sozinha, então o estado vem do servidor e é aplicado aqui.
   */
  aplicarModeracao({ serverMuted, serverDeafened }) {
    this.self.serverMuted = Boolean(serverMuted);
    this.self.serverDeafened = Boolean(serverDeafened);

    if (this.self.serverMuted) {
      this.self.muted = true;
      this.self.speaking = false;
      for (const track of this.micStream?.getAudioTracks() ?? []) track.enabled = false;
    }
    if (this.self.serverDeafened) this.self.deafened = true;

    this.error = this.self.serverDeafened
      ? 'Um moderador te ensurdeceu nesta chamada.'
      : this.self.serverMuted
        ? 'Um moderador te silenciou nesta chamada.'
        : this.error;

    this.publicarEstado();
    this.avisar();
  }

  async toggleMute() {
    // Silenciado por moderador: o clique não faz nada, e a pessoa recebe o
    // motivo em vez de ficar achando que o botão está quebrado.
    if (this.self.serverMuted) {
      this.error = 'Você foi silenciado por um moderador - só ele pode desfazer.';
      this.avisar();
      return;
    }

    // Entrou sem microfone e mudou de ideia: este clique é quem tenta ativar.
    if (!this.self.hasMic) {
      try {
        await this.abrirMicrofone();
      } catch (err) {
        this.error = err.name === 'NotAllowedError'
          ? 'você precisa permitir o microfone'
          : `não consegui abrir o microfone (${err.name})`;
        this.avisar();
        return;
      }
      this.self.hasMic = true;
      this.self.muted = false;
      this.substituirEmTodos('audio', this.micStream.getAudioTracks()[0]);
      this.observarFala('self', this.micStream);
      this.publicarEstado();
      this.avisar();
      return;
    }

    this.self.muted = !this.self.muted;
    // enabled=false mantém a conexão de pé e só manda silêncio.
    for (const track of this.micStream?.getAudioTracks() ?? []) {
      track.enabled = !this.self.muted;
    }
    if (this.self.muted) this.self.speaking = false;
    this.publicarEstado();
    this.avisar();
  }

  async toggleCamera() {
    if (this.self.camera) {
      this.pararCamera();
      this.substituirEmTodos('camera', null);
      this.self.camera = false;
    } else {
      try {
        this.cameraStream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        });
      } catch (err) {
        this.error = `não consegui abrir a câmera (${err.name})`;
        this.avisar();
        return;
      }
      this.substituirEmTodos('camera', this.cameraStream.getVideoTracks()[0]);
      this.self.camera = true;
    }
    this.publicarEstado();
    this.avisar();
  }

  /**
   * Começa a compartilhar já com a última resolução/fps escolhidos (ou o
   * padrão, na primeira vez) — a pessoa escolhe primeiro O QUE compartilhar
   * (o seletor de tela/janela do sistema), e só depois ajusta a qualidade
   * pela engrenagem, com a call já rodando.
   */
  async toggleScreen() {
    if (this.self.screen) {
      this.pararTela();
      this.substituirEmTodos('screen', null);
      this.self.screen = false;
      this.self.telaResolucaoId = null;
      this.self.telaFpsId = null;
    } else {
      try {
        this.screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: constraintsDaQualidade(this.resolucaoTela, this.fpsTela),
          audio: false,
        });
      } catch (err) {
        // Cancelar a janela de escolha cai aqui e não é erro de verdade.
        if (err.name !== 'NotAllowedError') this.error = `não consegui pegar a tela (${err.name})`;
        this.avisar();
        return;
      }
      const track = this.screenStream.getVideoTracks()[0];
      // O botão "parar compartilhamento" do navegador encerra a faixa por fora.
      track.onended = () => { if (this.self.screen) this.toggleScreen(); };
      this.substituirEmTodos('screen', track);
      this.self.screen = true;
      this.self.telaResolucaoId = this.resolucaoTela.id;
      this.self.telaFpsId = this.fpsTela.id;
    }
    this.publicarEstado();
    this.avisar();
  }

  /**
   * Troca resolução e/ou fps de uma tela que já está sendo compartilhada, sem
   * reabrir o seletor de janela/tela nem renegociar a conexão —
   * applyConstraints() reconfigura a mesma faixa que já está sendo enviada.
   * Cada eixo é independente: passar só um deles mantém o outro como está.
   */
  async mudarQualidadeTela(resolucaoId, fpsId) {
    if (!this.self.screen || !this.screenStream) return;
    const resolucao = RESOLUCOES_TELA.find((r) => r.id === resolucaoId) ?? this.resolucaoTela;
    const fps = FPS_TELA.find((f) => f.id === fpsId) ?? this.fpsTela;
    const track = this.screenStream.getVideoTracks()[0];
    if (!track) return;

    try {
      await track.applyConstraints(constraintsDaQualidade(resolucao, fps));
    } catch (err) {
      this.error = `não consegui mudar a qualidade (${err.name})`;
      this.avisar();
      return;
    }

    this.resolucaoTela = resolucao;
    this.fpsTela = fps;
    this.self.telaResolucaoId = resolucao.id;
    this.self.telaFpsId = fps.id;
    this.avisar();
  }

  /**
   * Abre o microfone e já passa o sinal por um nó de ganho antes de virar
   * `this.micStream` - é o que permite "mais forte"/"mais fraco" de
   * verdade (a Media Capture API não tem constraint nenhuma de volume; só
   * dá pra fazer isso processando o áudio com a Web Audio API). O ganho
   * fica sempre no grafo, mesmo em 1x (sem boost/corte nenhum) - assim dá
   * pra mudar ele DEPOIS, ao vivo, sem reabrir o microfone (ver
   * `aoMudarEntradaAudio`).
   *
   * `micStreamCru` é o stream de verdade vindo do hardware - precisa ser
   * parado à parte quando a call acaba, porque o stream "processado" (saída
   * do nó de ganho) é sintético e não seria isso que libera o microfone de
   * verdade.
   */
  async abrirMicrofone() {
    const streamCru = await navigator.mediaDevices.getUserMedia(montarRestricoesMic());
    this.pararMicrofone();
    this.micStreamCru = streamCru;

    if (!this.audioContext) this.audioContext = new AudioContext();
    const fonte = this.audioContext.createMediaStreamSource(streamCru);
    this.gainNode = this.audioContext.createGain();
    this.gainNode.gain.value = getEntradaAudio().ganho;
    const destino = this.audioContext.createMediaStreamDestination();
    fonte.connect(this.gainNode).connect(destino);

    this.micStream = destino.stream;
    return this.micStream;
  }

  /**
   * Preferência de entrada mudou (ver audioInput.js) - aplica na hora se o
   * microfone já está aberto, sem precisar sair e entrar de nada.
   *
   * Ganho: só ajustar o nó já existente, instantâneo. Supressor de ruído:
   * `applyConstraints` na faixa crua, sem reabrir o microfone (funciona na
   * maioria dos navegadores; se não funcionar, vale só na próxima vez que
   * o mic for aberto). Dispositivo: precisa mesmo trocar de stream - só
   * faz isso se o microfone já estiver de verdade aberto (não faz sentido
   * pedir permissão de novo só porque a pessoa mudou uma configuração).
   */
  async aoMudarEntradaAudio(prefs) {
    if (this.gainNode) this.gainNode.gain.value = prefs.ganho;

    if (!this.micStreamCru) return;

    const faixaCrua = this.micStreamCru.getAudioTracks()[0];
    if (faixaCrua && typeof faixaCrua.applyConstraints === 'function') {
      faixaCrua.applyConstraints({ noiseSuppression: prefs.noiseSuppression }).catch(() => {});
    }

    const deviceIdAtual = faixaCrua?.getSettings?.().deviceId;
    if (prefs.deviceId && prefs.deviceId !== deviceIdAtual) {
      try {
        await this.abrirMicrofone();
        this.substituirEmTodos('audio', this.micStream.getAudioTracks()[0]);
        this.observarFala('self', this.micStream);
        // Troca de dispositivo no meio da call não deve desmutar sozinha.
        for (const track of this.micStream.getAudioTracks()) track.enabled = !this.self.muted;
      } catch {
        // Dispositivo escolhido sumiu/sem permissão - continua com o antigo.
      }
    }
  }

  pararMicrofone() {
    for (const t of this.micStreamCru?.getTracks() ?? []) t.stop();
    for (const t of this.micStream?.getTracks() ?? []) t.stop();
    this.micStreamCru = null;
    this.micStream = null;
    this.gainNode = null;
  }

  pararCamera() {
    for (const t of this.cameraStream?.getTracks() ?? []) t.stop();
    this.cameraStream = null;
  }

  pararTela() {
    for (const t of this.screenStream?.getTracks() ?? []) t.stop();
    this.screenStream = null;
  }

  /* ---------------------------- quem está falando ---------------------- */

  observarFala(chave, stream) {
    if (!stream) return;
    if (!this.audioContext) this.audioContext = new AudioContext();

    const fonte = this.audioContext.createMediaStreamSource(stream);
    const analyser = this.audioContext.createAnalyser();
    analyser.fftSize = 512;
    fonte.connect(analyser);
    this.analisadores.set(chave, { analyser, dados: new Uint8Array(analyser.fftSize) });
  }

  iniciarDeteccaoDeFala() {
    if (this.timerFala) return;
    this.timerFala = setInterval(() => {
      let mudou = false;

      for (const [chave, { analyser, dados }] of this.analisadores) {
        analyser.getByteTimeDomainData(dados);
        // RMS do sinal: 128 é o silêncio no formato de 8 bits.
        let soma = 0;
        for (const amostra of dados) {
          const desvio = (amostra - 128) / 128;
          soma += desvio * desvio;
        }
        const volume = Math.sqrt(soma / dados.length);
        const falando = volume > LIMIAR_FALA;

        if (chave === 'self') {
          const valor = falando && !this.self.muted;
          if (valor !== this.self.speaking) { this.self.speaking = valor; mudou = true; }
        } else {
          const peer = this.peers.get(chave);
          if (peer && peer.speaking !== falando) { peer.speaking = falando; mudou = true; }
        }
      }

      if (mudou) this.avisar();
    }, 120);
  }

  /* ---------------------- fps e qualidade de quem compartilha tela --------------------- */

  iniciarEstatisticas() {
    if (this.timerStats) return;
    this.timerStats = setInterval(() => this.atualizarEstatisticas(), INTERVALO_ESTATISTICAS);
  }

  pararEstatisticas() {
    if (this.timerStats) { clearInterval(this.timerStats); this.timerStats = null; }
    this.statsAnteriores.clear();
  }

  /** kbps entre esta leitura e a anterior da mesma chave; null na primeira vez. */
  calcularKbps(chave, bytesAtuais) {
    const agora = performance.now();
    const anterior = this.statsAnteriores.get(chave);
    this.statsAnteriores.set(chave, { bytes: bytesAtuais, tempo: agora });
    if (!anterior) return null;
    const deltaBytes = bytesAtuais - anterior.bytes;
    const deltaSegundos = (agora - anterior.tempo) / 1000;
    if (deltaSegundos <= 0 || deltaBytes < 0) return null;
    return Math.round((deltaBytes * 8) / deltaSegundos / 1000);
  }

  async atualizarEstatisticas() {
    let mudou = false;

    if (this.self.screen && this.screenStream) {
      // fps e resolução: o que a captura está entregando de verdade.
      const config = this.screenStream.getVideoTracks()[0]?.getSettings() ?? {};
      // kbps: soma do upload em todos os pares - é o que pesa na sua banda.
      let bytesTotais = 0;
      let temStats = false;
      for (const peer of this.peers.values()) {
        const relatorio = await statsDoEmissor(peer.transceivers?.screen);
        if (relatorio) { bytesTotais += relatorio.bytesSent ?? 0; temStats = true; }
      }
      const stats = {
        fps: config.frameRate ? Math.round(config.frameRate) : null,
        width: config.width ?? null,
        height: config.height ?? null,
        kbps: temStats ? this.calcularKbps('self-screen', bytesTotais) : null,
      };
      if (!statsIguais(stats, this.self.screenStats)) { this.self.screenStats = stats; mudou = true; }
    } else if (this.self.screenStats) {
      this.self.screenStats = null;
      this.statsAnteriores.delete('self-screen');
      mudou = true;
    }

    for (const [socketId, peer] of this.peers) {
      if (peer.state.screen && peer.media.screen) {
        // eslint-disable-next-line no-await-in-loop
        const relatorio = await statsDoReceptor(peer.transceivers?.screen);
        if (relatorio) {
          const stats = {
            fps: relatorio.framesPerSecond ? Math.round(relatorio.framesPerSecond) : null,
            width: relatorio.frameWidth ?? null,
            height: relatorio.frameHeight ?? null,
            kbps: this.calcularKbps(`${socketId}-screen`, relatorio.bytesReceived ?? 0),
          };
          if (!statsIguais(stats, peer.screenStats)) { peer.screenStats = stats; mudou = true; }
        }
      } else if (peer.screenStats) {
        peer.screenStats = null;
        this.statsAnteriores.delete(`${socketId}-screen`);
        mudou = true;
      }
    }

    if (mudou) this.avisar();
  }
}
