import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { corDoMembro, nomeExibido } from '../lib/cargos.js';
import { lerComando, sugestoes } from '../lib/comandos.js';
import { linkify } from '../lib/linkify.js';
import { codificarMencoes, mensagemMenciona } from '../lib/mencoes.js';
import Avatar from './Avatar.jsx';
import ContextMenu, { useContextMenu } from './ContextMenu.jsx';
import GifPicker from './GifPicker.jsx';
import Icon from './Icon.jsx';
import ImageLightbox from './ImageLightbox.jsx';
import LinkPreview from './LinkPreview.jsx';

const timeOf = (ts) =>
  new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

const dayOf = (ts) =>
  new Date(ts).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });

/** Os que aparecem no atalho de reagir, sem abrir seletor nenhum. */
const EMOJIS_RAPIDOS = ['👍', '❤️', '😂', '🔥', '😮', '😢', '🎉', '👀'];

/** Mensagens seguidas da mesma pessoa em ate 5 min viram um bloco so. */
export function shouldGroup(previous, message) {
  if (!previous) return false;
  if (previous.author.id !== message.author.id) return false;
  // Uma resposta sempre começa bloco novo: ela precisa da linha de cima
  // mostrando quem está sendo respondido.
  if (message.replyTo) return false;
  return message.createdAt - previous.createdAt < 5 * 60 * 1000;
}

/** Texto com URLs viráveis em link e <@id>/<@everyone> virando @nome destacado. */
/** ||spoiler||: fica borrado até clicar - clique não deve abrir link nenhum por baixo. */
function Spoiler({ texto }) {
  const [revelado, setRevelado] = useState(false);
  return (
    <span
      className={`spoiler ${revelado ? 'revelado' : ''}`}
      onClick={(e) => { e.stopPropagation(); setRevelado(true); }}
      title={revelado ? undefined : 'Clique pra revelar'}
    >
      {texto}
    </span>
  );
}

export function Conteudo({ texto, membros, meuId }) {
  if (!texto) return null;
  return linkify(texto).map((parte, i) => {
    if (typeof parte === 'string') return <span key={i}>{parte}</span>;
    if ('href' in parte) {
      return <a key={i} href={parte.href} target="_blank" rel="noreferrer noopener">{parte.texto}</a>;
    }
    if ('spoiler' in parte) return <Spoiler key={i} texto={parte.spoiler} />;
    if ('italico' in parte) return <em key={i}>{parte.italico}</em>;
    // menção
    const souEu = parte.mencao === 'everyone' || parte.mencao === meuId;
    const alvo = membros?.find((m) => m.id === parte.mencao);
    const nome = parte.mencao === 'everyone' ? 'everyone' : (alvo ? nomeExibido(alvo) : 'alguém');
    return <span key={i} className={`mencao ${souEu ? 'mim' : ''}`}>@{nome}</span>;
  });
}

export function Anexo({ anexo }) {
  const [aberta, setAberta] = useState(false);
  if (!anexo) return null;
  if (anexo.type === 'image' || anexo.type === 'gif') {
    return (
      <>
        <img
          className="anexo-imagem clicavel"
          src={anexo.url}
          alt={anexo.name ?? 'imagem'}
          loading="lazy"
          onClick={() => setAberta(true)}
        />
        {aberta && (
          <ImageLightbox src={anexo.url} nome={anexo.name} onClose={() => setAberta(false)} />
        )}
      </>
    );
  }
  if (anexo.type === 'video') {
    return <video className="anexo-video" src={anexo.url} controls />;
  }
  if (anexo.type === 'audio') {
    return <audio className="anexo-audio" src={anexo.url} controls />;
  }
  return (
    <a className="anexo-arquivo" href={anexo.url} download={anexo.name ?? undefined}>
      <span className="anexo-arquivo-icone"><Icon name="file" size={15} /></span>
      <span className="anexo-arquivo-nome">{anexo.name ?? 'arquivo'}</span>
    </a>
  );
}

