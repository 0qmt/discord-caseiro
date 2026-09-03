import { useEffect, useRef, useState } from 'react';
import Avatar from './Avatar.jsx';
import Icon from './Icon.jsx';
import { getSaidaAudio, assinarSaidaAudio } from '../lib/audioOutput.js';
import { usePunch } from '../lib/usePunch.js';

/**
 * Autoplay bloqueado pelo navegador falha em silêncio - sem isso, a pessoa
 * não ouve o amigo e não tem nenhum aviso do porquê. Se falhar, tenta nascer
 * de novo assim que a pessoa mexer no app (clique/tecla), que é exatamente
 * o tipo de interação que os navegadores exigem pra liberar autoplay.
 */
function tentarTocar(el) {
  const resultado = el.play();
  if (!resultado?.catch) return;
  resultado.catch(() => {
    const retomar = () => el.play().catch(() => {});
    document.addEventListener('pointerdown', retomar, { once: true });
    document.addEventListener('keydown', retomar, { once: true });
  });
}

/** <video>/<audio> não aceitam MediaStream por atributo, só por propriedade. */
function Media({ stream, kind, muted, className, style, videoRef, volume }) {
  const refInterno = useRef(null);
  const ref = videoRef ?? refInterno;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.srcObject !== stream) {
      el.srcObject = stream ?? null;
      if (stream) tentarTocar(el);
    }
  }, [stream]);

  // Volume por pessoa e "silenciar só pra mim" (e ensurdecer, que zera tudo).
  // `volume` do HTML vai só até 1; acima disso o navegador ignora, então 200%
  // fica limitado a 100% - é o teto honesto sem passar por Web Audio.
  useEffect(() => {
    const el = ref.current;
    if (!el || volume === undefined) return;
    el.volume = Math.max(0, Math.min(1, volume));
    el.muted = volume === 0;
  }, [volume]);

  // Saída de áudio escolhida em Configurações > Voz e vídeo - só existe pra
  // <audio> (setSinkId em <video> mudaria o som da câmera/tela, não faz sentido aqui).
  useEffect(() => {
    if (kind !== 'audio') return undefined;
    const el = ref.current;
    if (!el || typeof el.setSinkId !== 'function') return undefined;
    const aplicar = (deviceId) => {
      if (deviceId) el.setSinkId(deviceId).catch(() => {});
    };
    aplicar(getSaidaAudio());
    return assinarSaidaAudio(aplicar);
  }, [kind]);

  if (kind === 'audio') {
    return <audio ref={ref} autoPlay playsInline />;
  }
  return <video ref={ref} autoPlay playsInline muted={muted} className={className} style={style} />;
}

/**
 * Só toca o áudio de quem está na call. Fica sempre montado, maximizada ou
 * não - se dependesse do palco visual, o som cortaria toda vez que a pessoa
 * minimizasse a call pra ler o chat.
 */
export function VoiceAudioSink({ voice }) {
  if (!voice.channelId) return null;
  return voice.peers.map((peer) => (
    <Media key={`a-${peer.socketId}`} stream={peer.media.audio} kind="audio" volume={peer.volume} />
  ));
}

/** "850 kbps" abaixo de 1 Mbps, "1.2 Mbps" acima — mais fácil de ler de relance. */
function formatarTaxa(kbps) {
  if (kbps == null) return null;
  return kbps >= 1000 ? `${(kbps / 1000).toFixed(1)} Mbps` : `${kbps} kbps`;
}

function textoDeQualidade(stats) {
  if (!stats) return null;
  const partes = [];
  if (stats.width && stats.height) partes.push(`${stats.width}×${stats.height}`);
  if (stats.fps) partes.push(`${stats.fps} fps`);
  const taxa = formatarTaxa(stats.kbps);
  if (taxa) partes.push(taxa);
  return partes.length ? partes.join(' · ') : null;
}

const ZOOM_MIN = 1;
const ZOOM_MAX = 4;
const ZOOM_PASSO = 0.2;

