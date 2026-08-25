import { useEffect, useRef, useState } from 'react';
import Avatar from './Avatar.jsx';
import Icon from './Icon.jsx';
import { getSaidaAudio, assinarSaidaAudio } from '../lib/audioOutput.js';

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
  const ehTela = tipo === 'screen';

  useEffect(() => { setZoom(1); setPan({ x: 0, y: 0 }); }, [stream]);

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
  // ao mesmo tempo é o popup (câmera ou outra janela) flutuando por cima da
  // tela cheia. Um sempre fecha o outro antes de abrir.
  async function alternarTelaCheia() {
    if (document.fullscreenElement === containerRef.current) {
      await document.exitFullscreen();
      return;
    }
    if (document.pictureInPictureElement) await document.exitPictureInPicture().catch(() => {});
    await containerRef.current?.requestFullscreen?.().catch(() => {});
  }

  async function abrirPopup() {
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
    await videoRef.current?.requestPictureInPicture?.().catch(() => {});
  }

  return (
    <div
      ref={containerRef}
      className={`voice-tile ${ehTela ? 'compartilhando' : ''} ${falando ? 'falando' : ''} ${arrastando ? 'arrastando' : ''}`}
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
        <Icon name={tipo === 'screen' ? 'monitor' : 'camera'} size={13} /> {label}
      </span>
      {(muted || !hasMic) && (
        <span className="voice-tile-mic" title={hasMic ? 'mutado' : 'sem microfone'}>
          <Icon name={hasMic ? 'mic-off' : 'headphones'} size={12} />
        </span>
      )}
      {qualidade && <span className="voice-tile-qualidade">{qualidade}</span>}
      <span className="voice-tile-acoes">
        {socketId && (
          <AcaoExpulsar
            podeExpulsar={podeExpulsar}
            votacao={votacao}
            onExpulsar={() => onExpulsar(socketId)}
            onVotarExpulsao={() => onVotarExpulsao(socketId)}
          />
        )}
        {ehTela && (
          <>
            <button className="icon-btn faint" title="Abrir em janela flutuante" onClick={abrirPopup}><Icon name="picture-in-picture" size={13} /></button>
            <button className="icon-btn faint" title="Tela cheia" onClick={alternarTelaCheia}><Icon name="expand" size={14} /></button>
          </>
        )}
      </span>
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
      <button className="icon-btn faint perigo" title="Expulsar da chamada" onClick={onExpulsar}><Icon name="ban" size={13} /></button>
    );
  }
  return (
    <button
      className="icon-btn faint"
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

/**
 * A chamada maximizada — substitui o chat inteiro, igual ao Discord. Só é
 * montada quando o App decide mostrá-la; o áudio (VoiceAudioSink) é
 * independente disso e continua tocando com ela minimizada.
 */
export default function VoiceStage({
  voice, me, channelName, onMinimizar, podeExpulsar = false, votacoes = {}, onExpulsar, onVotarExpulsao,
  telaAssistida = null, onAssistir, onPararDeAssistir,
}) {
  if (!voice.channelId) return null;
  const todos = montarTiles(voice, votacoes, podeExpulsar);

  // "Assistir transmissão" é ação separada de estar na call: quando alguém
  // escolhe uma, o palco mostra só ela em tamanho cheio.
  const assistindo = telaAssistida
    ? todos.find((t) => t.socketId === telaAssistida && t.tipo === 'screen')
    : null;
  const tiles = assistindo ? [assistindo] : todos;

  // Quem está transmitindo e ainda não estamos assistindo - vira o atalho no
  // topo, do jeito que o Discord mostra "fulano está ao vivo".
  const aoVivo = voice.peers.filter((p) => p.state.screen && p.socketId !== telaAssistida);

  return (
    <div className="voice-stage">
      <header className="voice-stage-head">
        <span className="voice-dot" />
        <strong>{channelName}</strong>
        <span className="hint">{voice.peers.length + 1} na chamada</span>

        {assistindo && (
          <button className="voice-voltar" onClick={onPararDeAssistir}>
            <Icon name="arrow-right" size={13} style={{ transform: 'rotate(180deg)' }} /> Ver todo mundo
          </button>
        )}

        {aoVivo.map((p) => (
          <button
            key={p.socketId}
            className="voice-aovivo"
            title={`Assistir a transmissão de ${p.user?.username ?? 'alguém'}`}
            onClick={() => onAssistir?.(p.socketId)}
          >
            <span className="voice-aovivo-selo">AO VIVO</span>
            {p.user?.username ?? 'alguém'}
          </button>
        ))}

        <button className="icon-btn" title="Minimizar" onClick={onMinimizar}>
          <Icon name="arrow-right" size={15} style={{ transform: 'rotate(90deg)' }} />
        </button>
      </header>

      {tiles.length > 0 ? (
        <div className={`voice-grid c${Math.min(tiles.length, 4)}`}>
          {tiles.map((t) => (
            <Tile key={t.key} {...t} onExpulsar={onExpulsar} onVotarExpulsao={onVotarExpulsao} />
          ))}
        </div>
      ) : (
        <div className="voice-faces">
          <div className={`voice-face ${voice.self.speaking ? 'falando' : ''}`}>
            <Avatar user={me} size={56} />
            <span>{me.username}</span>
          </div>
          {voice.peers.map((peer) => (
            <div key={peer.socketId} className={`voice-face ${peer.speaking ? 'falando' : ''}`}>
              <Avatar user={peer.user ?? { username: '?' }} size={56} />
              <span>{peer.user?.username ?? 'conectando...'}</span>
              <span className="voice-face-acoes">
                <AcaoExpulsar
                  podeExpulsar={podeExpulsar}
                  votacao={votacoes[peer.socketId] ?? null}
                  onExpulsar={() => onExpulsar(peer.socketId)}
                  onVotarExpulsao={() => onVotarExpulsao(peer.socketId)}
                />
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