const EVERYONE_BATE = (termo) => 'everyone'.startsWith(termo) || 'all'.startsWith(termo) || 'todos'.startsWith(termo);

/** Lista pra marcar alguém ou @everyone, aparece assim que digita "@". */
function MencaoPicker({ termo, membros, onEscolher }) {
  const termoBaixo = termo.toLowerCase();
  const filtrados = membros
    .filter((m) => nomeExibido(m).toLowerCase().startsWith(termoBaixo))
    .slice(0, 6);
  const mostraTodos = EVERYONE_BATE(termoBaixo);

  if (!mostraTodos && filtrados.length === 0) return null;

  return (
    <div className="mencao-picker">
      {mostraTodos && (
        <button type="button" className="mencao-picker-item" onClick={() => onEscolher('everyone')}>
          <span className="mencao-picker-icone"><Icon name="users" size={16} /></span>
          <div>
            <span className="mencao-picker-nome">@everyone</span>
            <span className="mencao-picker-dica">avisa todo mundo do servidor</span>
          </div>
        </button>
      )}
      {filtrados.map((m) => (
        <button key={m.id} type="button" className="mencao-picker-item" onClick={() => onEscolher(m.username)}>
          <Avatar user={m} size={22} />
          <span className="mencao-picker-nome">{nomeExibido(m)}</span>
        </button>
      ))}
    </div>
  );
}

/** Menu de comandos que aparece enquanto se digita "/". */
function SlashMenu({ lista, ativo, onEscolher }) {
  if (lista.length === 0) return null;
  return (
    <div className="slash-menu">
      <div className="slash-titulo">Comandos</div>
      {lista.map((c, i) => (
        <button
          key={c.nome}
          type="button"
          className={`slash-item ${i === ativo ? 'ativo' : ''}`}
          onClick={() => onEscolher(c)}
        >
          <span className="slash-nome">/{c.nome}</span>
          <span className="slash-desc">{c.descricao}</span>
        </button>
      ))}
    </div>
  );
}

/** Uma reação: mostra o emoji, quantos reagiram, e destaca se você é um deles. */
function Reacoes({ reactions, meuId, onReagir, onAbrirEmoji }) {
  if (!reactions?.length) {
    return (
      <button type="button" className="reacao-add" title="Reagir" onClick={onAbrirEmoji}>
        <Icon name="smile" size={14} />
      </button>
    );
  }
  return (
    <div className="reacoes">
      {reactions.map((r) => (
        <button
          key={r.emoji}
          type="button"
          className={`reacao ${r.userIds.includes(meuId) ? 'minha' : ''}`}
          onClick={() => onReagir(r.emoji)}
          title={`${r.count} ${r.count === 1 ? 'pessoa reagiu' : 'pessoas reagiram'}`}
        >
          <span>{r.emoji}</span>
          <span className="reacao-conta">{r.count}</span>
        </button>
      ))}
      <button type="button" className="reacao-add" title="Reagir" onClick={onAbrirEmoji}>
        <Icon name="smile" size={14} />
      </button>
    </div>
  );
}

