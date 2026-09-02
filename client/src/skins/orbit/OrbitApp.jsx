import { forwardRef, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api.js';
import AcoesDaMensagem from '../../components/AcoesDaMensagem.jsx';
import { AtividadeResumo } from '../../components/Atividade.jsx';
import Avatar from '../../components/Avatar.jsx';
import { Anexo, Conteudo, ItemFixado, Reacoes, shouldGroup } from '../../components/ChatView.jsx';
import { corDoMembro, nomeExibido } from '../../lib/cargos.js';
import { cropStyle } from '../../lib/cropStyle.js';
import { useMensagensNovas } from '../../lib/mensagensNovas.js';
import { usePunch } from '../../lib/usePunch.js';
import GifPicker from '../../components/GifPicker.jsx';
import CinemaHome from '../../components/CinemaHome.jsx';
import Icon from '../../components/Icon.jsx';
import { IndicadorDeSolte, LinhaDeVoz } from '../../components/ChannelSidebar.jsx';
import LinkPreview from '../../components/LinkPreview.jsx';
import MemberList from '../../components/MemberList.jsx';
import VoicePanel from '../../components/VoicePanel.jsx';
import VoiceStage, { VoiceAudioSink } from '../../components/VoiceStage.jsx';
import './orbit.css';

/**
 * "Versão de teste" (Orbit): a mesma pele visual que o João desenhou como
 * protótipo estático, só que aqui em cima dos dados e ações DE VERDADE do
 * app (guild/canais/mensagens/voz vêm todos de App.jsx via props - nada
 * aqui inventa estado próprio de mensagem). Ainda não cobre tudo que a
 * interface clássica cobre (amigos, threads, inbox, temas) - isso é o que
 * "vamos melhorando" quer dizer; o que já existe aqui manda mensagem de
 * verdade, entra em canal de voz de verdade, etc.
 */

const horaCurta = (ts) => new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const diaCurto = (ts) => new Date(ts).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });

function agruparCanais(canais, categorias) {
  const texto = canais.filter((c) => c.type === 'text');
  const voz = canais.filter((c) => c.type === 'voice');
  const soltos = texto.filter((c) => !c.categoryId);
  const grupos = (categorias ?? [])
    .map((cat) => ({ cat, canais: texto.filter((c) => c.categoryId === cat.id) }))
    .sort((a, b) => a.cat.position - b.cat.position);
  return { soltos, grupos, voz };
}

function ServerRail({ guilds, activeGuildId, dmMode, onSelectGuild, onOpenDms, onCreateGuild, onJoinGuild, onOpenCinema, onReportarBug }) {
  return (
    <nav className="orbit-rail" aria-label="Servidores">
      <button className={`orbit-server-icon orbit-home ${dmMode ? 'orbit-active' : ''}`} title="Amigos e mensagens diretas" onClick={onOpenDms}>
        <Icon name="sparkles" size={20} />
      </button>
      <div className="orbit-rail-divider" />
      {guilds.map((g) => (
        <button
          key={g.id}
          className={`orbit-server-icon ${!dmMode && g.id === activeGuildId ? 'orbit-active' : ''}`}
          title={g.name}
          onClick={() => onSelectGuild(g.id)}
        >
          {g.iconUrl
            ? <span className="orbit-server-icon-img"><img key={g.iconUrl} src={g.iconUrl} alt="" style={cropStyle(g.iconCrop)} /></span>
            : g.name.slice(0, 2).toUpperCase()}
        </button>
      ))}
      <button className="orbit-server-icon orbit-add" title="Criar servidor" onClick={onCreateGuild}>
        <Icon name="plus" size={18} />
      </button>
      <button className="orbit-server-icon orbit-subtle" title="Entrar com convite" onClick={onJoinGuild}>
        <Icon name="arrow-right" size={18} />
      </button>
      <div className="orbit-rail-divider" />
      <button className="orbit-server-icon orbit-cinema" title="Cinema" onClick={onOpenCinema}>
        <Icon name="film" size={18} />
      </button>
      <button className="orbit-server-icon orbit-alerta" title="Reportar um problema" onClick={onReportarBug}>
        <Icon name="alert-triangle" size={18} />
      </button>
    </nav>
  );
}