/**
 * Zoom só faz sentido pra tela compartilhada (câmera já enche o quadro
 * sozinha) - a roda do mouse em cima do tile, tela cheia ou não, ajusta um
 * scale no <video>; o tile em volta corta o excesso (overflow: hidden).
 */
function Tile({
  stream, label, tipo, espelhado, stats, muted, hasMic, falando,
  socketId, podeExpulsar, votacao, onExpulsar, onVotarExpulsao,
}) {
  const qualidade = tipo === 'screen' ? textoDeQualidade(stats) : null;
  const containerRef = useRef(null);
  const videoRef = useRef(null);
  const arrastoRef = useRef(null); // { x, y, panX, panY } enquanto arrasta - não precisa re-render
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [arrastando, setArrastando] = useState(false);
  // "Tela cheia" tentada via Fullscreen API do navegador (`requestFullscreen`)
  // não se comportava direito dentro do Electron (o botão parava de
  // responder, ou entrava sem cobrir a tela de verdade) - troquei por um
  // "ocupar a janela" só em CSS: o tile vira position:fixed cobrindo a
  // janela inteira do app, sem depender de nenhuma API do navegador.
  const [expandido, setExpandido] = useState(false);
  const ehTela = tipo === 'screen';

  useEffect(() => { setZoom(1); setPan({ x: 0, y: 0 }); }, [stream]);

  // Esc pra sair, do jeito que qualquer tela cheia de verdade funciona.
  useEffect(() => {
    if (!expandido) return undefined;
    const aoTeclar = (e) => { if (e.key === 'Escape') setExpandido(false); };
    document.addEventListener('keydown', aoTeclar);
    return () => document.removeEventListener('keydown', aoTeclar);
  }, [expandido]);

  /** Não deixa arrastar a imagem pra fora do quadro - a sobra depende de quanto deu zoom. */
  function limitarPan(x, y, z) {
    const el = containerRef.current;
    if (!el) return { x: 0, y: 0 };
    const folgaX = (el.clientWidth * (z - 1)) / 2;
    const folgaY = (el.clientHeight * (z - 1)) / 2;
    return {
      x: Math.min(folgaX, Math.max(-folgaX, x)),
      y: Math.min(folgaY, Math.max(-folgaY, y)),
    };
  }

  function aoRolar(e) {
    if (!ehTela) return;
    e.preventDefault();
    setZoom((z) => {
      const proximo = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z + (e.deltaY < 0 ? ZOOM_PASSO : -ZOOM_PASSO)));
      setPan((p) => limitarPan(p.x, p.y, proximo));
      return proximo;
    });
  }

  function aoIniciarArrasto(e) {
    if (!ehTela || zoom === 1) return;
    e.preventDefault();
    arrastoRef.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
    setArrastando(true);
  }

  function aoMoverArrasto(e) {
    if (!arrastoRef.current) return;
    const inicio = arrastoRef.current;
    const novo = limitarPan(inicio.panX + (e.clientX - inicio.x), inicio.panY + (e.clientY - inicio.y), zoom);
    setPan(novo);
  }

  function aoSoltarArrasto() {
    arrastoRef.current = null;
    setArrastando(false);
  }

  // Os dois cobrem o mesmo vídeo por cima de tudo - deixar os dois ligados
  // ao mesmo tempo é o popup (câmera ou outra janela) flutuando por cima do
  // tile expandido. Um sempre fecha o outro antes de abrir.
  function alternarExpandido() {
    if (!expandido && document.pictureInPictureElement) {
      document.exitPictureInPicture().catch(() => {});
    }
    setExpandido((v) => !v);
  }

  const [pipPop, dispararPipPop] = usePunch(280, 'pop');

  async function abrirPopup() {
    setExpandido(false);
    dispararPipPop();
    await videoRef.current?.requestPictureInPicture?.().catch(() => {});
  }

  return (
    <div
      ref={containerRef}
      className={`voice-tile ${ehTela ? 'compartilhando' : ''} ${falando ? 'falando' : ''} ${arrastando ? 'arrastando' : ''} ${expandido ? 'expandido' : ''}`}
      onWheel={aoRolar}
      onMouseDown={aoIniciarArrasto}
      onMouseMove={aoMoverArrasto}
      onMouseUp={aoSoltarArrasto}
      onMouseLeave={aoSoltarArrasto}
    >
      <Media
        stream={stream}
        kind="video"
        muted
        videoRef={videoRef}
        className={`${espelhado ? 'espelhado' : ''} ${ehTela && zoom > 1 ? 'arrastavel' : ''}`}
        style={zoom !== 1 ? { transform: `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)` } : undefined}
      />
      <span className="voice-tile-label">
        {ehTela
          ? <Icon name="monitor" size={13} className="ao-vivo" />
          : <Icon name="camera" size={13} />} {label}
      </span>
      {(muted || !hasMic) && (
        <span className="voice-tile-mic" title={hasMic ? 'mutado' : 'sem microfone'}>
          <Icon name={hasMic ? 'mic-off' : 'headphones'} size={12} />
        </span>
      )}
      {qualidade && <span className="voice-tile-qualidade">{qualidade}</span>}
      {/*
        * Nenhum botão daqui usa a classe "faint": ela some com opacity:0
        * sempre, só reaparecendo sob `.channel-row:hover`/`.member:hover`
        * (ver styles.css) - nenhum dos dois é ancestral aqui. O CONTAINER
        * `.voice-tile-acoes` já tem seu PRÓPRIO fade (opacity 0→1 no hover
        * do tile / tela cheia); com "faint" também no botão, o botão ficava
        * preso em opacity:0 pra sempre, PARENTE visível ou não - era por
        * isso que tela cheia e PiP nunca apareciam, mesmo passando o mouse.
        */}
      <span className="voice-tile-acoes">
        {socketId && (
          <AcaoExpulsar
            podeExpulsar={podeExpulsar}
            votacao={votacao}
            onExpulsar={() => onExpulsar(socketId)}
            onVotarExpulsao={() => onVotarExpulsao(socketId)}
          />
        )}
        {ehTela && !expandido && (
          <button className={`icon-btn ${pipPop}`} title="Abrir em janela flutuante" onClick={abrirPopup}>
            <Icon name="picture-in-picture" size={13} />
          </button>
        )}
        <button
          className={`icon-btn troca-janela ${expandido ? 'aberto' : ''}`}
          title={expandido ? 'Sair da tela cheia' : 'Abrir câmera em tela cheia'}
          onClick={alternarExpandido}
        >
          {/* O mesmo controle vale para câmera e compartilhamento de tela. */}
          <span className="camada base"><Icon name="expand" size={14} /></span>
          <span className="camada corte"><Icon name="x" size={16} /></span>
        </button>
      </span>
      {/* Botão de sair sempre visível enquanto expandido, sem depender de
          passar o mouse em cima - `.voice-tile-acoes` só some/aparece no
          hover, e sair da tela cheia não pode depender de achar o hover
          certo primeiro. */}
      {expandido && (
        <button className="voice-tile-sair" title="Sair da tela cheia" onClick={alternarExpandido}>
          <Icon name="x" size={18} />
        </button>
      )}
    </div>
  );
}