export default function ChatView({
  channel,
  messages,
  loading,
  hasMore,
  onLoadMore,
  onSend,
  onTyping,
  typingUsers,
  error,
  onOpenProfile,
  icon = <span className="hash">#</span>,
  emptyMessage = 'Escolhe um canal de texto na barra ao lado.',
  placeholder,
  beginningNote,
  members,
  meId,
  roles,
  // Ações de mensagem. Cada uma é opcional: sem ela, o botão some.
  onReagir,
  onEditarMensagem,
  onApagarMensagem,
  onFixarMensagem,
  podeModerar = false,
  onRodarComando,
  // Botões do topo (só o chat de servidor usa).
  onAlternarMembros,
  membrosVisiveis = true,
  inserirNoCampo,
  naoLidasAoAbrir = 0,
}) {
  const [draft, setDraft] = useState('');
  const [anexoPendente, setAnexoPendente] = useState(null);
  const [enviandoAnexo, setEnviandoAnexo] = useState(false);
  const [erroAnexo, setErroAnexo] = useState(null);
  const [gifAberto, setGifAberto] = useState(false);
  const [mencaoTermo, setMencaoTermo] = useState(null); // null = fechado
  const [slashAtivo, setSlashAtivo] = useState(0);
  const [respondendo, setRespondendo] = useState(null); // mensagem sendo respondida
  const [editando, setEditando] = useState(null);       // { id, texto }
  const [emojiPara, setEmojiPara] = useState(null);     // id da msg com seletor aberto
  const [pinsAbertos, setPinsAbertos] = useState(false);
  const [pins, setPins] = useState([]);
  const [destacada, setDestacada] = useState(null);
  const [marcadorId, setMarcadorId] = useState(null);
  const scrollRef = useRef(null);
  const bottomRef = useRef(null);
  const stickToBottom = useRef(true);
  const posicionouNaoLida = useRef(false);
  const lastTypingSent = useRef(0);
  const arquivoRef = useRef(null);
  const campoRef = useRef(null);
  const menu = useContextMenu();

  const listaSlash = useMemo(() => (onRodarComando ? sugestoes(draft) : []), [draft, onRodarComando]);

  // Canal com não lida: abre em cima da primeira mensagem não lida (com um
  // divisor "novas mensagens"), não sempre no fim - só desce pro fim quando
  // já tava tudo lido mesmo. Uma vez posicionado, o resto do scroll volta a
  // ser o normal (gruda no fim só se a pessoa já tava lá).
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
    if (stickToBottom.current) bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages, channel?.id, naoLidasAoAbrir]);

  useEffect(() => {
    stickToBottom.current = naoLidasAoAbrir === 0;
    posicionouNaoLida.current = false;
    setMarcadorId(null);
    setDraft('');
    setAnexoPendente(null);
    setErroAnexo(null);
    setRespondendo(null);
    setEditando(null);
    setPinsAbertos(false);
  }, [channel?.id]);

  // "Mencionar" no menu de contexto empurra o @nome pro campo. O token muda a
  // cada pedido, então mencionar a mesma pessoa duas vezes funciona.
  useEffect(() => {
    if (!inserirNoCampo?.texto) return;
    setDraft((d) => (d.endsWith(' ') || !d ? d : `${d} `) + inserirNoCampo.texto);
    campoRef.current?.focus();
  }, [inserirNoCampo?.token]);

  function handleScroll(e) {
    const el = e.currentTarget;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (el.scrollTop < 60 && hasMore && !loading) onLoadMore();
  }

  async function abrirPins() {
    const abrindo = !pinsAbertos;
    setPinsAbertos(abrindo);
    if (!abrindo) return;
    try {
      const { messages: fixadas } = await api.pins(channel.id);
      setPins(fixadas);
    } catch {
      setPins([]);
    }
  }

  /** Rola até a mensagem e pisca nela - usado por resposta e por fixadas. */
  function irPara(messageId) {
    const el = scrollRef.current?.querySelector(`[data-msg="${messageId}"]`);
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setDestacada(messageId);
    setTimeout(() => setDestacada((atual) => (atual === messageId ? null : atual)), 1600);
  }

  async function submit(e) {
    e?.preventDefault();
    const bruto = draft.trim();

    // Editando: Enter salva a edição em vez de mandar mensagem nova.
    if (editando) {
      if (bruto) await onEditarMensagem?.(editando.id, bruto);
      setEditando(null);
      setDraft('');
      return;
    }

    if (!bruto && !anexoPendente) return;
    if (enviandoAnexo) return;

    // Comando tem prioridade sobre envio normal.
    const lido = onRodarComando ? lerComando(bruto) : null;
    if (lido?.comando) {
      setDraft('');
      setMencaoTermo(null);
      await onRodarComando(lido);
      return;
    }
    if (lido && !lido.comando) {
      setErroAnexo(`Não existe o comando /${lido.nome}. Digite /ajuda pra ver a lista.`);
      return;
    }

    stickToBottom.current = true;
    setDraft('');
    setMencaoTermo(null);
    onSend(members ? codificarMencoes(bruto, members) : bruto, anexoPendente, respondendo?.id ?? null);
    setAnexoPendente(null);
    setRespondendo(null);
  }

  function iniciarEdicao(message) {
    setEditando({ id: message.id });
    setRespondendo(null);
    setDraft(message.content);
    campoRef.current?.focus();
  }

  function cancelarContexto() {
    setEditando(null);
    setRespondendo(null);
    if (editando) setDraft('');
  }

  function handleKeyDown(e) {
    // Enquanto o menu de comandos está aberto, as setas navegam nele.
    if (listaSlash.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSlashAtivo((i) => (i + 1) % listaSlash.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSlashAtivo((i) => (i - 1 + listaSlash.length) % listaSlash.length);
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        escolherComando(listaSlash[slashAtivo]);
        return;
      }
    }

    if (e.key === 'Escape') {
      if (mencaoTermo !== null) { setMencaoTermo(null); return; }
      if (editando || respondendo) { cancelarContexto(); return; }
    }

    // Seta pra cima com o campo vazio edita a última mensagem sua - atalho
    // que o Discord tem e todo mundo usa sem perceber.
    if (e.key === 'ArrowUp' && !draft && !editando && onEditarMensagem) {
      const minha = [...messages].reverse().find((m) => m.author.id === meId && !m.pending);
      if (minha) { e.preventDefault(); iniciarEdicao(minha); return; }
    }

    if (e.key === 'Enter' && !e.shiftKey && mencaoTermo === null) {
      e.preventDefault();
      submit();
      return;
    }

    const now = Date.now();
    if (now - lastTypingSent.current > 2000) {
      lastTypingSent.current = now;
      onTyping();
    }
  }

  function escolherComando(comando) {
    setDraft(`/${comando.nome} `);
    setSlashAtivo(0);
    campoRef.current?.focus();
  }

  function handleChange(e) {
    const valor = e.target.value;
    setDraft(valor);
    setSlashAtivo(0);
    if (!members) return;
    // Só olha o "@parcial" bem no fim do texto - cobre o jeito normal de
    // digitar (a maioria das mensagens é escrita do início pro fim).
    const m = valor.match(/(?:^|\s)@([\p{L}\p{N}_]*)$/u);
    setMencaoTermo(m ? m[1] : null);
  }

  function escolherMencao(nome) {
    setDraft((d) => d.replace(/@[\p{L}\p{N}_]*$/u, `@${nome} `));
    setMencaoTermo(null);
  }

  async function enviarArquivoParaAnexo(arquivo) {
    setErroAnexo(null);
    setEnviandoAnexo(true);
    try {
      const { attachment } = await api.uploadAttachment(arquivo);
      setAnexoPendente(attachment);
    } catch (err) {
      setErroAnexo(err.message);
    } finally {
      setEnviandoAnexo(false);
    }
  }

  function escolherArquivo(e) {
    const arquivo = e.target.files?.[0];
    e.target.value = '';
    if (arquivo) enviarArquivoParaAnexo(arquivo);
  }

  /** Colar print (Ctrl+V) vira anexo igual escolher um arquivo - só não deixa
      colar o texto normal (link, etc.) se vier junto com uma imagem. */
  function handlePaste(e) {
    const arquivo = [...e.clipboardData?.items ?? []]
      .find((item) => item.kind === 'file' && item.type.startsWith('image/'))
      ?.getAsFile();
    if (!arquivo) return;
    e.preventDefault();
    enviarArquivoParaAnexo(arquivo);
  }

  function escolherGif(gif) {
    setAnexoPendente({ url: gif.url, type: 'gif', name: null });
    setGifAberto(false);
  }

  /** Itens do menu de contexto de uma mensagem (seção 6 da spec). */
  function itensDaMensagem(message) {
    const meuTexto = message.author.id === meId;
    const itens = [];

    if (onReagir) {
      itens.push({
        tipo: 'sub',
        label: 'Adicionar reação',
        icone: <Icon name="smile" size={15} />,
        itens: EMOJIS_RAPIDOS.map((emoji) => ({
          key: emoji, label: emoji, onClick: () => onReagir(message.id, emoji),
        })),
      });
    }
    itens.push({ label: 'Responder', icone: <Icon name="reply" size={15} />, onClick: () => { setRespondendo(message); campoRef.current?.focus(); } });
    if (meuTexto && onEditarMensagem && message.content) {
      itens.push({ label: 'Editar', icone: <Icon name="pencil" size={15} />, onClick: () => iniciarEdicao(message) });
    }
    if (onFixarMensagem && podeModerar) {
      itens.push({
        label: message.pinnedAt ? 'Desafixar' : 'Fixar mensagem',
        icone: <Icon name="pin" size={15} />,
        onClick: () => onFixarMensagem(message.id, !message.pinnedAt),
      });
    }
    itens.push({ tipo: 'sep' });
    itens.push({
      label: 'Copiar texto',
      icone: <Icon name="copy" size={15} />,
      onClick: () => navigator.clipboard?.writeText(message.content ?? '').catch(() => {}),
    });
    if (message.attachment) {
      itens.push({
        label: 'Copiar link do anexo',
        icone: <Icon name="link" size={15} />,
        onClick: () => navigator.clipboard?.writeText(
          new URL(message.attachment.url, window.location.origin).href,
        ).catch(() => {}),
      });
    }
    itens.push({
      label: 'Copiar ID',
      icone: '#',
      onClick: () => navigator.clipboard?.writeText(message.id).catch(() => {}),
    });

    if ((meuTexto || podeModerar) && onApagarMensagem) {
      itens.push({ tipo: 'sep' });
      itens.push({
        label: 'Excluir mensagem', icone: <Icon name="trash" size={15} />, perigo: true,
        onClick: () => onApagarMensagem(message.id),
      });
    }
    return itens;
  }

  if (!channel) {
    return (
      <main className="chat empty">
        <p>{emptyMessage}</p>
      </main>
    );
  }

  const contextoComposer = editando
    ? { rotulo: 'Editando a mensagem', extra: 'esc pra cancelar' }
    : respondendo
      ? { rotulo: `Respondendo ${nomeExibido(members?.find((m) => m.id === respondendo.author.id)) || respondendo.author.username}`, extra: 'esc pra cancelar' }
      : null;

  let lastDay = null;

  return (
    <main className="chat">
      <header className="chat-head">
        {icon}
        <span className="chat-title">{channel.name}</span>
        {channel.topic && (
          <>
            <span className="chat-head-divisor" />
            <span className="chat-topico" title={channel.topic}>{channel.topic}</span>
          </>
        )}
        <div className="chat-head-acoes">
          <button className="icon-btn" title="Mensagens fixadas" onClick={abrirPins}><Icon name="pin" /></button>
          {onAlternarMembros && (
            <button
              className={`icon-btn ${membrosVisiveis ? 'ativo' : ''}`}
              title={membrosVisiveis ? 'Esconder membros' : 'Mostrar membros'}
              onClick={onAlternarMembros}
            >
              <Icon name="users" />
            </button>
          )}
        </div>
        {pinsAbertos && (
          <>
            <div className="click-fora" onClick={() => setPinsAbertos(false)} />
            <div className="pins-popover">
              <h4>Mensagens fixadas</h4>
              {pins.length === 0 && <p className="pins-vazio">Nada fixado neste canal ainda.</p>}
              {pins.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="pin-item"
                  onClick={() => { setPinsAbertos(false); irPara(p.id); }}
                >
                  <div className="pin-autor">{p.author.username}</div>
                  <div className="pin-texto">{p.content || 'anexo'}</div>
                </button>
              ))}
            </div>
          </>
        )}
      </header>

      <div className="messages" ref={scrollRef} onScroll={handleScroll}>
        {loading && <div className="chat-note">carregando historico...</div>}
        {!hasMore && !loading && (
          <div className="chat-note">
            {beginningNote ?? <>Este e o comeco do canal <strong>#{channel.name}</strong>.</>}
          </div>
        )}

        {messages.map((message, index) => {
          const previous = messages[index - 1];
          const grouped = shouldGroup(previous, message);
          const day = dayOf(message.createdAt);
          const showDivider = day !== lastDay;
          lastDay = day;

          const membro = members?.find((m) => m.id === message.author.id);
          const cor = corDoMembro(membro, roles);
          const meuTexto = message.author.id === meId;

          return (
            <div key={message.id}>
              {showDivider && <div className="day-divider"><span>{day}</span></div>}
              {message.id === marcadorId && (
                <div className="novas-mensagens-divider"><span>NOVAS MENSAGENS</span></div>
              )}
              <div
                data-msg={message.id}
                className={[
                  'message', 'msg',
                  grouped ? 'grouped' : '',
                  message.pending ? 'pending' : '',
                  destacada === message.id ? 'destacada' : '',
                  meId && mensagemMenciona(message.content, meId) ? 'mencionado' : '',
                ].filter(Boolean).join(' ')}
                onContextMenu={menu.abrirCom(() => itensDaMensagem(message))}
              >
                {message.replyTo && (
                  <div className="reply-linha" onClick={() => irPara(message.replyTo.id)}>
                    <span className="reply-gancho" />
                    <span className="reply-autor">
                      {nomeExibido(members?.find((m) => m.id === message.replyTo.authorId))
                        || message.replyTo.username}
                    </span>
                    <span className="reply-texto">{message.replyTo.content || 'anexo'}</span>
                  </div>
                )}

                {grouped ? (
                  <span className="gutter-time">{timeOf(message.createdAt)}</span>
                ) : (
                  <Avatar
                    user={message.author}
                    size={38}
                    onClick={() => onOpenProfile(message.author)}
                    title="Ver perfil"
                  />
                )}

                <div className="message-body">
                  {!grouped && (
                    <div className="message-meta">
                      <button
                        className={`author ${cor ? 'colorido' : ''}`}
                        style={cor ? { color: cor } : undefined}
                        onClick={() => onOpenProfile(message.author)}
                      >
                        {nomeExibido(membro) || message.author.username}
                      </button>
                      <span className="time">{timeOf(message.createdAt)}</span>
                      {message.pinnedAt && <Icon name="pin" size={11} className="msg-fixada-selo" title="fixada" />}
                    </div>
                  )}

                  {message.content && (
                    <div className="content">
                      <Conteudo texto={message.content} membros={members} meuId={meId} />
                      {message.editedAt && <span className="msg-editada" title="editada">(editada)</span>}
                    </div>
                  )}
                  {message.attachment && <Anexo anexo={message.attachment} />}
                  {message.content && <LinkPreview texto={message.content} />}

                  {onReagir && !message.pending && (
                    <Reacoes
                      reactions={message.reactions}
                      meuId={meId}
                      onReagir={(emoji) => onReagir(message.id, emoji)}
                      onAbrirEmoji={() => setEmojiPara(emojiPara === message.id ? null : message.id)}
                    />
                  )}

                  {emojiPara === message.id && (
                    <>
                      <div className="click-fora" onClick={() => setEmojiPara(null)} />
                      <div className="emoji-rapido">
                        {EMOJIS_RAPIDOS.map((emoji) => (
                          <button
                            key={emoji}
                            type="button"
                            onClick={() => { onReagir(message.id, emoji); setEmojiPara(null); }}
                          >
                            {emoji}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>

                {!message.pending && (
                  <div className="msg-acoes">
                    {onReagir && (
                      <button
                        className="icon-btn"
                        title="Reagir"
                        onClick={() => setEmojiPara(emojiPara === message.id ? null : message.id)}
                      >
                        <Icon name="smile" />
                      </button>
                    )}
                    <button
                      className="icon-btn"
                      title="Responder"
                      onClick={() => { setRespondendo(message); campoRef.current?.focus(); }}
                    >
                      <Icon name="reply" />
                    </button>
                    {meuTexto && onEditarMensagem && message.content && (
                      <button className="icon-btn" title="Editar" onClick={() => iniciarEdicao(message)}><Icon name="pencil" /></button>
                    )}
                    {(meuTexto || podeModerar) && onApagarMensagem && (
                      <button
                        className="icon-btn perigo"
                        title="Excluir"
                        onClick={() => onApagarMensagem(message.id)}
                      >
                        <Icon name="trash" />
                      </button>
                    )}
                    <button
                      className="icon-btn"
                      title="Mais"
                      onClick={(e) => menu.abrirCom(() => itensDaMensagem(message))(e)}
                    >
                      <Icon name="more" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <div className="typing-line">
        {typingUsers.length > 0 &&
          `${typingUsers.join(', ')} ${typingUsers.length === 1 ? 'esta' : 'estao'} digitando...`}
      </div>

      {error && <div className="chat-error">{error}</div>}
      {erroAnexo && <div className="chat-error">{erroAnexo}</div>}

      {(anexoPendente || enviandoAnexo) && (
        <div className="anexo-pendente">
          {enviandoAnexo ? (
            <span className="hint">enviando arquivo...</span>
          ) : (
            <>
              <Anexo anexo={anexoPendente} />
              <button
                type="button"
                className="icon-btn faint"
                title="Remover anexo"
                onClick={() => setAnexoPendente(null)}
              >
                <Icon name="x" size={13} />
              </button>
            </>
          )}
        </div>
      )}

      {contextoComposer && (
        <div className="composer-contexto">
          <span className="composer-contexto-texto"><strong>{contextoComposer.rotulo}</strong></span>
          <span>{contextoComposer.extra}</span>
          <button type="button" className="icon-btn" title="Cancelar" onClick={cancelarContexto}><Icon name="x" size={13} /></button>
        </div>
      )}

      <form className="composer" onSubmit={submit}>
        <input
          ref={arquivoRef}
          type="file"
          hidden
          onChange={escolherArquivo}
        />
        <button
          type="button"
          className="icon-btn composer-anexar"
          title="Enviar arquivo"
          onClick={() => arquivoRef.current?.click()}
        >
          <Icon name="plus" size={18} />
        </button>

        <div className="composer-campo-wrap">
          {mencaoTermo !== null && members && (
            <MencaoPicker termo={mencaoTermo} membros={members} onEscolher={escolherMencao} />
          )}
          {mencaoTermo === null && (
            <SlashMenu lista={listaSlash} ativo={slashAtivo} onEscolher={escolherComando} />
          )}
          <textarea
            ref={campoRef}
            value={draft}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={editando ? 'Edite a mensagem e aperte Enter' : (placeholder ?? `Mensagem em #${channel.name}`)}
            rows={1}
            maxLength={4000}
          />
        </div>

        <div className="composer-gif-wrap">
          <button
            type="button"
            className={`icon-btn composer-gif ${gifAberto ? 'ativo' : ''}`}
            title="Enviar GIF"
            onClick={() => setGifAberto((v) => !v)}
          >
            GIF
          </button>
          {gifAberto && <GifPicker onEscolher={escolherGif} onFechar={() => setGifAberto(false)} />}
        </div>

        <button className="primary" type="submit" disabled={(!draft.trim() && !anexoPendente) || enviandoAnexo}>
          {editando ? 'Salvar' : 'Enviar'}
        </button>
      </form>

      <ContextMenu estado={menu.estado} onFechar={menu.fechar} />
    </main>
  );
}
