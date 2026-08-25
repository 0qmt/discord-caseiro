import { forwardRef, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api.js';
import Avatar from '../../components/Avatar.jsx';
import { Anexo, Conteudo, shouldGroup } from '../../components/ChatView.jsx';
import { corDoMembro, nomeExibido } from '../../lib/cargos.js';
import Icon from '../../components/Icon.jsx';
import { LinhaDeVoz } from '../../components/ChannelSidebar.jsx';
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

function ServerRail({ guilds, activeGuildId, dmMode, onSelectGuild, onOpenDms, onCreateGuild, onJoinGuild, onReportarBug }) {
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
            ? <span className="orbit-server-icon-img"><img src={g.iconUrl} alt="" /></span>
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
      <button className="orbit-server-icon orbit-alerta" title="Reportar um problema" onClick={onReportarBug}>
        <Icon name="alert-triangle" size={18} />
      </button>
    </nav>
  );
}

function ChannelSidebar({
  guild, activeChannelId, onSelectChannel, onToggleVoiceChannel, voice, voiceActions, voiceRooms,
  me, connected, onOpenSettings, onOpenProfile, onMenuDoParticipanteDeVoz,
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

  const linhaCanal = (c) => (
    <button
      key={c.id}
      className={`orbit-channel-row ${activeChannelId === c.id ? 'orbit-channel-selected' : ''}`}
      onClick={() => onSelectChannel(c.id)}
    >
      <Icon name="hash" size={17} />
      <span className="orbit-truncate">{c.name}</span>
    </button>
  );

  const linhaVoz = (c) => {
    const dentro = voice.channelId === c.id;
    const participantes = voiceRooms[c.id] ?? [];
    return (
      <div key={c.id}>
        <button
          className={`orbit-channel-row ${dentro ? 'orbit-channel-selected' : ''}`}
          onClick={() => onToggleVoiceChannel(c.id)}
        >
          <Icon name="headphones" size={16} />
          <span className="orbit-truncate">{c.name}</span>
          {participantes.length > 0 && <span className="orbit-member-count">{participantes.length}</span>}
        </button>
        <LinhaDeVoz
          participantes={participantes}
          falando={falando}
          meId={me.id}
          onMenuDoParticipante={onMenuDoParticipanteDeVoz}
        />
      </div>
    );
  };

  return (
    <aside className="orbit-channel-sidebar">
      <div className="orbit-server-header">
        <span>{guild?.name ?? 'Nenhum servidor'}</span>
      </div>
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
        {voz.length > 0 && (
          <section>
            <span className="orbit-group-label orbit-group-label-static">CANAIS DE VOZ</span>
            <div className="orbit-group-body">{voz.map(linhaVoz)}</div>
          </section>
        )}
      </div>

      <VoicePanel voice={voice} channelName={guild?.channels.find((c) => c.id === voice.channelId)?.name ?? 'chamada'} actions={voiceActions} />

      <div className="orbit-user-panel">
        <Avatar user={me} size={32} onClick={() => onOpenProfile(me.id)} />
        <div className="orbit-user-panel-info">
          <p className="orbit-truncate">{me.username}</p>
          <p className="orbit-user-panel-status">{connected ? 'online' : 'reconectando...'}</p>
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
  const arquivoRef = useRef(null);

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

  const enviar = () => {
    const texto = draft.trim();
    if (!texto && !anexo) return;
    if (enviandoAnexo) return;
    onSend(texto, anexo);
    setDraft('');
    setAnexo(null);
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
        <button className="orbit-send-button" aria-label="Enviar mensagem" onClick={enviar}>
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
function LinhaDeMensagem({ m, agrupada, onOpenProfile, membros, meuId, roles }) {
  const membro = membros?.find((mb) => mb.id === m.author.id);
  const cor = corDoMembro(membro, roles);
  return (
    <article
      data-msg={m.id}
      className={`orbit-message-row ${m.pending ? 'orbit-pending' : ''} ${agrupada ? 'orbit-agrupada' : ''}`}
    >
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
      </div>
    </article>
  );
}

const ListaDeMensagens = forwardRef(function ListaDeMensagens(
  { mensagens, onOpenProfile, membros, meuId, roles, marcadorId, onScroll },
  ref,
) {
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
            <LinhaDeMensagem m={m} agrupada={agrupada} onOpenProfile={onOpenProfile} membros={membros} meuId={meuId} roles={roles} />
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
            {pins.map((p) => (
              <div key={p.id} className="orbit-popover-item">
                <strong>{p.author.username}</strong>
                <p>{p.content || 'anexo'}</p>
              </div>
            ))}
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
        <ListaDeMensagens mensagens={messages} onOpenProfile={onOpenProfile} />
        <Composer placeholder={`Mensagem para @${activeDm.otherUser.username}`} onSend={onSend} />
      </div>
    </section>
  );
}

export default function OrbitApp({
  me, guilds, guild, activeGuildId, dmMode, dms, activeDm, activeDmId, onlineIds,
  activeChannel, messages, dmMessages, typingUsers, sendError, connected,
  voice, voiceActions, callMaximizada, voiceVotacoes,
  onSelectGuild, onOpenDms, onSelectChannel, onSelectDm, onToggleVoiceChannel,
  onSend, onSendDm, onTyping, onNovaConversa,
  onCreateGuild, onJoinGuild, onOpenSettings, onOpenProfile,
  onMinimizarCall, onExpulsarDaCall, onVotarExpulsaoDaCall,
  telaAssistida, onAssistir, onPararDeAssistir,
  onVoltarClassico,
  presencas, membrosVisiveis, onAlternarMembros, onPromote, onKick,
  podeChamarParaCall, onChamarParaCall, onMenuDoMembro, onReportarBug,
  voiceRooms, onMenuDoParticipanteDeVoz, naoLidasAoAbrir,
}) {
  const semServidor = !dmMode && guilds.length === 0;

  return (
    <div className="orbit-shell" data-theme="discord-dark">
      {/* Independente de qualquer tela estar aberta - sem isso o áudio de
          quem tá na call nunca toca pra quem usa a versão de teste. */}
      <VoiceAudioSink voice={voice} />

      <div className="orbit-beta-tag">
        Versão de teste
        <button onClick={onVoltarClassico}>voltar pra clássica</button>
      </div>

      <ServerRail
        guilds={guilds}
        activeGuildId={activeGuildId}
        dmMode={dmMode}
        onSelectGuild={onSelectGuild}
        onOpenDms={onOpenDms}
        onCreateGuild={onCreateGuild}
        onJoinGuild={onJoinGuild}
        onReportarBug={onReportarBug}
      />

      {dmMode ? (
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
        />
      )}

      {callMaximizada && voice.channelId ? (
        <VoiceStage
          voice={voice}
          me={me}
          channelName={guild?.channels.find((c) => c.id === voice.channelId)?.name ?? 'chamada'}
          onMinimizar={onMinimizarCall}
          podeExpulsar={false}
          votacoes={voiceVotacoes}
          onExpulsar={onExpulsarDaCall}
          onVotarExpulsao={onVotarExpulsaoDaCall}
          telaAssistida={telaAssistida}
          onAssistir={onAssistir}
          onPararDeAssistir={onPararDeAssistir}
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
        />
      ) : (
        <section className="orbit-chat-main orbit-chat-empty">
          <p className="orbit-muted">Escolhe um canal na barra ao lado.</p>
        </section>
      )}

      {!dmMode && !(callMaximizada && voice.channelId) && (
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
        />
      )}
    </div>
  );
}