function ChannelSidebar({
  guild, activeChannelId, onSelectChannel, onToggleVoiceChannel, voice, voiceActions, voiceRooms,
  me, connected, onOpenSettings, onOpenProfile, onMenuDoParticipanteDeVoz, onMenuDaGuild,
  // arrastar: reordenar canal e puxar gente pra uma call - mesmo mecanismo
  // da pele clássica (ver ChannelSidebar.jsx), só que aqui em cima dos
  // botões `orbit-channel-row`.
  podeOrdenarCanais = false, podeMoverNaCall = false, onReordenarCanais, onPuxarParaCall, onMoverParaFim, arrasto,
  minhaAtividade,
}) {
  const [fechadas, setFechadas] = useState(() => new Set());
  const { soltos, grupos, voz } = useMemo(
    () => agruparCanais(guild?.channels ?? [], guild?.categories),
    [guild],
  );

  // Quem está falando: só dá pra saber de quem está na MESMA chamada que eu
  // (é a única com WebRTC conectado) - nas outras salas o app só sabe quem
  // entrou, não quem tá com a boca aberta.
  const falando = new Map(voice.peers.map((p) => [p.socketId, p.speaking]));
  if (voice.socketId) falando.set(voice.socketId, voice.self.speaking);

  const alternar = (id) => setFechadas((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  /*
   * Soltar um canal em cima de outro troca os dois de lugar e manda a ordem
   * inteira pro servidor. Só quem pode gerenciar canais arrasta.
   */
  const soltarCanal = (channel) => arrasto.soltarEm(
    `canal:${channel.id}`,
    (carga) => carga.tipo === 'canal' && carga.id !== channel.id && carga.channelType === channel.type,
    (carga, metade) => onReordenarCanais?.(carga.id, channel.id, metade),
    { comMetade: true },
  );

  /** Puxar alguém pra um canal de voz: participante de outra call ou membro da lista. */
  const soltarPessoa = (channel) => arrasto.soltarEm(
    `voz:${channel.id}`,
    (carga) => (carga.tipo === 'voz-participante' || carga.tipo === 'membro')
      && carga.channelId !== channel.id,
    (carga) => onPuxarParaCall?.(carga, channel),
  );

  /*
   * Zona depois do último canal de um tipo: solta ali e o canal vai pro fim
   * daquele tipo, sem precisar acertar o pixel da última vaga.
   */
  const soltarNoFim = (tipo) => arrasto.soltarEm(
    `fim:${tipo}`,
    (carga) => carga.tipo === 'canal' && carga.channelType === tipo,
    (carga) => onMoverParaFim?.(carga.id, tipo),
  );

  // Só ganham altura ENQUANTO se arrasta um canal - o resto do tempo ficam
  // com altura zero (ver CSS), pra não engordar o espaço entre as seções.
  const arrastandoCanal = arrasto.arrastando?.tipo === 'canal';

  /*
   * O arrasto sai do BOTÃO, não de um wrapper - `orbit-channel-row` é ele
   * mesmo o elemento clicável inteiro (não tem filho <button> competindo),
   * então o mesmo elemento serve de fonte do arrasto sem o problema que
   * `.channel-btn` tinha na pele clássica.
   */
  const arrastavelDoCanal = (channel) => (podeOrdenarCanais ? {
    draggable: true,
    onDragStart: arrasto.comecar({
      tipo: 'canal',
      id: channel.id,
      channelType: channel.type,
      rotulo: channel.name,
      icone: channel.type === 'voice' ? '🔊' : '#',
    }),
    onDragEnd: arrasto.terminar,
  } : null);

  const linhaCanal = (c) => (
    <div key={c.id} className="linha-de-canal">
      {arrasto.pairandoEm(`canal:${c.id}`) && (
        <IndicadorDeSolte posicao={arrasto.metadeEm(`canal:${c.id}`)} />
      )}
      <div {...soltarCanal(c)}>
        <button
          className={`orbit-channel-row ${activeChannelId === c.id ? 'orbit-channel-selected' : ''} ${arrasto.arrastando?.id === c.id ? 'sendo-arrastado' : ''}`}
          onClick={() => onSelectChannel(c.id)}
          {...arrastavelDoCanal(c)}
        >
          <Icon name="hash" size={17} />
          <span className="orbit-truncate">{c.name}</span>
        </button>
      </div>
    </div>
  );

  const linhaVoz = (c) => {
    const dentro = voice.channelId === c.id;
    const participantes = voiceRooms[c.id] ?? [];
    // Um canal de voz recebe duas coisas diferentes: outro canal de voz (pra
    // trocar de ordem) e uma pessoa (pra ser puxada pra cá).
    const receber = soltarPessoa(c) ?? soltarCanal(c);
    const recebendoPessoa = arrasto.pairandoEm(`voz:${c.id}`);

    return (
      <div key={c.id} className="linha-de-canal">
        {arrasto.pairandoEm(`canal:${c.id}`) && (
          <IndicadorDeSolte posicao={arrasto.metadeEm(`canal:${c.id}`)} />
        )}
        <div {...receber}>
          <button
            className={[
              'orbit-channel-row',
              dentro ? 'orbit-channel-selected' : '',
              recebendoPessoa ? 'recebendo-pessoa' : '',
              arrasto.arrastando?.id === c.id ? 'sendo-arrastado' : '',
            ].filter(Boolean).join(' ')}
            onClick={() => onToggleVoiceChannel(c.id)}
            {...arrastavelDoCanal(c)}
          >
            <Icon name="headphones" size={16} />
            <span className="orbit-truncate">{c.name}</span>
            {participantes.length > 0 && <span className="orbit-member-count">{participantes.length}</span>}
          </button>
        </div>
        <LinhaDeVoz
          participantes={participantes}
          falando={falando}
          meId={me.id}
          onMenuDoParticipante={onMenuDoParticipanteDeVoz}
          podeArrastar={(p) => p.user.id === me.id || podeMoverNaCall}
          aoArrastar={(p) => arrasto.comecar({
            tipo: 'voz-participante',
            id: p.socketId,
            userId: p.user.id,
            channelId: c.id,
            rotulo: p.user.username,
            icone: '🔊',
          })}
          aoSoltarArrasto={arrasto.terminar}
          previa={recebendoPessoa ? arrasto.arrastando : null}
        />
      </div>
    );
  };

  return (
    <aside className="orbit-channel-sidebar">
      <button
        className="orbit-server-header orbit-server-header-botao"
        title="Opções do servidor"
        onClick={onMenuDaGuild}
        onContextMenu={onMenuDaGuild}
      >
        <span className="orbit-truncate">{guild?.name ?? 'Nenhum servidor'}</span>
        <Icon name="chevron-down" size={15} />
      </button>
      <div className="orbit-channel-list">
        {soltos.map(linhaCanal)}
        {grupos.map(({ cat, canais }) => (
          <section key={cat.id}>
            <button className="orbit-group-label" onClick={() => alternar(cat.id)}>
              <Icon name={fechadas.has(cat.id) ? 'chevron-right' : 'chevron-down'} size={13} />
              {cat.name.toUpperCase()}
            </button>
            {!fechadas.has(cat.id) && <div className="orbit-group-body">{canais.map(linhaCanal)}</div>}
          </section>
        ))}
        {/* Zona de soltar depois do último canal de texto: só existe no DOM
            enquanto se arrasta um canal - ver o comentário equivalente em
            ChannelSidebar.jsx (o `gap` do flex-column soma dos dois lados
            de qualquer item, mesmo vazio, e isso dobrava o respiro entre as
            seções o tempo todo, mesmo sem arrasto nenhum acontecendo). */}
        {arrastandoCanal && (
          <div className="linha-de-canal">
            {arrasto.pairandoEm('fim:text') && <IndicadorDeSolte posicao="antes" />}
            <div className="zona-fim-canais" {...soltarNoFim('text')} />
          </div>
        )}

        {voz.length > 0 && (
          <section>
            <span className="orbit-group-label orbit-group-label-static">CANAIS DE VOZ</span>
            <div className="orbit-group-body">{voz.map(linhaVoz)}</div>
          </section>
        )}

        {/* Essa cresce (`preenche`): é a última coisa da lista, então
            qualquer espaço vazio até o fim da barra vira zona de soltar. */}
        {arrastandoCanal && (
          <div className="linha-de-canal preenche">
            {arrasto.pairandoEm('fim:voice') && <IndicadorDeSolte posicao="antes" />}
            <div className="zona-fim-canais" {...soltarNoFim('voice')} />
          </div>
        )}
      </div>

      <VoicePanel voice={voice} channelName={guild?.channels.find((c) => c.id === voice.channelId)?.name ?? 'chamada'} actions={voiceActions} />

      <div className="orbit-user-panel">
        <Avatar user={me} size={32} onClick={() => onOpenProfile(me.id)} />
        <div className="orbit-user-panel-info">
          <p className="orbit-truncate">{me.username}</p>
          <p className="orbit-user-panel-status">
            {connected && minhaAtividade
              ? <AtividadeResumo atividade={minhaAtividade} />
              : (connected ? 'online' : 'reconectando...')}
          </p>
        </div>
        <button className="orbit-icon-button" title="Configurações" onClick={onOpenSettings}>
          <Icon name="settings" size={17} />
        </button>
      </div>
    </aside>
  );
}

function Composer({ placeholder, onSend, onTyping }) {
  const [draft, setDraft] = useState('');
  const [anexo, setAnexo] = useState(null);
  const [enviandoAnexo, setEnviandoAnexo] = useState(false);
  const [erro, setErro] = useState(null);
  const [gifAberto, setGifAberto] = useState(false);
  const arquivoRef = useRef(null);

  function escolherGif(gif) {
    setAnexo({ url: gif.url, type: 'gif', name: null });
    setGifAberto(false);
  }

  async function anexarArquivo(arquivo) {
    if (!arquivo) return;
    setErro(null);
    setEnviandoAnexo(true);
    try {
      const { attachment } = await api.uploadAttachment(arquivo);
      setAnexo(attachment);
    } catch (err) {
      setErro(err.message);
    } finally {
      setEnviandoAnexo(false);
    }
  }

  const [lancando, dispararLancar] = usePunch(260, 'lancar');

  const enviar = () => {
    const texto = draft.trim();
    if (!texto && !anexo) return;
    if (enviandoAnexo) return;
    onSend(texto, anexo);
    setDraft('');
    setAnexo(null);
    dispararLancar();
  };

  return (
    <div className="orbit-composer-wrap">
      {(anexo || enviandoAnexo) && (
        <div className="orbit-anexo-preview">
          {enviandoAnexo ? <span className="orbit-muted">Enviando...</span> : <Anexo anexo={anexo} />}
          {anexo && (
            <button type="button" onClick={() => setAnexo(null)} aria-label="Remover anexo">
              <Icon name="x" size={14} />
            </button>
          )}
        </div>
      )}
      {erro && <div className="orbit-error">{erro}</div>}
      <div className="orbit-composer">
        <input
          ref={arquivoRef}
          type="file"
          hidden
          onChange={(e) => { anexarArquivo(e.target.files?.[0]); e.target.value = ''; }}
        />
        <button
          type="button"
          className="orbit-composer-icon"
          aria-label="Anexar arquivo"
          onClick={() => arquivoRef.current?.click()}
        >
          <Icon name="plus" size={18} />
        </button>
        <textarea
          value={draft}
          onChange={(e) => { setDraft(e.target.value); onTyping?.(); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); enviar(); }
          }}
          onPaste={(e) => {
            const arquivo = [...e.clipboardData?.items ?? []]
              .find((item) => item.kind === 'file' && item.type.startsWith('image/'))
              ?.getAsFile();
            if (!arquivo) return;
            e.preventDefault();
            anexarArquivo(arquivo);
          }}
          placeholder={placeholder}
          rows={1}
        />
        {/* Dentro da mesma barra do campo - embutido, não um botão solto ao
            lado, igual ao Discord. */}
        <div className="orbit-composer-gif-wrap">
          <button
            type="button"
            className={`orbit-composer-gif ${gifAberto ? 'ativo' : ''}`}
            title="Enviar GIF"
            onClick={() => setGifAberto((v) => !v)}
          >
            GIF
          </button>
          {gifAberto && <GifPicker onEscolher={escolherGif} onFechar={() => setGifAberto(false)} />}
        </div>
        <button className={`orbit-send-button ${lancando}`} aria-label="Enviar mensagem" onClick={enviar}>
          <Icon name="send" size={16} />
        </button>
      </div>
    </div>
  );
}