/**
 * Botão de expulsar (dono/admin, na hora) ou votar expulsão (todo mundo
 * mais, precisa de maioria) - o servidor decide de novo quem pode o quê,
 * isto aqui só evita mostrar um botão que ia ser rejeitado de cara.
 */
function AcaoExpulsar({ podeExpulsar, votacao, onExpulsar, onVotarExpulsao }) {
  if (podeExpulsar) {
    return (
      <button className="icon-btn perigo" title="Expulsar da chamada" onClick={onExpulsar}><Icon name="ban" size={13} /></button>
    );
  }
  return (
    <button
      className="icon-btn"
      title={votacao ? `Votar expulsão (${votacao.votos}/${votacao.necessario})` : 'Votar para expulsar da chamada'}
      onClick={onVotarExpulsao}
    >
      <Icon name="hand" size={13} />{votacao && <span className="voice-tile-votos">{votacao.votos}/{votacao.necessario}</span>}
    </button>
  );
}

/** Monta a lista de tiles de vídeo (tela e câmera, sua e de quem mais estiver). */
function montarTiles(voice, votacoes, podeExpulsar) {
  const tiles = [];

  if (voice.self.screen && voice.local.screen) {
    tiles.push({
      key: 'self-screen', stream: voice.local.screen, label: 'sua tela', tipo: 'screen',
      stats: voice.self.screenStats, deSiMesmo: true,
      muted: voice.self.muted, hasMic: voice.self.hasMic, falando: voice.self.speaking,
    });
  }
  if (voice.self.camera && voice.local.camera) {
    tiles.push({
      key: 'self-camera', stream: voice.local.camera, label: 'você', tipo: 'camera',
      espelhado: true, deSiMesmo: true,
      muted: voice.self.muted, hasMic: voice.self.hasMic, falando: voice.self.speaking,
    });
  }

  for (const peer of voice.peers) {
    const nome = peer.user?.username ?? 'alguém';
    const infoDeAudio = { muted: peer.state.muted, hasMic: peer.state.hasMic, falando: peer.speaking };
    const infoDeExpulsao = {
      socketId: peer.socketId, podeExpulsar, votacao: votacoes[peer.socketId] ?? null,
    };
    if (peer.state.screen && peer.media.screen) {
      tiles.push({
        key: `${peer.socketId}-screen`, stream: peer.media.screen,
        label: `tela de ${nome}`, tipo: 'screen', stats: peer.screenStats, autor: nome,
        ...infoDeAudio, ...infoDeExpulsao,
      });
    }
    if (peer.state.camera && peer.media.camera) {
      tiles.push({
        key: `${peer.socketId}-camera`, stream: peer.media.camera, label: nome, tipo: 'camera', autor: nome,
        ...infoDeAudio, ...infoDeExpulsao,
      });
    }
  }

  return tiles;
}

