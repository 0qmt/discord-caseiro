import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { corDoMembro, nomeExibido } from '../lib/cargos.js';
import { lerComando, sugestoes } from '../lib/comandos.js';
import { linkify } from '../lib/linkify.js';
import {
  ajustarMencoesAposEdicao,
  codificarRascunho,
  decodificarMencoesParaEdicao,
  encontrarConsultaMencao,
  mensagemMenciona,
  textoLegivel,
} from '../lib/mencoes.js';
import { itensDeImagem } from '../lib/menuDeImagem.jsx';
import { EMOJIS_RAPIDOS, itensDeMensagem } from '../lib/menuDeMensagem.jsx';
import { useMensagensNovas } from '../lib/mensagensNovas.js';
import AcoesDaMensagem from './AcoesDaMensagem.jsx';
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
  // O menu vive dentro do próprio anexo para manter posição e ações junto
  // do conteúdo que ele controla.
  const menu = useContextMenu();

  if (!anexo) return null;

  if (anexo.type === 'image' || anexo.type === 'gif') {
    const itens = itensDeImagem({
      src: anexo.url,
      nome: anexo.name,
      onVer: () => setAberta(true),
    });

    return (
      <>
        <img
          className="anexo-imagem clicavel"
          src={anexo.url}
          alt={anexo.name ?? 'imagem'}
          loading="lazy"
          onClick={() => setAberta(true)}
          onContextMenu={menu.abrirCom(itens)}
        />
        {aberta && (
          <ImageLightbox src={anexo.url} nome={anexo.name} onClose={() => setAberta(false)} />
        )}
        <ContextMenu estado={menu.estado} onFechar={menu.fechar} />
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

function opcoesDeMencao(termo, membros) {
  if (termo === null) return [];
  const termoBaixo = termo.toLowerCase();
  const pessoas = (membros ?? [])
    .filter((m) => [nomeExibido(m), m.username, m.handle]
      .filter(Boolean)
      .some((nome) => nome.toLowerCase().startsWith(termoBaixo)))
    .slice(0, 6)
    .map((membro) => ({ id: membro.id, nome: nomeExibido(membro), membro }));
  return [
    ...(EVERYONE_BATE(termoBaixo) ? [{ id: 'everyone', nome: 'everyone', everyone: true }] : []),
    ...pessoas,
  ];
}

/** Lista pra marcar alguém ou @everyone, aparece assim que digita "@". */
function MencaoPicker({ opcoes, ativo, onEscolher }) {
  if (opcoes.length === 0) return null;

  return (
    <div className="mencao-picker" role="listbox" aria-label="Mencionar alguém">
      {opcoes.map((opcao, indice) => (
        <button
          key={opcao.id}
          type="button"
          role="option"
          aria-selected={indice === ativo}
          className={`mencao-picker-item ${indice === ativo ? 'ativo' : ''}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onEscolher(opcao)}
        >
          {opcao.everyone ? (
            <>
              <span className="mencao-picker-icone"><Icon name="users" size={16} /></span>
              <span className="mencao-picker-texto">
                <span className="mencao-picker-nome">@everyone</span>
                <span className="mencao-picker-dica">avisa todo o servidor</span>
              </span>
            </>
          ) : (
            <>
              <Avatar user={opcao.membro} size={24} />
              <span className="mencao-picker-texto">
                <span className="mencao-picker-nome">{opcao.nome}</span>
                {opcao.membro.username !== opcao.nome && (
                  <span className="mencao-picker-dica">@{opcao.membro.username}</span>
                )}
              </span>
            </>
          )}
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

/**
 * Uma linha da lista de fixadas.
 *
 * Mostra a foto de quem mandou e, quando a mensagem é uma imagem, uma
 * miniatura dela. Antes toda mensagem com anexo virava a palavra "anexo", e
 * uma lista de cinco fixadas ficava com cinco linhas idênticas - impossível
 * saber qual era qual sem clicar uma por uma.
 *
 * Exportado para ser reutilizado nos painéis de mensagens fixadas.
 */
export function ItemFixado({ pin, onIr }) {
  const imagem = pin.attachment && (pin.attachment.type === 'image' || pin.attachment.type === 'gif')
    ? pin.attachment
    : null;

  return (
    <button type="button" className="pin-item" onClick={onIr}>
      <Avatar user={pin.author} size={28} className="small" />
      <span className="pin-corpo">
        <span className="pin-autor">{pin.author.username}</span>
        <span className="pin-texto">
          {pin.content || (imagem ? (imagem.name ?? 'imagem') : (pin.attachment?.name ?? 'anexo'))}
        </span>
      </span>
      {/* Sem `loading="lazy"` de propósito: dentro do popover o navegador
          trata a miniatura como fora da tela e adia o carregamento pra
          sempre - o resultado era um quadrado cinza que nunca virava foto.
          São no máximo 50 imagens de 44px, carregar direto não pesa. */}
      {imagem && <img className="pin-miniatura" src={imagem.url} alt="" />}
    </button>
  );
}

/**
 * Uma reação: mostra o emoji, quantos reagiram, e destaca se você é um deles.
 *
 * Exportado para manter a representação da reação reutilizável sem criar
 * outra implementação da mensagem.
 */
export function Reacoes({ reactions, meuId, onReagir, onAbrirEmoji }) {
  // A barra de ações já oferece "Reagir". Sem reações reais, reservar uma
  // linha invisível aqui só separa mensagens que pertencem ao mesmo grupo.
  if (!reactions?.length) return null;
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

function BuscaNoCanal({ channelId, members, onIr, onClose }) {
  const [termo, setTermo] = useState('');
  const [resultados, setResultados] = useState([]);
  const [buscando, setBuscando] = useState(false);
  const [abrindoId, setAbrindoId] = useState(null);
  const [erro, setErro] = useState(null);
  const [pesquisou, setPesquisou] = useState(false);

  async function buscar(e) {
    e.preventDefault();
    if (termo.trim().length < 2) return;
    setBuscando(true);
    setErro(null);
    try {
      const { messages: encontrados } = await api.buscarNoCanal(channelId, termo.trim());
      setResultados(encontrados);
      setPesquisou(true);
    } catch (err) {
      setErro(err.message);
    } finally {
      setBuscando(false);
    }
  }

  async function abrir(messageId) {
    setAbrindoId(messageId);
    try {
      await onIr(messageId);
      onClose();
    } finally {
      setAbrindoId(null);
    }
  }

  return (
    <>
      <div className="click-fora" onClick={onClose} />
      <section className="busca-popover" role="dialog" aria-label="Buscar no canal">
        <form className="busca-campo" onSubmit={buscar}>
          <Icon name="search" size={15} />
          <input
            value={termo}
            onChange={(e) => setTermo(e.target.value)}
            placeholder="Buscar neste canal"
            aria-label="Termo da busca"
            autoFocus
          />
          <button type="submit" className="icon-btn" title="Buscar" disabled={buscando || termo.trim().length < 2}>
            <Icon name="arrow-right" size={15} />
          </button>
        </form>

        <div className="busca-resultados">
          {!pesquisou && !erro && <p className="busca-vazio">Digite pelo menos dois caracteres.</p>}
          {buscando && <p className="busca-vazio">Buscando mensagens...</p>}
          {erro && <p className="busca-vazio erro">{erro}</p>}
          {pesquisou && !buscando && resultados.length === 0 && (
            <p className="busca-vazio">Nenhuma mensagem encontrada.</p>
          )}
          {resultados.map((message) => (
            <button
              type="button"
              className="busca-resultado"
              key={message.id}
              onClick={() => abrir(message.id)}
              disabled={abrindoId === message.id}
            >
              <Avatar user={message.author} size={28} className="small" />
              <span>
                <span className="busca-resultado-meta">
                  <strong>{message.author.username}</strong>
                  <small>{timeOf(message.createdAt)}</small>
                </span>
                <span className="busca-resultado-texto">{textoLegivel(message.content, members) || 'anexo'}</span>
              </span>
            </button>
          ))}
        </div>
      </section>
    </>
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
  onEncaminhar,
  onMarcarNaoLido,
  onDenunciar,
  podeModerar = false,
  onRodarComando,
  // Botões do topo (só o chat de servidor usa).
  onAlternarCanais,
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
  const [mencaoTermo, setMencaoTermo] = useState(null); // null | { inicio, fim, termo }
  const [mencoesEscolhidas, setMencoesEscolhidas] = useState([]);
  const [mencaoAtiva, setMencaoAtiva] = useState(0);
  const [slashAtivo, setSlashAtivo] = useState(0);
  const [respondendo, setRespondendo] = useState(null); // mensagem sendo respondida
  const [editando, setEditando] = useState(null);       // { id, texto }
  const [emojiPara, setEmojiPara] = useState(null);     // id da msg com seletor aberto
  const [acoesAbertas, setAcoesAbertas] = useState(null);
  const [pinsAbertos, setPinsAbertos] = useState(false);
  const [buscaAberta, setBuscaAberta] = useState(false);
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
  const cursorDepoisDaMencao = useRef(null);
  const hasMoreRef = useRef(hasMore);
  const onLoadMoreRef = useRef(onLoadMore);
  const menu = useContextMenu();

  hasMoreRef.current = hasMore;
  onLoadMoreRef.current = onLoadMore;

  const listaSlash = useMemo(() => (onRodarComando ? sugestoes(draft) : []), [draft, onRodarComando]);
  const opcoesMencao = useMemo(
    () => opcoesDeMencao(mencaoTermo?.termo ?? null, members),
    [mencaoTermo, members],
  );

  const novas = useMensagensNovas(messages, channel?.id);

  useLayoutEffect(() => {
    if (cursorDepoisDaMencao.current === null) return;
    const cursor = cursorDepoisDaMencao.current;
    cursorDepoisDaMencao.current = null;
    campoRef.current?.focus();
    campoRef.current?.setSelectionRange(cursor, cursor);
  }, [draft]);

  /*
   * Apagar com a mensagem saindo antes de sumir. A classe entra direto no nó
   * (e não por state) porque o dado dela já foi embora no instante seguinte -
   * guardar a mensagem morta no estado só pra animar sairia bem mais caro.
   * Só vale pra quem apagou; mensagem apagada por outra pessoa chega pelo
   * socket já sem o nó pra animar.
   */
  const apagarComSaida = (id) => {
    const no = scrollRef.current?.querySelector(`[data-msg="${id}"]`);
    if (!no) return onApagarMensagem(id);
    no.classList.add('saindo');
    setTimeout(() => onApagarMensagem(id), 160);
    return undefined;
  };

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
    setMencoesEscolhidas([]);
    setAnexoPendente(null);
    setErroAnexo(null);
    setRespondendo(null);
    setEditando(null);
    setAcoesAbertas(null);
    setPinsAbertos(false);
    setBuscaAberta(false);
  }, [channel?.id]);

  useEffect(() => {
    if (!acoesAbertas) return undefined;
    const fecharFora = (event) => {
      if (!event.target.closest(`[data-msg="${acoesAbertas}"]`)) setAcoesAbertas(null);
    };
    document.addEventListener('pointerdown', fecharFora);
    return () => document.removeEventListener('pointerdown', fecharFora);
  }, [acoesAbertas]);

  // "Mencionar" no menu de contexto empurra o @nome pro campo. O token muda a
  // cada pedido, então mencionar a mesma pessoa duas vezes funciona.
  useEffect(() => {
    if (!inserirNoCampo?.texto) return;
    setDraft((atual) => {
      const separador = atual.endsWith(' ') || !atual ? '' : ' ';
      const rotulo = inserirNoCampo.texto.trimEnd();
      const inicio = atual.length + separador.length;
      const proximo = `${atual}${separador}${rotulo} `;
      setMencoesEscolhidas((prev) => {
        const reposicionadas = ajustarMencoesAposEdicao(atual, proximo, prev);
        if (!inserirNoCampo.userId) return reposicionadas;
        return [...reposicionadas, {
          userId: inserirNoCampo.userId,
          rotulo,
          inicio,
          fim: inicio + rotulo.length,
        }];
      });
      return proximo;
    });
    campoRef.current?.focus();
  }, [inserirNoCampo?.token]);

  function handleScroll(e) {
    const el = e.currentTarget;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (el.scrollTop < 60 && hasMore && !loading) onLoadMore();
  }

  async function abrirPins() {
    const abrindo = !pinsAbertos;
    setBuscaAberta(false);
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

  async function irParaResultado(messageId) {
    for (let pagina = 0; pagina < 20; pagina += 1) {
      if (scrollRef.current?.querySelector(`[data-msg="${CSS.escape(messageId)}"]`)) {
        irPara(messageId);
        return true;
      }
      if (!hasMoreRef.current || !onLoadMoreRef.current) break;
      await onLoadMoreRef.current();
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }
    irPara(messageId);
    return false;
  }

  async function submit(e) {
    e?.preventDefault();
    const bruto = draft.trim();
    const conteudo = members ? codificarRascunho(draft, mencoesEscolhidas, members) : bruto;

    // Editando: Enter salva a edição em vez de mandar mensagem nova.
    if (editando) {
      if (bruto) await onEditarMensagem?.(editando.id, conteudo);
      setEditando(null);
      setDraft('');
      setMencoesEscolhidas([]);
      return;
    }

    if (!bruto && !anexoPendente) return;
    if (enviandoAnexo) return;

    // Comando tem prioridade sobre envio normal.
    const lido = onRodarComando ? lerComando(bruto) : null;
    if (lido?.comando) {
      setDraft('');
      setMencoesEscolhidas([]);
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
    setMencoesEscolhidas([]);
    setMencaoTermo(null);
    onSend(conteudo, anexoPendente, respondendo?.id ?? null);
    setAnexoPendente(null);
    setRespondendo(null);
  }

  function iniciarEdicao(message) {
    const decodificada = members
      ? decodificarMencoesParaEdicao(message.content, members)
      : { texto: message.content, entidades: [] };
    setEditando({ id: message.id });
    setRespondendo(null);
    setDraft(decodificada.texto);
    setMencoesEscolhidas(decodificada.entidades);
    campoRef.current?.focus();
  }

  function cancelarContexto() {
    setEditando(null);
    setRespondendo(null);
    if (editando) {
      setDraft('');
      setMencoesEscolhidas([]);
    }
  }

  function handleKeyDown(e) {
    if (mencaoTermo !== null && opcoesMencao.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMencaoAtiva((i) => (i + 1) % opcoesMencao.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMencaoAtiva((i) => (i - 1 + opcoesMencao.length) % opcoesMencao.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        escolherMencao(opcoesMencao[mencaoAtiva] ?? opcoesMencao[0]);
        return;
      }
    }

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

    if (e.key === 'Enter' && !e.shiftKey) {
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
    const cursor = e.target.selectionStart;
    setMencoesEscolhidas((prev) => ajustarMencoesAposEdicao(draft, valor, prev));
    setDraft(valor);
    setSlashAtivo(0);
    setMencaoAtiva(0);
    if (!members) return;
    setMencaoTermo(encontrarConsultaMencao(valor, cursor));
  }

  function escolherMencao(escolha) {
    if (!mencaoTermo) return;
    const rotulo = `@${escolha.nome}`;
    const proximo = `${draft.slice(0, mencaoTermo.inicio)}${rotulo} ${draft.slice(mencaoTermo.fim)}`;
    const reposicionadas = ajustarMencoesAposEdicao(draft, proximo, mencoesEscolhidas);
    cursorDepoisDaMencao.current = mencaoTermo.inicio + rotulo.length + 1;
    setDraft(proximo);
    setMencoesEscolhidas([...reposicionadas, {
      userId: escolha.id,
      rotulo,
      inicio: mencaoTermo.inicio,
      fim: mencaoTermo.inicio + rotulo.length,
    }]);
    setMencaoTermo(null);
    setMencaoAtiva(0);
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
    return itensDeMensagem({
      message,
      meId,
      podeModerar,
      canalId: channel?.id,
      onReagir,
      onResponder: (m) => { setRespondendo(m); campoRef.current?.focus(); },
      // Só o autor edita: sem essa checagem o item aparecia na mensagem dos
      // outros, e o servidor recusaria depois de a pessoa já ter digitado.
      onEditar: message.author.id === meId && onEditarMensagem && message.content
        ? () => iniciarEdicao(message)
        : null,
      onFixarMensagem,
      onApagar: onApagarMensagem ? apagarComSaida : null,
      onEncaminhar,
      onMarcarNaoLido,
      onDenunciar,
    });
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
        {onAlternarCanais && (
          <button
            type="button"
            className="orbit-mobile-nav-toggle"
            title="Abrir canais"
            aria-label="Abrir canais"
            onClick={onAlternarCanais}
          >
            <Icon name="menu" size={18} />
          </button>
        )}
        {icon}
        <span className="chat-title">{channel.name}</span>
        {channel.topic && (
          <>
            <span className="chat-head-divisor" />
            <span className="chat-topico" title={channel.topic}>{channel.topic}</span>
          </>
        )}
        <div className="chat-head-acoes">
          {members && (
            <button
              className={`icon-btn ${buscaAberta ? 'ativo' : ''}`}
              title="Buscar no canal"
              aria-label="Buscar no canal"
              onClick={() => { setBuscaAberta((aberta) => !aberta); setPinsAbertos(false); }}
            >
              <Icon name="search" />
            </button>
          )}
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
        {buscaAberta && (
          <BuscaNoCanal
            channelId={channel.id}
            members={members}
            onIr={irParaResultado}
            onClose={() => setBuscaAberta(false)}
          />
        )}
        {pinsAbertos && (
          <>
            <div className="click-fora" onClick={() => setPinsAbertos(false)} />
            <div className="pins-popover">
              <h4>Mensagens fixadas</h4>
              {pins.length === 0 && <p className="pins-vazio">Nada fixado neste canal ainda.</p>}
              {pins.map((p) => <ItemFixado key={p.id} pin={p} onIr={() => { setPinsAbertos(false); irPara(p.id); }} />)}
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
                  novas.has(message.id) ? 'nova' : '',
                  destacada === message.id ? 'destacada' : '',
                  acoesAbertas === message.id ? 'acoes-abertas' : '',
                  meId && mensagemMenciona(message.content, meId) ? 'mencionado' : '',
                ].filter(Boolean).join(' ')}
                onContextMenu={menu.abrirCom(() => itensDaMensagem(message))}
                onPointerUp={(event) => {
                  if (event.pointerType !== 'touch') return;
                  if (event.target.closest('a, button, input, textarea, video, audio')) return;
                  setAcoesAbertas((atual) => (atual === message.id ? null : message.id));
                }}
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
                      {grouped && message.pinnedAt && (
                        <Icon name="pin" size={11} className="msg-fixada-selo agrupada" title="fixada" />
                      )}
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
                  <AcoesDaMensagem
                    message={message}
                    onReagir={onReagir}
                    onAbrirEmoji={onReagir
                      ? () => setEmojiPara(emojiPara === message.id ? null : message.id)
                      : null}
                    onResponder={(m) => { setRespondendo(m); campoRef.current?.focus(); }}
                    onEncaminhar={onEncaminhar}
                    onMais={(e) => menu.abrirCom(() => itensDaMensagem(message))(e)}
                  />
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
            <MencaoPicker
              opcoes={opcoesMencao}
              ativo={mencaoAtiva}
              onEscolher={escolherMencao}
            />
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
          {/* Dentro da mesma barra do campo, não uma caixa separada do lado -
              é isso que faz ler como "embutido no chat" igual ao Discord,
              em vez de mais um botão solto ao lado do de enviar. */}
          <div className="composer-gif-wrap">
            <button
              type="button"
              className={`composer-gif ${gifAberto ? 'ativo' : ''}`}
              title="Enviar GIF"
              onClick={() => setGifAberto((v) => !v)}
            >
              GIF
            </button>
            {gifAberto && <GifPicker onEscolher={escolherGif} onFechar={() => setGifAberto(false)} />}
          </div>
        </div>

        <button
          className="primary composer-enviar"
          type="submit"
          title={editando ? 'Salvar edição' : 'Enviar mensagem'}
          aria-label={editando ? 'Salvar edição' : 'Enviar mensagem'}
          disabled={(!draft.trim() && !anexoPendente) || enviandoAnexo}
        >
          <Icon name={editando ? 'check' : 'send'} size={17} />
        </button>
      </form>

      <ContextMenu estado={menu.estado} onFechar={menu.fechar} />
    </main>
  );
}