/**
 * Mensagem individual dentro de um bloco. `agrupada` = mesma pessoa que a
 * de cima, em menos de 5 min (ver shouldGroup, importado do ChatView
 * clássico - a regra é a mesma dos dois lados). Só a primeira do bloco
 * mostra avatar/nome/hora; as de baixo só mostram a hora, e só ao passar o
 * mouse - exatamente como o Discord de verdade, pra não empilhar foto e
 * nome repetido a cada linha.
 */
function LinhaDeMensagem({ m, agrupada, onOpenProfile, membros, meuId, roles, nova, onMenu, acoes }) {
  const membro = membros?.find((mb) => mb.id === m.author.id);
  const cor = corDoMembro(membro, roles);
  return (
    <article
      data-msg={m.id}
      onContextMenu={onMenu?.(m)}
      className={[
        'orbit-message-row',
        m.pending ? 'orbit-pending' : '',
        agrupada ? 'orbit-agrupada' : '',
        nova ? 'nova' : '',
      ].filter(Boolean).join(' ')}
    >
      {acoes && !m.pending && (
        <AcoesDaMensagem
          message={m}
          onReagir={acoes.onReagir}
          onEncaminhar={acoes.onEncaminhar}
          onMais={onMenu?.(m)}
        />
      )}
      {agrupada
        ? <span className="orbit-message-hora-fixa">{horaCurta(m.createdAt)}</span>
        : <Avatar user={m.author} size={38} onClick={() => onOpenProfile(m.author.id)} />}
      <div className="orbit-message-body">
        {!agrupada && (
          <div className="orbit-message-head">
            <button
              className="orbit-message-author"
              style={cor ? { color: cor } : undefined}
              onClick={() => onOpenProfile(m.author.id)}
            >
              {membro ? nomeExibido(membro) : m.author.username}
            </button>
            <span className="orbit-message-time">{horaCurta(m.createdAt)}</span>
            {m.editedAt && <span className="orbit-message-time">(editada)</span>}
          </div>
        )}
        {m.replyTo && (
          <div className="orbit-reply-linha">
            <span className="orbit-reply-gancho" />
            <span className="orbit-reply-autor">{m.replyTo.username}</span>
            <span className="orbit-reply-texto">{m.replyTo.content || 'anexo'}</span>
          </div>
        )}
        <p className="orbit-message-text">
          <Conteudo texto={m.content} membros={membros} meuId={meuId} />
          {agrupada && m.editedAt && <span className="orbit-message-time"> (editada)</span>}
        </p>
        <Anexo anexo={m.attachment} />
        <LinkPreview texto={m.content} />
        {acoes?.onReagir && !m.pending && (
          <Reacoes
            reactions={m.reactions}
            meuId={meuId}
            onReagir={(emoji) => acoes.onReagir(m.id, emoji)}
            // A carinha abre o menu da mensagem, que já tem a fileira de
            // reação no topo - assim o Orbit não precisa de um seletor de
            // emoji próprio só pra oferecer os mesmos seis.
            onAbrirEmoji={onMenu?.(m)}
          />
        )}
      </div>
    </article>
  );
}