/** Alguém (que não seja você) está com câmera ou tela ligada. */
export function temVideoDeOutros(voice) {
  return voice.peers.some((p) => p.state.screen || p.state.camera);
}

function formatarTempo(segundos = 0) {
  const total = Math.max(0, Math.floor(Number(segundos) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h
    ? h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0')
    : m + ':' + String(s).padStart(2, '0');
}

function WatchBlock({ session, ativo, onAssistir, onStop }) {
  function acionarTeclado(event) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    onAssistir?.();
  }

  return (
    <div
      className={'voice-bloco voice-cinema-bloco ' + (ativo ? 'ativo' : '')}
      role="button"
      tabIndex={0}
      onClick={onAssistir}
      onKeyDown={acionarTeclado}
    >
      {session.media?.poster ? <img src={session.media.poster} alt="" /> : <span className="voice-bloco-poster"><Icon name="film" size={30} /></span>}
      <span className="voice-bloco-info">
        <strong>{session.media?.title ?? 'Cinema'}</strong>
        <small>{session.media?.subtitle || ('Cinema de ' + (session.startedBy?.username ?? 'alguem'))}</small>
        <small>{session.viewers?.length ?? 0} assistindo - {formatarTempo(session.position)}</small>
      </span>
      <span className="voice-bloco-pill"><Icon name="film" size={12} /> Cinema</span>
      <button className="icon-btn perigo voice-bloco-fechar" title="Fechar sessão" onClick={(e) => { e.stopPropagation(); onStop?.(); }}>
        <Icon name="x" size={13} />
      </button>
    </div>
  );
}

function WatchVoteBar({ proposal, minhaVez, onVote }) {
  if (!proposal) return null;
  return (
    <div className="watch-vote-bar">
      <span>
        <strong>{proposal.requestedBy?.username ?? 'Alguem'}</strong> quer sincronizar em {formatarTempo(proposal.position)}
      </span>
      <span className="hint">{proposal.votes?.length ?? 0}/{proposal.needed ?? 1}</span>
      {minhaVez && (
        <>
          <button className="primary" onClick={() => onVote(true)}><Icon name="check" size={13} /> Concordar</button>
          <button onClick={() => onVote(false)}><Icon name="x" size={13} /> Recusar</button>
        </>
      )}
    </div>
  );
}

function WatchTile({ session, proposal, meuSocketId, onStop, onLeave, onPropose, onVote }) {
  const [expandido, setExpandido] = useState(false);
  const [minuto, setMinuto] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const lastSyncRef = useRef(null);
  if (!session?.media?.url) return null;

  useEffect(() => {
    const chave = session.id + ':' + Math.floor(session.position ?? 0) + ':' + session.status;
    if (lastSyncRef.current === chave) return;
    lastSyncRef.current = chave;
    setReloadKey((n) => n + 1);
  }, [session.id, session.position, session.status]);

  const minhaVez = proposal && proposal.requestedBy?.id !== meuSocketId && !proposal.votes?.includes(meuSocketId);
  const pedirSync = () => {
    const partes = String(minuto).trim().split(':').map(Number);
    const seconds = partes.length === 1 ? partes[0] * 60 : (partes[0] * 60) + (partes[1] || 0);
    if (Number.isFinite(seconds)) onPropose?.({ status: 'playing', position: seconds });
  };

  return (
    <div className={'voice-watch-tile ' + (expandido ? 'expandido' : '')}>
      <WatchVoteBar proposal={proposal} minhaVez={minhaVez} onVote={onVote} />
      <iframe
        key={reloadKey}
        src={session.media.url}
        title={session.media.title}
        allow="autoplay *; encrypted-media *; picture-in-picture *; fullscreen *; clipboard-write *; accelerometer *; gyroscope *; web-share *"
        allowFullScreen
      />
      <span className="voice-tile-label">
        <Icon name="film" size={13} className="ao-vivo" /> {session.media.title}
        {session.media.subtitle ? ' - ' + session.media.subtitle : ''}
      </span>
      <span className="watch-sync-tools">
        <input value={minuto} onChange={(e) => setMinuto(e.target.value)} placeholder="minuto" />
        <button onClick={pedirSync}>Pedir sync</button>
      </span>
      <span className="voice-tile-acoes">
        <button className="icon-btn" title="Parar de assistir" onClick={onLeave}>
          <Icon name="arrow-right" size={13} style={{ transform: 'rotate(180deg)' }} />
        </button>
        <button className="icon-btn perigo" title="Fechar sessão" onClick={onStop}>
          <Icon name="x" size={13} />
        </button>
        <button
          className={'icon-btn troca-janela ' + (expandido ? 'aberto' : '')}
          title={expandido ? 'Sair da tela cheia' : 'Ocupar a janela'}
          onClick={() => setExpandido((v) => !v)}
        >
          <span className="camada base"><Icon name="expand" size={14} /></span>
          <span className="camada corte"><Icon name="x" size={16} /></span>
        </button>
      </span>
      {expandido && (
        <button className="voice-tile-sair" title="Sair da tela cheia" onClick={() => setExpandido(false)}>
          <Icon name="x" size={18} />
        </button>
      )}
    </div>
  );
}

function ParticipantControls({ peer, actions, podeModerarVoz }) {
  const [aberto, setAberto] = useState(false);
  if (!peer?.socketId) return null;
  const volume = peer.volume ?? 1;
  return (
    <span className="voice-participant-controls">
      <button className="icon-btn" title="Controles de audio" onClick={(e) => { e.stopPropagation(); setAberto((v) => !v); }}><Icon name="volume" size={13} /></button>
      {aberto && (
        <span className="voice-participant-popover" onClick={(e) => e.stopPropagation()}>
          <label><Icon name="volume" size={12} /><input aria-label="Volume do participante" type="range" min="0" max="2" step=".05" value={volume} onChange={(e) => actions?.definirVolume(peer.socketId, Number(e.target.value))} /></label>
          <button onClick={() => actions?.alternarSilencioLocal(peer.socketId)}>{peer.silenciadoLocal ? 'Ouvir novamente' : 'Silenciar so para mim'}</button>
          {podeModerarVoz && <button onClick={() => actions?.moderar(peer.socketId, { serverMuted: !peer.state.serverMuted })}>{peer.state.serverMuted ? 'Permitir microfone' : 'Silenciar para todos'}</button>}
          {podeModerarVoz && <button onClick={() => actions?.moderar(peer.socketId, { serverDeafened: !peer.state.serverDeafened })}>{peer.state.serverDeafened ? 'Permitir audio' : 'Ensurdecer para todos'}</button>}
        </span>
      )}
    </span>
  );
}

function FaceBlock({ user, falando, muted, hasMic, connectionState, children }) {
  return (
    <div className={'voice-bloco voice-pessoa-bloco ' + (falando ? 'falando' : '')}>
      <Avatar user={user} size={56} />
      <strong>{user?.username ?? 'conectando...'}</strong>
      {(muted || !hasMic) && <small>{hasMic ? 'mutado' : 'sem microfone'}</small>}
      {connectionState && connectionState !== 'connected' && <small className="voice-connection-state">{connectionState === 'failed' ? 'conexao com falha' : connectionState === 'connecting' ? 'conectando...' : 'conexao instavel'}</small>}
      {children}
    </div>
  );
}

function ScreenPreviewBlock({ tile, onAssistir }) {
  return (
    <button className="voice-bloco voice-screen-bloco" onClick={onAssistir}>
      {tile.stream ? (
        <Media stream={tile.stream} kind="video" muted className="voice-screen-preview" />
      ) : <span className="voice-bloco-poster"><Icon name="monitor" size={30} /></span>}
      <span className="voice-screen-overlay">
        <Icon name="monitor" size={16} />
        <strong>{tile.label}</strong>
        <small>compartilhando tela</small>
      </span>
    </button>
  );
}

function tocarAvisoTela() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 740;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.22);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.25);
  } catch {}
}