const ListaDeMensagens = forwardRef(function ListaDeMensagens(
  { mensagens, onOpenProfile, membros, meuId, roles, marcadorId, onScroll, chave, onMenuDaMensagem, acoesDaMensagem },
  ref,
) {
  const novas = useMensagensNovas(mensagens, chave);
  let ultimoDia = null;
  return (
    <div className="orbit-messages" ref={ref} onScroll={onScroll}>
      {mensagens.length === 0 && (
        <div className="orbit-channel-intro">
          <div className="orbit-intro-mark"><Icon name="hash" size={22} /></div>
          <h2>Comece a conversa por aqui</h2>
          <p className="orbit-muted">Ainda não tem nenhuma mensagem.</p>
        </div>
      )}
      {mensagens.map((m, i) => {
        const dia = diaCurto(m.createdAt);
        const mostrarDivisor = dia !== ultimoDia;
        ultimoDia = dia;
        // Dia novo sempre começa bloco novo, senão a hora sozinha (sem
        // avatar) ficaria sem contexto de qual dia é.
        const agrupada = !mostrarDivisor && shouldGroup(mensagens[i - 1], m);
        return (
          <div key={m.id ?? m.nonce}>
            {mostrarDivisor && <div className="orbit-date-divider"><span>{dia}</span></div>}
            {m.id === marcadorId && (
              <div className="orbit-novas-mensagens"><span>NOVAS MENSAGENS</span></div>
            )}
            <LinhaDeMensagem
              m={m}
              agrupada={agrupada}
              nova={novas.has(m.id)}
              onMenu={onMenuDaMensagem}
              acoes={acoesDaMensagem}
              onOpenProfile={onOpenProfile}
              membros={membros}
              meuId={meuId}
              roles={roles}
            />
          </div>
        );
      })}
    </div>
  );
});

/** Fixadas e busca puxam da API de verdade - nada de dado fixo aqui. */
function CabecalhoDeCanal({ channel, membrosVisiveis, onAlternarMembros }) {
  const [pinsAbertos, setPinsAbertos] = useState(false);
  const [pins, setPins] = useState([]);
  const [buscaAberta, setBuscaAberta] = useState(false);
  const [termo, setTermo] = useState('');
  const [resultados, setResultados] = useState(null);

  useEffect(() => { setPinsAbertos(false); setBuscaAberta(false); }, [channel.id]);

  async function abrirPins() {
    const abrindo = !pinsAbertos;
    setPinsAbertos(abrindo);
    setBuscaAberta(false);
    if (abrindo) {
      try { setPins((await api.pins(channel.id)).messages); } catch { setPins([]); }
    }
  }

  async function buscar(e) {
    e.preventDefault();
    if (!termo.trim()) return;
    try { setResultados((await api.buscarNoCanal(channel.id, termo.trim())).messages); } catch { setResultados([]); }
  }

  return (
    <header className="orbit-channel-header">
      <Icon name="hash" size={19} />
      <h1>{channel.name}</h1>
      <div className="orbit-header-acoes">
        <button className="orbit-icon-button" title="Mensagens fixadas" onClick={abrirPins}>
          <Icon name="pin" size={17} />
        </button>
        <button
          className={`orbit-icon-button ${membrosVisiveis ? 'orbit-ativo' : ''}`}
          title={membrosVisiveis ? 'Esconder membros' : 'Mostrar membros'}
          onClick={onAlternarMembros}
        >
          <Icon name="users" size={17} />
        </button>
        <button
          className={`orbit-icon-button ${buscaAberta ? 'orbit-ativo' : ''}`}
          title="Buscar no canal"
          onClick={() => { setBuscaAberta((v) => !v); setPinsAbertos(false); }}
        >
          <Icon name="search" size={16} />
        </button>
      </div>

      {pinsAbertos && (
        <>
          <div className="orbit-click-fora" onClick={() => setPinsAbertos(false)} />
          <div className="orbit-popover">
            <h4>Mensagens fixadas</h4>
            {pins.length === 0 && <p className="orbit-muted">Nada fixado neste canal ainda.</p>}
            {/* Mesmo item da pele clássica: avatar de quem mandou e
                miniatura quando a fixada é uma foto. */}
            {pins.map((p) => <ItemFixado key={p.id} pin={p} onIr={() => setPinsAbertos(false)} />)}
          </div>
        </>
      )}

      {buscaAberta && (
        <>
          <div className="orbit-click-fora" onClick={() => setBuscaAberta(false)} />
          <div className="orbit-popover orbit-popover-busca">
            <form onSubmit={buscar}>
              <input
                autoFocus
                value={termo}
                onChange={(e) => setTermo(e.target.value)}
                placeholder={`Buscar em #${channel.name}`}
              />
            </form>
            {resultados?.length === 0 && <p className="orbit-muted">Nada encontrado.</p>}
            {resultados?.map((m) => (
              <div key={m.id} className="orbit-popover-item">
                <strong>{m.author.username}</strong>
                <p>{m.content}</p>
              </div>
            ))}
          </div>
        </>
      )}
    </header>
  );
}