/**
 * A chamada maximizada — substitui o chat inteiro, igual ao Discord. Só é
 * montada quando o App decide mostrá-la; o áudio (VoiceAudioSink) é
 * independente disso e continua tocando com ela minimizada.
 */
export default function VoiceStage({
  voice, me, channelName, onMinimizar, podeExpulsar = false, votacoes = {}, onExpulsar, onVotarExpulsao,
  telaAssistida = null, onAssistir, onPararDeAssistir,
  voiceActions, podeModerarVoz = false,
  watchSession = null, onOpenApps, onStopWatch, onJoinWatch, onLeaveWatch, onProposeWatch, onVoteWatch,
}) {
  if (!voice.channelId) return null;
  const todos = montarTiles(voice, votacoes, podeExpulsar);
  const sessoesCinema = Array.isArray(watchSession?.sessions) ? watchSession.sessions : (watchSession ? [watchSession] : []);
  const propostasCinema = Array.isArray(watchSession?.proposals) ? watchSession.proposals : [];
  const [cinemaAssistido, setCinemaAssistido] = useState(null);
  const telasAtivas = todos.filter((t) => t.tipo === 'screen');
  const camerasAtivas = todos.filter((t) => t.tipo === 'camera');
  const telaAtual = telaAssistida ? telasAtivas.find((t) => t.socketId === telaAssistida || t.key === telaAssistida) : null;
  const cinemaAssistidoId = cinemaAssistido ?? sessoesCinema.find((s) => s.viewers?.includes(voice.socketId))?.id ?? null;
  const cinemaAtual = cinemaAssistidoId ? sessoesCinema.find((s) => s.id === cinemaAssistidoId) : null;
  const propostaAtual = cinemaAtual ? propostasCinema.find((p) => p.sessionId === cinemaAtual.id) : null;
  const vistosRef = useRef(new Set());

  useEffect(() => {
    for (const tela of telasAtivas) {
      if (tela.deSiMesmo) continue;
      if (!vistosRef.current.has(tela.key)) {
        vistosRef.current.add(tela.key);
        tocarAvisoTela();
      }
    }
  }, [telasAtivas.map((t) => t.key).join('|')]);

  useEffect(() => {
    if (cinemaAssistido && !sessoesCinema.some((s) => s.id === cinemaAssistido)) setCinemaAssistido(null);
  }, [cinemaAssistido, sessoesCinema]);

  async function assistirCinema(session) {
    const resposta = await onJoinWatch?.(session.id);
    if (resposta?.error) return;
    setCinemaAssistido(session.id);
    onPararDeAssistir?.();
  }

  const modoAssistindo = telaAtual || cinemaAtual;

  return (
    <div className="voice-stage">
      <header className="voice-stage-head">
        <span className="voice-dot" />
        <strong>{channelName}</strong>
        <button className="voice-apps-btn" onClick={onOpenApps}>
          <Icon name="store" size={14} /> Apps
        </button>
        <span className="hint">{voice.peers.length + 1} na chamada</span>
        {voice.connectionStatus === 'reconnecting' && <span className="voice-stage-status instavel">Reconectando...</span>}
        {voice.connectionStatus === 'connected' && <span className="voice-stage-status">Conexao ativa</span>}

        {modoAssistindo && (
          <button className="voice-voltar" onClick={() => { setCinemaAssistido(null); onPararDeAssistir?.(); }}>
            <Icon name="arrow-right" size={13} style={{ transform: 'rotate(180deg)' }} /> Parar de assistir
          </button>
        )}

        <button className="icon-btn" title="Minimizar" onClick={onMinimizar}>
          <Icon name="arrow-right" size={15} style={{ transform: 'rotate(90deg)' }} />
        </button>
      </header>

      {telaAtual ? (
        <div className="voice-grid c1">
          <Tile {...telaAtual} onExpulsar={onExpulsar} onVotarExpulsao={onVotarExpulsao} />
        </div>
      ) : cinemaAtual ? (
        <WatchTile
          session={cinemaAtual}
          proposal={propostaAtual}
          meuSocketId={voice.socketId}
          onLeave={() => { onLeaveWatch?.(cinemaAtual.id); setCinemaAssistido(null); }}
          onStop={() => onStopWatch?.(cinemaAtual.id)}
          onPropose={(control) => onProposeWatch?.(cinemaAtual.id, control)}
          onVote={(approve) => onVoteWatch?.(propostaAtual?.id, approve)}
        />
      ) : (
        <div className="voice-blocos-grid">
          <FaceBlock user={me} falando={voice.self.speaking} muted={voice.self.muted} hasMic={voice.self.hasMic} />
          {voice.peers.map((peer) => (
            <FaceBlock key={peer.socketId} user={peer.user ?? { username: '?' }} falando={peer.speaking} muted={peer.state.muted} hasMic={peer.state.hasMic}>
              <span className="voice-face-acoes">
                <ParticipantControls peer={peer} actions={voiceActions} podeModerarVoz={podeModerarVoz} />
                <AcaoExpulsar
                  podeExpulsar={podeExpulsar}
                  votacao={votacoes[peer.socketId] ?? null}
                  onExpulsar={() => onExpulsar(peer.socketId)}
                  onVotarExpulsao={() => onVotarExpulsao(peer.socketId)}
                />
              </span>
            </FaceBlock>
          ))}
          {camerasAtivas.map((tile) => (
            <Tile key={tile.key} {...tile} onExpulsar={onExpulsar} onVotarExpulsao={onVotarExpulsao} />
          ))}
          {telasAtivas.map((tile) => (
            <ScreenPreviewBlock key={tile.key} tile={tile} onAssistir={() => onAssistir?.(tile.socketId ?? tile.key)} />
          ))}
          {sessoesCinema.map((session) => (
            <WatchBlock
              key={session.id}
              session={session}
              ativo={session.viewers?.includes(voice.socketId)}
              onAssistir={() => assistirCinema(session)}
              onStop={() => onStopWatch?.(session.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