function ChatMain({
  channel, messages, onSend, onTyping, typingUsers, onOpenProfile, error,
  membrosVisiveis, onAlternarMembros, membros, meuId, roles, naoLidasAoAbrir = 0,
  onMenuDaMensagem, acoesDaMensagem,
}) {
  const [marcadorId, setMarcadorId] = useState(null);
  const scrollRef = useRef(null);
  const stickToBottom = useRef(true);
  const posicionouNaoLida = useRef(false);

  // Mesma regra do clássico: canal com não lida abre em cima da primeira
  // mensagem não lida (com o divisor vermelho), só desce pro fim quando já
  // tava tudo lido. Uma vez posicionado, volta a ser scroll normal.
  useLayoutEffect(() => {
    if (!posicionouNaoLida.current && naoLidasAoAbrir > 0 && messages.length > 0) {
      const indice = Math.max(0, messages.length - naoLidasAoAbrir);
      const alvo = messages[indice];
      posicionouNaoLida.current = true;
      if (alvo) {
        setMarcadorId(alvo.id);
        stickToBottom.current = false;
        scrollRef.current?.querySelector(`[data-msg="${alvo.id}"]`)?.scrollIntoView({ block: 'start' });
        return;
      }
    }
    if (stickToBottom.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, channel?.id, naoLidasAoAbrir]);

  useEffect(() => {
    stickToBottom.current = naoLidasAoAbrir === 0;
    posicionouNaoLida.current = false;
    setMarcadorId(null);
  }, [channel?.id]);

  function aoRolar(e) {
    const el = e.currentTarget;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  }

  return (
    <section className="orbit-chat-main">
      <CabecalhoDeCanal channel={channel} membrosVisiveis={membrosVisiveis} onAlternarMembros={onAlternarMembros} />
      <div className="orbit-message-area">
        <ListaDeMensagens
          ref={scrollRef}
          onScroll={aoRolar}
          mensagens={messages}
          chave={channel?.id}
          onMenuDaMensagem={onMenuDaMensagem}
          acoesDaMensagem={acoesDaMensagem}
          onOpenProfile={onOpenProfile}
          membros={membros}
          meuId={meuId}
          roles={roles}
          marcadorId={marcadorId}
        />
        {typingUsers.length > 0 && (
          <div className="orbit-typing">
            <span className="orbit-typing-dots"><i /><i /><i /></span>
            {typingUsers.join(', ')} {typingUsers.length > 1 ? 'estão digitando...' : 'está digitando...'}
          </div>
        )}
        {error && <div className="orbit-error">{error}</div>}
        <Composer placeholder={`Conversar em #${channel.name}`} onSend={onSend} onTyping={onTyping} />
      </div>
    </section>
  );
}

function DmSidebar({ dms, activeDmId, onlineIds, onSelectDm, onNovaConversa }) {
  return (
    <aside className="orbit-channel-sidebar">
      <div className="orbit-server-header"><span>Mensagens diretas</span>
        <button className="orbit-icon-button" title="Nova conversa" onClick={onNovaConversa}><Icon name="plus" size={16} /></button>
      </div>
      <div className="orbit-channel-list">
        {dms.length === 0 && <p className="orbit-muted orbit-dm-empty">Nenhuma conversa ainda.</p>}
        {dms.map((c) => (
          <button
            key={c.id}
            className={`orbit-dm-entry ${activeDmId === c.id ? 'orbit-channel-selected' : ''}`}
            onClick={() => onSelectDm(c.id)}
          >
            <span className="orbit-dm-avatar">
              <Avatar user={c.otherUser} size={32} />
              {onlineIds.has(c.otherUser.id) && <span className="orbit-online-dot" />}
            </span>
            <span className="orbit-truncate">{c.otherUser.username}</span>
          </button>
        ))}
      </div>
    </aside>
  );
}

function DmMain({ activeDm, messages, onSend, onOpenProfile }) {
  if (!activeDm) {
    return (
      <section className="orbit-chat-main orbit-chat-empty">
        <p className="orbit-muted">Escolhe uma conversa na barra ao lado, ou clica em + pra começar uma.</p>
      </section>
    );
  }
  return (
    <section className="orbit-chat-main">
      <header className="orbit-channel-header">
        <Icon name="message-circle" size={18} />
        <h1>{activeDm.otherUser.username}</h1>
      </header>
      <div className="orbit-message-area">
        <ListaDeMensagens mensagens={messages} chave={activeDm.id} onOpenProfile={onOpenProfile} />
        <Composer placeholder={`Mensagem para @${activeDm.otherUser.username}`} onSend={onSend} />
      </div>
    </section>
  );
}

export default function OrbitApp({
  me, guilds, guild, activeGuildId, dmMode, dms, activeDm, activeDmId, onlineIds,
  activeChannel, messages, dmMessages, typingUsers, sendError, connected,
  voice, voiceActions, callMaximizada, voiceVotacoes, voiceWatch,
  onSelectGuild, onOpenDms, onSelectChannel, onSelectDm, onToggleVoiceChannel,
  onSend, onSendDm, onTyping, onNovaConversa,
  onCreateGuild, onJoinGuild, onOpenSettings, onOpenProfile,
  onMinimizarCall, onExpulsarDaCall, onVotarExpulsaoDaCall,
  telaAssistida, onAssistir, onPararDeAssistir, onOpenApps, onOpenCinema, cinemaAberto, onCloseCinema, onErroCinema,
  presencas, minhaAtividade, membrosVisiveis, onAlternarMembros, onPromote, onKick,
  podeChamarParaCall, podeModerarVoz, onChamarParaCall, onMenuDoMembro, onReportarBug,
  voiceRooms, onMenuDoParticipanteDeVoz, naoLidasAoAbrir, onMenuDaGuild, onMenuDaMensagem, acoesDaMensagem,
  podeOrdenarCanais, podeMoverNaCall, onReordenarCanais, onPuxarParaCall, onMoverParaFim, arrasto, aoArrastarMembro,
}) {
  const semServidor = !dmMode && guilds.length === 0;

  return (
    <div className="orbit-shell" data-theme="discord-dark">
      {/* Independente de qualquer tela estar aberta - sem isso o áudio de
          quem tá na call nunca toca pra quem usa a versão de teste. */}
      <VoiceAudioSink voice={voice} />
<ServerRail
        guilds={guilds}
        activeGuildId={activeGuildId}
        dmMode={dmMode}
        onSelectGuild={onSelectGuild}
        onOpenDms={onOpenDms}
        onCreateGuild={onCreateGuild}
        onJoinGuild={onJoinGuild}
        onOpenCinema={onOpenCinema}
        onReportarBug={onReportarBug}
      />

      {!cinemaAberto && (dmMode ? (
        <DmSidebar
          dms={dms}
          activeDmId={activeDmId}
          onlineIds={onlineIds}
          onSelectDm={onSelectDm}
          onNovaConversa={onNovaConversa}
        />
      ) : (
        <ChannelSidebar
          guild={guild}
          activeChannelId={activeChannel?.id ?? null}
          onSelectChannel={onSelectChannel}
          onToggleVoiceChannel={onToggleVoiceChannel}
          voice={voice}
          voiceActions={voiceActions}
          voiceRooms={voiceRooms}
          onMenuDoParticipanteDeVoz={onMenuDoParticipanteDeVoz}
          me={me}
          connected={connected}
          onOpenSettings={onOpenSettings}
          onOpenProfile={onOpenProfile}
          onMenuDaGuild={onMenuDaGuild}
          minhaAtividade={minhaAtividade}
          podeOrdenarCanais={podeOrdenarCanais}
          podeMoverNaCall={podeMoverNaCall}
          onReordenarCanais={onReordenarCanais}
          onPuxarParaCall={onPuxarParaCall}
          onMoverParaFim={onMoverParaFim}
          arrasto={arrasto}
        />
      ))}

      {cinemaAberto ? (
        <CinemaHome onClose={onCloseCinema} onErro={onErroCinema} />
      ) : callMaximizada && voice.channelId ? (
        <VoiceStage
          voice={voice}
          me={me}
          channelName={guild?.channels.find((c) => c.id === voice.channelId)?.name ?? 'chamada'}
          onMinimizar={onMinimizarCall}
          podeExpulsar={false}
          votacoes={voiceVotacoes}
          onExpulsar={onExpulsarDaCall}
          onVotarExpulsao={onVotarExpulsaoDaCall}
          voiceActions={voiceActions}
          podeModerarVoz={podeModerarVoz}
          telaAssistida={telaAssistida}
          onAssistir={onAssistir}
          onPararDeAssistir={onPararDeAssistir}
          watchSession={voiceWatch}
          onOpenApps={onOpenApps}
          onStopWatch={async (sessionId) => {
            const resposta = await voiceActions.watchStop(voice.channelId, sessionId);
            if (resposta?.error) console.warn(resposta.error);
          }}
          onJoinWatch={(sessionId) => voiceActions.watchJoin(voice.channelId, sessionId)}
          onLeaveWatch={(sessionId) => voiceActions.watchLeave(voice.channelId, sessionId)}
          onProposeWatch={(sessionId, control) => voiceActions.watchProposeControl(voice.channelId, sessionId, control)}
          onVoteWatch={(proposalId, approve) => voiceActions.watchVoteControl(voice.channelId, proposalId, approve)}
        />
      ) : dmMode ? (
        <DmMain
          activeDm={activeDm}
          messages={dmMessages}
          onSend={onSendDm}
          onOpenProfile={onOpenProfile}
        />
      ) : semServidor ? (
        <section className="orbit-chat-main orbit-chat-empty">
          <p className="orbit-muted">Você ainda não está em nenhum servidor.</p>
          <div className="orbit-empty-actions">
            <button className="orbit-primary-action" onClick={onCreateGuild}>Criar um servidor</button>
            <button onClick={onJoinGuild}>Entrar com um convite</button>
          </div>
        </section>
      ) : activeChannel ? (
        <ChatMain
          channel={activeChannel}
          messages={messages}
          onSend={onSend}
          onTyping={onTyping}
          typingUsers={typingUsers}
          onOpenProfile={onOpenProfile}
          error={sendError}
          membrosVisiveis={membrosVisiveis}
          onAlternarMembros={onAlternarMembros}
          membros={guild?.members}
          meuId={me.id}
          roles={guild?.roles}
          naoLidasAoAbrir={naoLidasAoAbrir}
          onMenuDaMensagem={onMenuDaMensagem}
          acoesDaMensagem={acoesDaMensagem}
        />
      ) : (
        <section className="orbit-chat-main orbit-chat-empty">
          <p className="orbit-muted">Escolhe um canal na barra ao lado.</p>
        </section>
      )}

      {!cinemaAberto && !dmMode && !(callMaximizada && voice.channelId) && (
        <MemberList
          guild={guild}
          presencas={presencas}
          meId={me.id}
          visivel={membrosVisiveis}
          onOpenProfile={(member) => onOpenProfile(member.id)}
          onPromote={onPromote}
          onKick={onKick}
          podeChamarParaCall={podeChamarParaCall}
          onChamarParaCall={onChamarParaCall}
          onMenuDoMembro={onMenuDoMembro}
          membroArrastavel={podeMoverNaCall || Boolean(voice.channelId)}
          aoArrastarMembro={aoArrastarMembro}
          aoSoltarMembro={arrasto?.terminar}
        />
      )}
    </div>
  );
}
