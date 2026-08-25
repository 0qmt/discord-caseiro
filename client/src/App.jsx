import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, clearToken, getToken } from './api.js';
import { createSocket, emitAck } from './socket.js';
import { PERM, podeAgirSobre as podeAgirSobreMembro, temPermissao } from './lib/cargos.js';
import { mensagemMenciona, textoLegivel } from './lib/mencoes.js';
import {
  chaveDe, configDe, deveNotificar, DURACOES_DE_SILENCIO, NIVEIS, PARA_SEMPRE,
} from './lib/notificacoes.js';
import { useAusenciaAutomatica, useDeteccaoDeJogo } from './lib/usePresenca.js';
import { notificar, pedirPermissaoDeNotificacao } from './lib/notificar.js';
import { useVoice } from './lib/useVoice.js';
import AuthView from './components/AuthView.jsx';
import Avatar from './components/Avatar.jsx';
import ChannelSidebar from './components/ChannelSidebar.jsx';
import ChatView from './components/ChatView.jsx';
import ConfirmDialog from './components/ConfirmDialog.jsx';
import ContextMenu, { useContextMenu } from './components/ContextMenu.jsx';
import DMSidebar from './components/DMSidebar.jsx';
import GuildBar from './components/GuildBar.jsx';
import Icon from './components/Icon.jsx';
import MemberList, { itensDoMembro } from './components/MemberList.jsx';
import GuildSettingsModal from './components/GuildSettingsModal.jsx';
import OrbitApp from './skins/orbit/OrbitApp.jsx';
import Modal from './components/Modal.jsx';
import ProfileCard from './components/ProfileCard.jsx';
import ProfileEditor from './components/ProfileEditor.jsx';
import ReportBugModal from './components/ReportBugModal.jsx';
import RolesModal from './components/RolesModal.jsx';
import SettingsScreen from './components/SettingsScreen.jsx';
import { itensDeStatus } from './components/UserPanel.jsx';
import VoiceStage, { temVideoDeOutros, VoiceAudioSink } from './components/VoiceStage.jsx';

const TYPING_TTL = 4000;
const AVISO_TTL = 6000;

/**
 * Anotação privada sobre alguém. Carrega o que já existe ao abrir e some
 * quando salva vazio - é o mesmo comportamento da nota do Discord.
 */
function NotaModal({ membro, onClose, onErro }) {
  const [texto, setTexto] = useState('');
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    let vivo = true;
    api.getNote(membro.id)
      .then(({ note }) => { if (vivo) setTexto(note); })
      .catch(() => {})
      .finally(() => { if (vivo) setCarregando(false); });
    return () => { vivo = false; };
  }, [membro.id]);

  async function salvar(e) {
    e.preventDefault();
    try {
      await api.setNote(membro.id, texto);
      onClose();
    } catch (err) { onErro(err.message); }
  }

  return (
    <Modal title={`Nota sobre ${membro.username}`} onClose={onClose}>
      <form onSubmit={salvar}>
        <label>
          Só você vê isso
          <textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            rows={4}
            maxLength={500}
            placeholder={carregando ? 'carregando...' : 'ex: amigo do trabalho, joga de tank'}
          />
        </label>
        <button className="primary" type="submit">Salvar</button>
      </form>
    </Modal>
  );
}

/** Renomear canal e definir o assunto que aparece no topo do chat. */
function EditarCanalModal({ canal, guildId, onClose, onErro }) {
  const [nome, setNome] = useState(canal.name);
  const [topico, setTopico] = useState(canal.topic ?? '');

  async function salvar(e) {
    e.preventDefault();
    try {
      await api.updateChannel(guildId, canal.id, { name: nome, topic: topico });
      onClose();
    } catch (err) { onErro(err.message); }
  }

  return (
    <Modal title={`Editar #${canal.name}`} onClose={onClose}>
      <form onSubmit={salvar}>
        <label>
          Nome do canal
          <input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={48} autoFocus />
        </label>
        {canal.type === 'text' && (
          <label>
            Assunto
            <input
              value={topico}
              onChange={(e) => setTopico(e.target.value)}
              maxLength={200}
              placeholder="aparece no topo do chat"
            />
          </label>
        )}
        <button className="primary" type="submit">Salvar</button>
      </form>
    </Modal>
  );
}

/** Categoria: só agrupa canais na barra lateral, não tem função própria. */
function CriarCategoriaModal({ guildId, onClose, onErro }) {
  const [nome, setNome] = useState('');

  async function salvar(e) {
    e.preventDefault();
    try {
      await api.createCategory(guildId, nome);
      onClose();
    } catch (err) { onErro(err.message); }
  }

  return (
    <Modal title="Nova categoria" onClose={onClose}>
      <form onSubmit={salvar}>
        <label>
          Nome da categoria
          <input
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            maxLength={48}
            placeholder="ex: Jogos"
            autoFocus
          />
        </label>
        <button className="primary" type="submit" disabled={!nome.trim()}>Criar</button>
      </form>
    </Modal>
  );
}

/** Apelido por servidor: vazio volta pro nome de usuário normal. */
function ApelidoModal({ membro, guildId, onClose, onErro }) {
  const [texto, setTexto] = useState(membro.nickname ?? '');

  async function salvar(e) {
    e.preventDefault();
    try {
      await api.setNickname(guildId, membro.id, texto);
      onClose();
    } catch (err) { onErro(err.message); }
  }

  return (
    <Modal title={`Apelido de ${membro.username}`} onClose={onClose}>
      <form onSubmit={salvar}>
        <label>
          Apelido neste servidor
          <input
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            maxLength={32}
            placeholder={membro.username}
            autoFocus
          />
        </label>
        <button className="primary" type="submit">Salvar</button>
      </form>
    </Modal>
  );
}

export default function App() {
  const [me, setMe] = useState(null);
  const [booting, setBooting] = useState(true);
  const [connected, setConnected] = useState(false);

  const [guilds, setGuilds] = useState([]);
  const [activeGuildId, setActiveGuildId] = useState(null);
  const [guild, setGuild] = useState(null);
  const [activeChannelId, setActiveChannelId] = useState(null);

  const [messages, setMessages] = useState({});
  const [channelState, setChannelState] = useState({});
  const [unread, setUnread] = useState({});
  // Quantas mensagens estavam não lidas quando cada canal foi aberto - é o
  // que decide se a tela abre em cima da primeira não lida ou no fim do
  // chat (ver selectChannel). Fica até trocar de canal e voltar.
  const [marcadorNaoLidas, setMarcadorNaoLidas] = useState({});

  // Pele visual alternativa ("versão de teste" nas configurações): mesmo
  // estado/lógica de sempre, só troca quem desenha a tela - ver
  // skins/orbit/OrbitApp.jsx. Guardado, senão a cada refresh voltava pro
  // clássico sem avisar.
  const [interfaceTeste, setInterfaceTeste] = useState(
    () => localStorage.getItem('discord-caseiro:interface-teste') === '1',
  );
  useEffect(() => {
    localStorage.setItem('discord-caseiro:interface-teste', interfaceTeste ? '1' : '0');
  }, [interfaceTeste]);

  // Mensagens diretas vivem paralelas aos servidores: mesma forma dos estados
  // acima (mensagens/estado do canal/nao-lidas), so que por dmChannelId.
  const [dmMode, setDmMode] = useState(false);
  const [dms, setDms] = useState([]);
  const [activeDmId, setActiveDmId] = useState(null);
  const [dmMessages, setDmMessages] = useState({});
  const [dmChannelState, setDmChannelState] = useState({});
  const [dmUnread, setDmUnread] = useState({});
  // userId -> { online, status, activity }. Substituiu o antigo Set de ids
  // online: agora precisamos saber também o status escolhido e o que a pessoa
  // está jogando, não só se ela está conectada.
  const [presencas, setPresencas] = useState({});
  const [typing, setTyping] = useState({});
  const [modal, setModal] = useState(null);
  const [sendError, setSendError] = useState(null);
  const [profileToken, setProfileToken] = useState(0);
  // Tela cheia, separada do resto dos modais - fica aberta por baixo mesmo
  // se a pessoa abrir o editor de perfil de dentro dela.
  const [configuracoesAbertas, setConfiguracoesAbertas] = useState(false);
  // Se a call ocupa o lugar do chat (igual ao Discord) ou nao. So o audio
  // continua tocando quando ela nao esta maximizada - quem cuida disso e o
  // VoiceAudioSink, montado sempre, independente deste estado.
  const [callMaximizada, setCallMaximizada] = useState(false);
  // O socket tambem vira estado (nao so ref) porque o hook de voz precisa
  // reagir a ele.
  const [socket, setSocket] = useState(null);
  // Avisado que saiu versão nova: recarrega sozinho quando não tiver
  // ninguém numa chamada pra não cortar áudio/vídeo de ninguém no meio.
  const [atualizacaoPendente, setAtualizacaoPendente] = useState(false);
  // Aviso curto e flutuante (resultado de comando, erro de ação de menu...).
  const [aviso, setAviso] = useState(null);
  // Texto que o menu de contexto quer empurrar pro campo de mensagem. O
  // `token` faz o efeito disparar de novo mesmo mencionando a mesma pessoa.
  const [inserirNoCampo, setInserirNoCampo] = useState(null);
  const [meuStatus, setMeuStatus] = useState('online');
  const [membrosVisiveis, setMembrosVisiveis] = useState(true);
  // socketId de quem estamos assistindo a transmissao; null = ninguem.
  const [telaAssistida, setTelaAssistida] = useState(null);
  // Quando a pessoa escreve a atividade com /jogando, a detecção automática
  // do app de desktop para de sobrescrever.
  const atividadeManualRef = useRef(false);
  const menuContexto = useContextMenu();
  // Níveis de notificação por servidor/canal/DM, carregados do servidor.
  const [notifSettings, setNotifSettings] = useState({});
  // Os handlers do socket são montados uma vez só; sem refs eles leriam para
  // sempre o valor que essas variáveis tinham na primeira renderização.
  const notifSettingsRef = useRef({});
  const statusRef = useRef('online');

  const { voice, voiceRooms, voiceVotacoes, voiceConvite, voiceActions } = useVoice(socket);

  // A barra de DM só precisa saber quem está online; monta o Set a partir das
  // presenças pra não manter dois estados dizendo a mesma coisa.
  const onlineIds = useMemo(
    () => new Set(Object.entries(presencas).filter(([, p]) => p.online).map(([id]) => id)),
    [presencas],
  );

  // Minhas permissões neste servidor. Só decide o que MOSTRAR - o servidor
  // refaz a checagem em toda ação, então isto nunca é a única barreira.
  const guildMembroDeMim = guild?.members.find((m) => m.id === me?.id) ?? null;
  const podeGerenciarMensagens = temPermissao(guildMembroDeMim, guild, PERM.GERENCIAR_MENSAGENS);
  const podeGerenciarCanais = temPermissao(guildMembroDeMim, guild, PERM.GERENCIAR_CANAIS);
  const podeGerenciarServidor = temPermissao(guildMembroDeMim, guild, PERM.GERENCIAR_SERVIDOR);
  const minhaAtividade = presencas[me?.id]?.activity ?? null;

  useEffect(() => {
    if (atualizacaoPendente && !voice.channelId) window.location.reload();
  }, [atualizacaoPendente, voice.channelId]);

  /**
   * Detecta sozinho quando um deploy novo saiu, sem precisar que alguém
   * clique em "Recarregar todo mundo" nas configurações: de tempos em
   * tempos busca a index.html de novo e compara o arquivo do bundle
   * (o nome muda a cada build, o Vite grava um hash nele) com o que essa
   * aba já tem carregado. Mudou = tem versão nova, mostra o mesmo aviso.
   */
  useEffect(() => {
    const scriptAtual = document.querySelector('script[type="module"]')?.getAttribute('src');
    if (!scriptAtual) return;
    const checar = async () => {
      try {
        const resposta = await fetch('/', { cache: 'no-store' });
        const html = await resposta.text();
        const [, scriptNovo] = html.match(/<script[^>]+type="module"[^>]+src="([^"]+)"/) ?? [];
        if (scriptNovo && scriptNovo !== scriptAtual) setAtualizacaoPendente(true);
      } catch {
        // sem internet/servidor fora do ar por um instante - tenta de novo depois
      }
    };
    const intervalo = setInterval(checar, 3 * 60 * 1000);
    return () => clearInterval(intervalo);
  }, []);

  // Quem estávamos assistindo parou de transmitir (ou saiu): volta pra grade
  // em vez de deixar um quadro preto na tela.
  useEffect(() => {
    if (!telaAssistida) return;
    const ainda = voice.peers.some((p) => p.socketId === telaAssistida && p.state.screen);
    if (!ainda) setTelaAssistida(null);
  }, [telaAssistida, voice.peers]);

  // Saiu da call inteira (botão de desligar, expulso, etc): não faz sentido
  // continuar "maximizada" pra próxima vez que entrar em alguma.
  useEffect(() => {
    if (!voice.channelId) setCallMaximizada(false);
  }, [voice.channelId]);

  // Alguém além de você liga câmera ou compartilha tela: a call pula pra
  // frente sozinha, igual ao Discord quando alguém começa a apresentar.
  const outrosComVideo = temVideoDeOutros(voice);
  useEffect(() => {
    if (outrosComVideo) setCallMaximizada(true);
  }, [outrosComVideo]);

  useEffect(() => { if (me) pedirPermissaoDeNotificacao(); }, [me]);

  const socketRef = useRef(null);
  const activeChannelRef = useRef(null);
  const activeGuildRef = useRef(null);
  const activeDmRef = useRef(null);
  const dmModeRef = useRef(false);
  const guildRef = useRef(null);

  activeChannelRef.current = activeChannelId;
  activeGuildRef.current = activeGuildId;
  activeDmRef.current = activeDmId;
  dmModeRef.current = dmMode;
  guildRef.current = guild;
  notifSettingsRef.current = notifSettings;
  statusRef.current = meuStatus;

  /* --------------------------- sessao e socket --------------------------- */

  useEffect(() => {
    if (!getToken()) { setBooting(false); return; }
    api.me()
      .then(({ user }) => setMe(user))
      .catch(() => clearToken())
      .finally(() => setBooting(false));
  }, []);

  const upsertMessage = useCallback((channelId, message, nonce) => {
    setMessages((prev) => {
      const list = prev[channelId] ?? [];
      // Tira o rascunho otimista (pelo nonce, ou pelo par autor+conteudo se o
      // broadcast chegou antes da confirmacao) e evita duplicar a mensagem real.
      const cleaned = list.filter((m) => {
        if (!m.pending) return true;
        if (nonce && m.nonce === nonce) return false;
        return !(m.author.id === message.author.id && m.content === message.content);
      });
      if (cleaned.some((m) => m.id === message.id)) return { ...prev, [channelId]: cleaned };
      return { ...prev, [channelId]: [...cleaned, message] };
    });
  }, []);

  const upsertDmMessage = useCallback((dmChannelId, message, nonce) => {
    setDmMessages((prev) => {
      const list = prev[dmChannelId] ?? [];
      const cleaned = list.filter((m) => {
        if (!m.pending) return true;
        if (nonce && m.nonce === nonce) return false;
        return !(m.author.id === message.author.id && m.content === message.content);
      });
      if (cleaned.some((m) => m.id === message.id)) return { ...prev, [dmChannelId]: cleaned };
      return { ...prev, [dmChannelId]: [...cleaned, message] };
    });
  }, []);

  useEffect(() => {
    if (!me) return undefined;

    const socket = createSocket(getToken(), {
      connect: () => setConnected(true),
      disconnect: () => setConnected(false),

      'presence:sync': ({ online, presences }) => {
        // `presences` traz status e atividade; `online` é a lista crua e serve
        // de rede de segurança caso o servidor seja mais antigo que o cliente.
        const mapa = {};
        for (const id of online ?? []) mapa[id] = { online: true, status: 'online', activity: null };
        for (const p of presences ?? []) mapa[p.userId] = p;
        setPresencas(mapa);
      },
      'presence:update': (p) =>
        setPresencas((prev) => ({ ...prev, [p.userId]: p })),

      'message:reactions': ({ channelId, dmChannelId, messageId, reactions }) => {
        const aplicar = (lista) => lista.map((m) => (m.id === messageId ? { ...m, reactions } : m));
        if (dmChannelId) {
          setDmMessages((prev) => (prev[dmChannelId]
            ? { ...prev, [dmChannelId]: aplicar(prev[dmChannelId]) } : prev));
        } else {
          setMessages((prev) => (prev[channelId]
            ? { ...prev, [channelId]: aplicar(prev[channelId]) } : prev));
        }
      },

      'message:updated': ({ message }) => {
        const trocar = (lista) => lista.map((m) => (m.id === message.id ? message : m));
        if (message.dmChannelId) {
          setDmMessages((prev) => (prev[message.dmChannelId]
            ? { ...prev, [message.dmChannelId]: trocar(prev[message.dmChannelId]) } : prev));
        } else {
          setMessages((prev) => (prev[message.channelId]
            ? { ...prev, [message.channelId]: trocar(prev[message.channelId]) } : prev));
        }
      },

      'message:deleted': ({ channelId, dmChannelId, messageId }) => {
        const tirar = (lista) => lista.filter((m) => m.id !== messageId);
        if (dmChannelId) {
          setDmMessages((prev) => (prev[dmChannelId]
            ? { ...prev, [dmChannelId]: tirar(prev[dmChannelId]) } : prev));
        } else {
          setMessages((prev) => (prev[channelId]
            ? { ...prev, [channelId]: tirar(prev[channelId]) } : prev));
        }
      },

      'channel:updated': (channel) =>
        setGuild((prev) => (prev && prev.id === channel.guildId
          ? { ...prev, channels: prev.channels.map((c) => (c.id === channel.id ? channel : c)) }
          : prev)),

      // Nome, ícone, descrição ou "é público" mudaram - o próprio evento já
      // vem com o servidor inteiro, não precisa buscar de novo.
      'guild:updated': (guild) => {
        setGuilds((prev) => prev.map((g) => (g.id === guild.id ? { ...g, ...guild } : g)));
        setGuild((prev) => (prev && prev.id === guild.id ? { ...prev, ...guild } : prev));
      },

      'role:updated': ({ guildId }) => refreshGuildIfActive(guildId),
      'role:deleted': ({ guildId }) => refreshGuildIfActive(guildId),
      'category:created': ({ guildId }) => refreshGuildIfActive(guildId),
      'category:deleted': ({ guildId }) => refreshGuildIfActive(guildId),

      'guild:banned': ({ guildId }) => {
        setGuilds((prev) => prev.filter((g) => g.id !== guildId));
        if (activeGuildRef.current === guildId) { setActiveGuildId(null); setGuild(null); }
      },

      'message:new': ({ guildId, message }) => {
        upsertMessage(message.channelId, message);
        const estouVendoEsseCanal = !dmModeRef.current && message.channelId === activeChannelRef.current;
        if (!estouVendoEsseCanal && message.author.id !== me.id) {
          setUnread((prev) => ({
            ...prev,
            [message.channelId]: {
              guildId,
              count: (prev[message.channelId]?.count ?? 0) + 1,
            },
          }));
          // Notifica só quem foi marcado de verdade (@nome ou @everyone) -
          // mensagem normal já tem o indicador de não-lida, isso aqui é
          // pra não deixar passar batido quando é com você mesmo.
          const ehMencao = mensagemMenciona(message.content, me.id);
          if (deveNotificar({
            settings: notifSettingsRef.current,
            status: statusRef.current,
            guildId,
            channelId: message.channelId,
            ehMencao,
          })) {
            const corpo = textoLegivel(message.content, guildRef.current?.members) || '📎 anexo';
            notificar(
              ehMencao ? `${message.author.username} marcou você` : message.author.username,
              corpo,
            );
          }
        }
      },

      'dm:new': ({ message }) => {
        upsertDmMessage(message.dmChannelId, message);
        setDms((prev) => {
          const existente = prev.find((c) => c.id === message.dmChannelId);
          // Primeira mensagem de uma conversa que a gente ainda nao tinha na
          // lista (alguem te chamou pela primeira vez): o autor da mensagem
          // e a prova de quem e o "outro lado" - da pra montar a conversa
          // sem precisar de outra ida ao servidor.
          const base = existente ?? { id: message.dmChannelId, otherUser: message.author, lastMessage: null };
          const atualizada = {
            ...base,
            lastMessage: {
              content: message.content, attachment: message.attachment,
              createdAt: message.createdAt, authorId: message.author.id,
            },
          };
          return [atualizada, ...prev.filter((c) => c.id !== message.dmChannelId)];
        });
        const estouVendoEssaDm = dmModeRef.current && message.dmChannelId === activeDmRef.current;
        if (!estouVendoEssaDm && message.author.id !== me.id) {
          setDmUnread((prev) => ({ ...prev, [message.dmChannelId]: (prev[message.dmChannelId] ?? 0) + 1 }));
          // Numa conversa direta tudo conta como falar com você, então
          // "só menções" e "tudo" dão no mesmo - quem cala é "nada",
          // o silêncio temporário ou o "não perturbe".
          if (deveNotificar({
            settings: notifSettingsRef.current,
            status: statusRef.current,
            dmChannelId: message.dmChannelId,
            ehMencao: true,
          })) {
            notificar(message.author.username, message.content || '📎 anexo');
          }
        }
      },

      'app:reload': () => setAtualizacaoPendente(true),

      'typing:start': ({ channelId, user }) => {
        if (user.id === me.id) return;
        setTyping((prev) => ({
          ...prev,
          [channelId]: { ...(prev[channelId] ?? {}), [user.id]: { username: user.username, until: Date.now() + TYPING_TTL } },
        }));
      },

      'channel:created': (channel) =>
        setGuild((prev) =>
          prev && prev.id === channel.guildId
            ? { ...prev, channels: [...prev.channels, channel] }
            : prev),

      'channel:deleted': ({ id, guildId }) => {
        setGuild((prev) =>
          prev && prev.id === guildId
            ? { ...prev, channels: prev.channels.filter((c) => c.id !== id) }
            : prev);
        if (activeChannelRef.current === id) setActiveChannelId(null);
      },

      'user:updated': ({ user }) => applyUserUpdate(user),

      'member:joined': ({ guildId }) => refreshGuildIfActive(guildId),
      'member:left': ({ guildId, userId }) => {
        if (userId === me.id) {
          setGuilds((prev) => prev.filter((g) => g.id !== guildId));
          if (activeGuildRef.current === guildId) { setActiveGuildId(null); setGuild(null); }
          socket.emit('guild:unsubscribe', { guildId });
          return;
        }
        refreshGuildIfActive(guildId);
      },
      'member:updated': ({ guildId }) => refreshGuildIfActive(guildId),
    });

    /** Perfil trocado: atualiza a lista de membros e as mensagens ja na tela. */
    function applyUserUpdate(user) {
      if (user.id === me.id) setMe((prev) => ({ ...prev, ...user }));

      setGuild((prev) => (prev
        ? { ...prev, members: prev.members.map((m) => (m.id === user.id ? { ...m, ...user } : m)) }
        : prev));

      setMessages((prev) => {
        const next = {};
        for (const [channelId, list] of Object.entries(prev)) {
          next[channelId] = list.map((m) => (m.author.id === user.id
            ? { ...m, author: { ...m.author, ...user } }
            : m));
        }
        return next;
      });
    }

    function refreshGuildIfActive(guildId) {
      if (activeGuildRef.current !== guildId) return;
      api.getGuild(guildId).then(({ guild: fresh }) => setGuild(fresh)).catch(() => {});
    }

    socketRef.current = socket;
    setSocket(socket);
    return () => {
      socket.close();
      socketRef.current = null;
      setSocket(null);
      setConnected(false);
    };
    // So o id importa aqui: se dependesse do objeto inteiro, trocar o avatar
    // derrubaria e reabriria o socket a cada salvamento.
  }, [me?.id, upsertMessage, upsertDmMessage]);

  /** Níveis de notificação salvos: chegam uma vez e ficam em memória. */
  useEffect(() => {
    if (!me) return;
    api.listNotificationSettings()
      .then(({ settings }) => setNotifSettings(Object.fromEntries(
        settings.map((s) => [chaveDe(s.scopeType, s.scopeId), s]),
      )))
      .catch(() => {});
  }, [me?.id]);

  /** Salva o nível/silêncio de um escopo e guarda o resultado em memória. */
  async function definirNotificacao(scopeType, scopeId, mudanca) {
    const atual = configDe(notifSettings, scopeType, scopeId);
    const payload = {
      scopeType, scopeId,
      level: mudanca.level ?? atual.level,
      mutedUntil: mudanca.mutedUntil === undefined ? atual.mutedUntil : mudanca.mutedUntil,
    };
    try {
      const salvo = await api.setNotificationSetting(payload);
      setNotifSettings((prev) => {
        const next = { ...prev };
        // Voltar ao padrão significa não guardar nada.
        if (salvo.level === 'all' && !salvo.mutedUntil) delete next[chaveDe(scopeType, scopeId)];
        else next[chaveDe(scopeType, scopeId)] = salvo;
        return next;
      });
    } catch (err) { setAviso(err.message); }
  }

  /** Submenu de notificação, igual pra servidor, canal e conversa. */
  function itensDeNotificacao(scopeType, scopeId) {
    const config = configDe(notifSettings, scopeType, scopeId);
    const silenciado = Boolean(config.mutedUntil && config.mutedUntil > Date.now());
    return [
      {
        tipo: 'sub',
        label: silenciado ? 'Silenciado' : 'Notificações',
        icone: <Icon name={silenciado ? 'bell-off' : 'bell'} size={15} />,
        itens: [
          ...NIVEIS.map((n) => ({
            key: n.id,
            label: n.label,
            marcado: config.level === n.id,
            onClick: () => definirNotificacao(scopeType, scopeId, { level: n.id }),
          })),
          { tipo: 'sep' },
          ...(silenciado
            ? [{ label: 'Tirar o silêncio', onClick: () => definirNotificacao(scopeType, scopeId, { mutedUntil: null }) }]
            : DURACOES_DE_SILENCIO.map((d) => ({
              key: d.label,
              label: `Silenciar ${d.label.toLowerCase()}`,
              onClick: () => definirNotificacao(scopeType, scopeId, {
                mutedUntil: d.ms === null ? PARA_SEMPRE : Date.now() + d.ms,
              }),
            }))),
        ],
      },
    ];
  }

  // Detecção de jogo (só no app de desktop) e ausência automática.
  useDeteccaoDeJogo(socket, { ativo: Boolean(me), manualRef: atividadeManualRef });
  useAusenciaAutomatica(socket, { statusEscolhido: meuStatus });

  /** O aviso flutuante some sozinho - clicar nele também fecha. */
  useEffect(() => {
    if (!aviso) return undefined;
    const timer = setTimeout(() => setAviso(null), AVISO_TTL);
    return () => clearTimeout(timer);
  }, [aviso]);

  /** Limpa quem parou de digitar. */
  useEffect(() => {
    const timer = setInterval(() => {
      setTyping((prev) => {
        const now = Date.now();
        let changed = false;
        const next = {};
        for (const [channelId, users] of Object.entries(prev)) {
          const alive = Object.fromEntries(
            Object.entries(users).filter(([, info]) => info.until > now));
          if (Object.keys(alive).length !== Object.keys(users).length) changed = true;
          if (Object.keys(alive).length) next[channelId] = alive;
        }
        return changed ? next : prev;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  /* ------------------------- servidores e canais ------------------------- */

  useEffect(() => {
    if (!me) return;
    api.listGuilds().then(({ guilds: list }) => {
      setGuilds(list);
      setActiveGuildId((current) => current ?? list[0]?.id ?? null);
    }).catch(() => {});
  }, [me]);

  useEffect(() => {
    if (!activeGuildId) { setGuild(null); return; }
    api.getGuild(activeGuildId).then(({ guild: detail }) => {
      setGuild(detail);
      const firstText = detail.channels.find((c) => c.type === 'text');
      setActiveChannelId((current) =>
        detail.channels.some((c) => c.id === current) ? current : firstText?.id ?? null);
    }).catch(() => {});

    // Não-lidas de verdade: vêm da marca de leitura guardada no servidor, e
    // não do que aconteceu nesta aba - senão o contador zeraria a cada F5.
    api.naoLidas(activeGuildId).then(({ unread }) => {
      // O canal que abre sozinho ao entrar no servidor não passa pelo
      // selectChannel (que é quem guarda isso ao clicar) - sem isso aqui,
      // reabrir o app numa não-lida sempre cairia direto no fim do chat.
      setMarcadorNaoLidas((prev) => {
        const next = { ...prev };
        for (const [channelId, count] of Object.entries(unread)) {
          if (next[channelId] === undefined) next[channelId] = count;
        }
        return next;
      });
      setUnread((prev) => {
        const next = { ...prev };
        for (const [channelId, count] of Object.entries(unread)) {
          // O canal aberto agora conta como lido.
          if (channelId === activeChannelRef.current) continue;
          next[channelId] = { guildId: activeGuildId, count };
        }
        return next;
      });
    }).catch(() => {});
  }, [activeGuildId]);

  const loadHistory = useCallback(async (channelId, before) => {
    setChannelState((prev) => ({ ...prev, [channelId]: { ...prev[channelId], loading: true } }));
    try {
      const { messages: page, hasMore } = await api.messages(channelId, { before });
      setMessages((prev) => ({ ...prev, [channelId]: [...page, ...(before ? prev[channelId] ?? [] : [])] }));
      setChannelState((prev) => ({ ...prev, [channelId]: { loading: false, hasMore, loaded: true } }));
    } catch {
      setChannelState((prev) => ({ ...prev, [channelId]: { loading: false, hasMore: false, loaded: true } }));
    }
  }, []);

  // O `loading` no teste não é enfeite: este efeito depende de channelState
  // inteiro, e loadHistory marca loading logo de cara. Sem checar isso, cada
  // canal aberto disparava um punhado de buscas iguais em paralelo, até a
  // primeira resposta chegar e marcar loaded.
  useEffect(() => {
    if (!activeChannelId) return;
    const estado = channelState[activeChannelId];
    if (!estado?.loaded && !estado?.loading) loadHistory(activeChannelId);
  }, [activeChannelId, channelState, loadHistory]);

  /* ------------------------------ mensagens diretas ------------------------------ */

  useEffect(() => {
    if (!me) return;
    api.listDms().then(({ conversations }) => setDms(conversations)).catch(() => {});
  }, [me]);

  const loadDmHistory = useCallback(async (dmChannelId, before) => {
    setDmChannelState((prev) => ({ ...prev, [dmChannelId]: { ...prev[dmChannelId], loading: true } }));
    try {
      const { messages: page, hasMore } = await api.dmMessages(dmChannelId, { before });
      setDmMessages((prev) => ({ ...prev, [dmChannelId]: [...page, ...(before ? prev[dmChannelId] ?? [] : [])] }));
      setDmChannelState((prev) => ({ ...prev, [dmChannelId]: { loading: false, hasMore, loaded: true } }));
    } catch {
      setDmChannelState((prev) => ({ ...prev, [dmChannelId]: { loading: false, hasMore: false, loaded: true } }));
    }
  }, []);

  // Mesma armadilha do histórico de canal - ver o comentário lá em cima.
  useEffect(() => {
    if (!activeDmId) return;
    const estado = dmChannelState[activeDmId];
    if (!estado?.loaded && !estado?.loading) loadDmHistory(activeDmId);
  }, [activeDmId, dmChannelState, loadDmHistory]);

  function selectDm(dmChannelId) {
    setActiveDmId(dmChannelId);
    setDmMode(true);
    setCallMaximizada(false);
    setSendError(null);
    setDmUnread((prev) => {
      if (!prev[dmChannelId]) return prev;
      const next = { ...prev };
      delete next[dmChannelId];
      return next;
    });
  }

  async function iniciarConversa(userId) {
    const { conversation } = await api.openDm(userId);
    setDms((prev) => (prev.some((c) => c.id === conversation.id) ? prev : [conversation, ...prev]));
    setModal(null);
    selectDm(conversation.id);
  }

  async function sendDmMessage(content, attachment = null, replyToId = null) {
    const dmChannelId = activeDmId;
    const nonce = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    setDmMessages((prev) => ({
      ...prev,
      [dmChannelId]: [...(prev[dmChannelId] ?? []), {
        id: `tmp-${nonce}`, nonce, pending: true, dmChannelId, content, attachment,
        createdAt: Date.now(), author: { id: me.id, username: me.username, avatarUrl: null },
      }],
    }));

    const response = await emitAck(socketRef.current, 'dm:send', {
      dmChannelId, content, attachment, replyToId, nonce,
    });
    if (response?.error) {
      setSendError(response.error);
      setDmMessages((prev) => ({
        ...prev,
        [dmChannelId]: (prev[dmChannelId] ?? []).filter((m) => m.nonce !== nonce),
      }));
      return;
    }
    setSendError(null);
    upsertDmMessage(dmChannelId, response.message, nonce);
    setDms((prev) => {
      const atual = prev.find((c) => c.id === dmChannelId);
      const atualizada = {
        ...atual,
        lastMessage: {
          content: response.message.content, attachment: response.message.attachment,
          createdAt: response.message.createdAt, authorId: me.id,
        },
      };
      return [atualizada, ...prev.filter((c) => c.id !== dmChannelId)];
    });
  }

  const selectChannel = (channelId) => {
    // Guarda quantas mensagens estavam não lidas ANTES de marcar como lido -
    // é o que deixa a tela abrir bem em cima delas em vez de pular direto
    // pro fim (só quando já está tudo lido é que faz sentido abrir no fim).
    setMarcadorNaoLidas((prev) => ({ ...prev, [channelId]: unread[channelId]?.count ?? 0 }));
    setActiveChannelId(channelId);
    setCallMaximizada(false);   // igual ao Discord: olhar pro chat encolhe a call
    setSendError(null);
    // Marca no servidor, senão o contador voltaria ao recarregar a página.
    socketRef.current?.emit('channel:read', { channelId });
    setUnread((prev) => {
      if (!prev[channelId]) return prev;
      const next = { ...prev };
      delete next[channelId];
      return next;
    });
  };

  /**
   * Clicar num canal de voz: se já está conectado nele, alterna entre
   * maximizar e minimizar a call (nunca sai). Se não está, entra e já
   * maximiza - igual ao Discord.
   */
  function alternarCanalDeVoz(channelId) {
    if (voice.channelId === channelId) {
      setCallMaximizada((v) => !v);
    } else {
      voiceActions.join(channelId);
      setCallMaximizada(true);
    }
  }

  /* ------------------------- acoes de mensagem ------------------------- */

  const reagir = (messageId, emoji) =>
    socketRef.current?.emit('message:react', { messageId, emoji });

  const editarMensagem = (messageId, content) =>
    emitAck(socketRef.current, 'message:edit', { messageId, content })
      .then((r) => { if (r?.error) setSendError(r.error); });

  const fixarMensagem = (messageId, pinned) =>
    emitAck(socketRef.current, 'message:pin', { messageId, pinned })
      .then((r) => { if (r?.error) setSendError(r.error); });

  function apagarMensagem(messageId) {
    setModal({
      type: 'confirm',
      title: 'Excluir mensagem',
      message: 'Isso apaga a mensagem pra todo mundo. Tem certeza?',
      confirmLabel: 'Excluir',
      onConfirm: () => emitAck(socketRef.current, 'message:delete', { messageId })
        .then((r) => { if (r?.error) setSendError(r.error); }),
    });
  }

  /* ----------------------------- presenca ------------------------------ */

  const presenceActions = useMemo(() => ({
    definir: ({ status, activity, manual }) => {
      // Atividade posta na mão trava a detecção automática do app de desktop:
      // senão o próximo ciclo de detecção sobrescreveria o que a pessoa
      // escolheu escrever.
      if (manual !== undefined) atividadeManualRef.current = manual && Boolean(activity);
      socketRef.current?.emit('presence:set', { status, activity });
      if (status) setMeuStatus(status);
    },
  }), []);

  /* ----------------------------- comandos ------------------------------ */

  async function rodarComando({ comando, argumento }) {
    try {
      const saida = await comando.run({
        argumento, me, guild, voice, voiceActions, presenceActions, api,
        activeChannelId: dmMode ? null : activeChannelId,
      });
      if (saida?.texto) {
        if (dmMode) sendDmMessage(saida.texto, null);
        else sendMessage(saida.texto, null);
      }
      if (saida?.aviso) setAviso(saida.aviso);
    } catch (err) {
      setAviso(err?.message ?? 'não consegui rodar esse comando');
    }
  }

  /* ------------------- acoes do menu de uma pessoa -------------------- */

  const acoesDoMembro = {
    abrirPerfil: (m) => setModal({ type: 'profile', userId: m.id }),
    mencionar: (m) => setInserirNoCampo({ texto: `@${m.username} `, token: Date.now() }),
    abrirDm: async (m) => {
      try {
        const { dm } = await api.openDm(m.id);
        setDms((prev) => (prev.some((c) => c.id === dm.id) ? prev : [dm, ...prev]));
        setDmMode(true);
        setActiveDmId(dm.id);
      } catch (err) { setAviso(err.message); }
    },
    chamarParaCall: voice.channelId ? (m) => {
      voiceActions.convidar(m.id);
      setAviso(`Chamei ${m.username} pra call.`);
    } : null,
    abrirNota: (m) => setModal({ type: 'nota', membro: m }),
    mudarApelido: (m) => setModal({ type: 'apelido', membro: m }),
    alternarCargo: async (m, cargo) => {
      const tem = m.roles?.includes(cargo.id);
      try {
        if (tem) await api.removeMemberRole(guild.id, m.id, cargo.id);
        else await api.addMemberRole(guild.id, m.id, cargo.id);
      } catch (err) { setAviso(err.message); }
    },
    castigar: async (m, minutos) => {
      try {
        await api.timeoutMember(guild.id, m.id, minutos);
        setAviso(minutos > 0
          ? `${m.username} ficou de castigo por ${minutos} min.`
          : `Castigo de ${m.username} removido.`);
      } catch (err) { setAviso(err.message); }
    },
    expulsar: (m) => setModal({
      type: 'confirm',
      title: 'Expulsar membro',
      message: `Expulsar ${m.username} do servidor? Ele pode voltar com um convite novo.`,
      confirmLabel: 'Expulsar',
      onConfirm: () => api.removeMember(guild.id, m.id).catch((e) => setAviso(e.message)),
    }),
    banir: (m) => setModal({
      type: 'confirm',
      title: 'Banir membro',
      message: `Banir ${m.username}? Ele sai do servidor e não consegue voltar por convite.`,
      confirmLabel: 'Banir',
      onConfirm: () => api.banMember(guild.id, m.id, null).catch((e) => setAviso(e.message)),
    }),
  };

  /** Handler de botão direito em cima de uma pessoa da lista de membros. */
  const menuDoMembro = (membro, { euMembro }) => menuContexto.abrirCom(() => itensDoMembro({
    membro,
    euMembro,
    guild,
    souEu: membro.id === me.id,
    acoes: acoesDoMembro,
  }));

  /** Botão direito em cima de alguém que está numa call. */
  const menuDoParticipanteDeVoz = (participante) => menuContexto.abrirCom(() => {
    const membro = guild?.members.find((m) => m.id === participante.user.id) ?? participante.user;
    const souEu = participante.socketId === voice.socketId;
    const base = itensDoMembro({
      membro, euMembro: guildMembroDeMim, guild, souEu, acoes: acoesDoMembro,
    });
    if (souEu) return base;

    const extras = [
      { tipo: 'sep' },
      {
        tipo: 'slider',
        label: 'Volume',
        valor: Math.round((voiceActions.volumeDe(participante.socketId) ?? 1) * 100),
        min: 0,
        max: 200,
        onChange: (v) => voiceActions.definirVolume(participante.socketId, v / 100),
      },
      {
        label: voiceActions.estaSilenciadoLocal(participante.socketId) ? 'Ouvir de novo' : 'Silenciar só pra mim',
        icone: <Icon name="mic-off" size={15} />,
        onClick: () => voiceActions.alternarSilencioLocal(participante.socketId),
      },
    ];

    // Assistir a transmissão é ação separada de estar na call - dá pra estar
    // no canal sem abrir o vídeo de ninguém.
    if (participante.state.screen) {
      extras.push({
        label: 'Assistir transmissão', icone: <Icon name="monitor" size={15} />,
        onClick: () => { setCallMaximizada(true); setTelaAssistida(participante.socketId); },
      });
    }

    const mandaNele = podeAgirSobreMembro(guildMembroDeMim, membro, guild);

    if (mandaNele && temPermissao(guildMembroDeMim, guild, PERM.SILENCIAR_MEMBROS)) {
      extras.push({ tipo: 'sep' });
      extras.push({
        label: participante.state.serverMuted ? 'Tirar silêncio do servidor' : 'Silenciar no servidor',
        icone: <Icon name="mic-off" size={15} />,
        onClick: () => voiceActions.moderar(participante.socketId, {
          serverMuted: !participante.state.serverMuted,
        }),
      });
    }
    if (mandaNele && temPermissao(guildMembroDeMim, guild, PERM.ENSURDECER_MEMBROS)) {
      extras.push({
        label: participante.state.serverDeafened ? 'Deixar ouvir de novo' : 'Ensurdecer no servidor',
        icone: <Icon name="headphones" size={15} />,
        onClick: () => voiceActions.moderar(participante.socketId, {
          serverDeafened: !participante.state.serverDeafened,
        }),
      });
    }

    const outrosCanaisDeVoz = (guild?.channels ?? [])
      .filter((c) => c.type === 'voice' && c.id !== voice.channelId);
    if (mandaNele && temPermissao(guildMembroDeMim, guild, PERM.MOVER_MEMBROS) && outrosCanaisDeVoz.length) {
      extras.push({
        tipo: 'sub',
        label: 'Mover para',
        icone: <Icon name="arrow-right" size={15} />,
        itens: outrosCanaisDeVoz.map((c) => ({
          key: c.id, label: c.name, onClick: () => voiceActions.mover(participante.socketId, c.id),
        })),
      });
    }

    extras.push({ tipo: 'sep' });
    if (mandaNele && temPermissao(guildMembroDeMim, guild, PERM.MOVER_MEMBROS)) {
      extras.push({
        label: 'Desconectar da chamada', icone: <Icon name="power" size={15} />, perigo: true,
        onClick: () => voiceActions.expulsar(participante.socketId),
      });
    } else {
      extras.push({
        label: 'Votar pra expulsar da call', icone: <Icon name="hand" size={15} />,
        onClick: () => voiceActions.votarExpulsao(participante.socketId),
      });
    }

    return [...base, ...extras];
  });

  /** Botão direito em cima de um canal na barra lateral. */
  const menuDoCanal = (canal) => menuContexto.abrirCom(() => {
    const itens = [{ tipo: 'titulo', label: canal.name }];
    if (canal.type === 'text') {
      itens.push({
        label: 'Marcar como lido',
        icone: <Icon name="check" size={15} />,
        onClick: () => {
          socketRef.current?.emit('channel:read', { channelId: canal.id });
          setUnread((prev) => {
            const next = { ...prev };
            delete next[canal.id];
            return next;
          });
        },
      });
    }
    if (canal.type === 'text') itens.push(...itensDeNotificacao('channel', canal.id));
    if (podeGerenciarCanais) {
      itens.push({ label: 'Editar canal', icone: <Icon name="pencil" size={15} />, onClick: () => setModal({ type: 'editar-canal', canal }) });
    }
    itens.push({ label: 'Convidar pessoas', icone: <Icon name="plus" size={15} />, onClick: () => setModal({ type: 'invite' }) });
    itens.push({ tipo: 'sep' });
    itens.push({
      label: 'Copiar ID',
      icone: '#',
      onClick: () => navigator.clipboard?.writeText(canal.id).catch(() => {}),
    });
    if (podeGerenciarCanais) {
      itens.push({ tipo: 'sep' });
      itens.push({ label: 'Excluir canal', icone: <Icon name="trash" size={15} />, perigo: true, onClick: () => deleteChannel(canal) });
    }
    return itens;
  });

  const menuDaCategoria = (categoria) => menuContexto.abrirCom(() => {
    if (!podeGerenciarCanais) return [{ tipo: 'titulo', label: categoria.name }];
    return [
      { tipo: 'titulo', label: categoria.name },
      { label: 'Novo canal aqui', icone: <Icon name="plus" size={15} />, onClick: () => setModal({ type: 'create-channel', channelType: 'text', categoryId: categoria.id }) },
      { tipo: 'sep' },
      {
        label: 'Excluir categoria',
        icone: <Icon name="trash" size={15} />,
        perigo: true,
        onClick: () => setModal({
          type: 'confirm',
          title: 'Excluir categoria',
          message: `Excluir "${categoria.name}"? Os canais de dentro voltam pro topo, sem sumir.`,
          confirmLabel: 'Excluir',
          onConfirm: () => api.deleteCategory(guild.id, categoria.id).catch((e) => setAviso(e.message)),
        }),
      },
    ];
  });

  const menuDaGuild = menuContexto.abrirCom(() => {
    if (!guild) return [];
    const itens = [{ tipo: 'titulo', label: guild.name }];
    itens.push({
      label: 'Marcar tudo como lido',
      icone: <Icon name="check" size={15} />,
      onClick: () => {
        for (const c of guild.channels) {
          if (c.type === 'text') socketRef.current?.emit('channel:read', { channelId: c.id });
        }
        setUnread((prev) => Object.fromEntries(
          Object.entries(prev).filter(([, info]) => info.guildId !== guild.id),
        ));
      },
    });
    itens.push({ label: 'Convidar pessoas', icone: <Icon name="plus" size={15} />, onClick: () => setModal({ type: 'invite' }) });
    itens.push(...itensDeNotificacao('guild', guild.id));
    if (podeGerenciarCanais) {
      itens.push({ tipo: 'sep' });
      itens.push({ label: 'Criar canal', icone: '#', onClick: () => setModal({ type: 'create-channel', channelType: 'text' }) });
      itens.push({ label: 'Criar categoria', icone: <Icon name="folder-plus" size={15} />, onClick: () => setModal({ type: 'criar-categoria' }) });
    }
    if (podeGerenciarServidor) {
      itens.push({ label: 'Configurações do servidor', icone: <Icon name="settings" size={15} />, onClick: () => setModal({ type: 'editar-servidor' }) });
    }
    if (guild.role === 'owner' || guild.role === 'admin') {
      itens.push({ label: 'Cargos', icone: <Icon name="tag" size={15} />, onClick: () => setModal({ type: 'cargos' }) });
    }
    itens.push({ tipo: 'sep' });
    itens.push({
      label: 'Copiar ID',
      icone: '#',
      onClick: () => navigator.clipboard?.writeText(guild.id).catch(() => {}),
    });
    if (guild.role !== 'owner') {
      itens.push({ tipo: 'sep' });
      itens.push({
        label: 'Sair do servidor',
        icone: <Icon name="door-exit" size={15} />,
        perigo: true,
        onClick: () => setModal({
          type: 'confirm',
          title: 'Sair do servidor',
          message: `Sair de ${guild.name}? Você precisa de um convite novo pra voltar.`,
          confirmLabel: 'Sair',
          onConfirm: () => api.removeMember(guild.id, me.id).catch((e) => setAviso(e.message)),
        }),
      });
    }
    return itens;
  });

  const menuDeStatus = menuContexto.abrirCom(() => itensDeStatus({
    me,
    statusAtual: meuStatus,
    onTrocarStatus: (s) => presenceActions.definir({ status: s }),
    onAbrirPerfil: () => setModal({ type: 'profile', userId: me.id }),
    onAbrirConfiguracoes: () => setConfiguracoesAbertas(true),
  }));

  /** Aceitar um convite pra call: troca pro servidor certo e entra direto. */
  function aceitarConviteDeCall() {
    if (!voiceConvite) return;
    setDmMode(false);
    setActiveGuildId(voiceConvite.guildId);
    voiceActions.join(voiceConvite.channelId);
    setCallMaximizada(true);
    voiceActions.limparConvite();
  }

  /* -------------------------------- acoes -------------------------------- */

  async function sendMessage(content, attachment = null, replyToId = null) {
    const channelId = activeChannelId;
    const nonce = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    setMessages((prev) => ({
      ...prev,
      [channelId]: [...(prev[channelId] ?? []), {
        id: `tmp-${nonce}`, nonce, pending: true, channelId, content, attachment,
        createdAt: Date.now(), author: { id: me.id, username: me.username, avatarUrl: null },
      }],
    }));

    const response = await emitAck(socketRef.current, 'message:send', {
      channelId, content, attachment, replyToId, nonce,
    });
    if (response?.error) {
      setSendError(response.error);
      setMessages((prev) => ({
        ...prev,
        [channelId]: (prev[channelId] ?? []).filter((m) => m.nonce !== nonce),
      }));
      return;
    }
    setSendError(null);
    upsertMessage(channelId, response.message, nonce);
  }

  async function createGuild(name, isPublic) {
    const { guild: created } = await api.createGuild({ name, isPublic });
    setGuilds((prev) => [...prev, { ...created, role: 'owner' }]);
    socketRef.current?.emit('guild:subscribe', { guildId: created.id });
    setActiveGuildId(created.id);
    setModal(null);
  }

  async function joinByCode(code) {
    const { guild: joined } = await api.joinInvite(code.trim().toUpperCase());
    setGuilds((prev) => (prev.some((g) => g.id === joined.id) ? prev : [...prev, joined]));
    socketRef.current?.emit('guild:subscribe', { guildId: joined.id });
    setActiveGuildId(joined.id);
    setModal(null);
  }

  function deleteChannel(channel) {
    setModal({
      type: 'confirm',
      title: 'Apagar canal',
      message: `Apagar o canal "${channel.name}" e todas as mensagens dele? Isso não pode ser desfeito.`,
      confirmLabel: 'Apagar',
      onConfirm: () => api.deleteChannel(guild.id, channel.id).catch(() => {}),
    });
  }

  function fazerLogout() {
    socketRef.current?.close();
    clearToken();
    setMe(null);
    setGuilds([]); setGuild(null); setActiveGuildId(null); setActiveChannelId(null);
    setMessages({}); setChannelState({}); setUnread({}); setOnlineIds(new Set());
    setDmMode(false); setDms([]); setActiveDmId(null);
    setDmMessages({}); setDmChannelState({}); setDmUnread({});
  }

  function pedirLogout() {
    setModal({
      type: 'confirm',
      title: 'Sair da conta',
      message: 'Você vai precisar entrar de novo pra usar o app.',
      confirmLabel: 'Sair',
      onConfirm: fazerLogout,
    });
  }

  /* -------------------------------- render ------------------------------- */

  const unreadByChannel = useMemo(
    () => Object.fromEntries(Object.entries(unread).map(([id, info]) => [id, info.count])),
    [unread]);

  const unreadByGuild = useMemo(() => {
    const totals = {};
    for (const info of Object.values(unread)) {
      totals[info.guildId] = (totals[info.guildId] ?? 0) + info.count;
    }
    return totals;
  }, [unread]);

  const unreadDmTotal = useMemo(
    () => Object.values(dmUnread).reduce((total, n) => total + n, 0),
    [dmUnread]);

  const activeChannel = guild?.channels.find((c) => c.id === activeChannelId) ?? null;
  const activeDm = dms.find((c) => c.id === activeDmId) ?? null;
  const voiceChannel = guild?.channels.find((c) => c.id === voice.channelId) ?? null;
  const voiceChannelName = voiceChannel?.name ?? 'chamada';
  const typingUsers = Object.values(typing[activeChannelId] ?? {}).map((t) => t.username);

  if (booting) return <div className="boot">carregando...</div>;
  if (!me) return <AuthView onAuthenticated={setMe} />;

  return (
    <>
      {atualizacaoPendente && (
        <div className="banner-atualizacao">
          {voice.channelId
            ? 'Tem atualização nova — vai recarregar sozinho assim que você sair da chamada.'
            : 'Atualizando...'}
          {voice.channelId && (
            <button onClick={() => window.location.reload()}>Atualizar agora</button>
          )}
        </div>
      )}

      {interfaceTeste ? (
        <OrbitApp
          me={me}
          guilds={guilds}
          guild={guild}
          activeGuildId={activeGuildId}
          dmMode={dmMode}
          dms={dms}
          activeDm={activeDm}
          activeDmId={activeDmId}
          onlineIds={onlineIds}
          activeChannel={activeChannel}
          messages={messages[activeChannelId] ?? []}
          naoLidasAoAbrir={marcadorNaoLidas[activeChannelId] ?? 0}
          dmMessages={dmMessages[activeDmId] ?? []}
          typingUsers={typingUsers}
          sendError={sendError}
          connected={connected}
          voice={voice}
          voiceActions={voiceActions}
          callMaximizada={callMaximizada}
          voiceVotacoes={voiceVotacoes}
          onSelectGuild={(guildId) => { setDmMode(false); setActiveGuildId(guildId); }}
          onOpenDms={() => setDmMode(true)}
          onSelectChannel={selectChannel}
          onSelectDm={selectDm}
          onToggleVoiceChannel={alternarCanalDeVoz}
          onSend={sendMessage}
          onSendDm={sendDmMessage}
          onTyping={() => socketRef.current?.emit('typing:start', { channelId: activeChannelId })}
          onNovaConversa={() => setModal({ type: 'nova-conversa' })}
          onCreateGuild={() => setModal({ type: 'create-guild' })}
          onJoinGuild={() => setModal({ type: 'join' })}
          onReportarBug={() => setModal({ type: 'reportar-bug' })}
          onOpenSettings={() => setConfiguracoesAbertas(true)}
          onOpenProfile={(userId) => setModal({ type: 'profile', userId })}
          onMinimizarCall={() => setCallMaximizada(false)}
          onExpulsarDaCall={voiceActions.expulsar}
          onVotarExpulsaoDaCall={voiceActions.votarExpulsao}
          telaAssistida={telaAssistida}
          onAssistir={setTelaAssistida}
          onPararDeAssistir={() => setTelaAssistida(null)}
          onVoltarClassico={() => setInterfaceTeste(false)}
          presencas={presencas}
          membrosVisiveis={membrosVisiveis}
          onAlternarMembros={() => setMembrosVisiveis((v) => !v)}
          onPromote={(member, role) => api.setMemberRole(guild.id, member.id, role).catch(() => {})}
          onKick={acoesDoMembro.expulsar}
          podeChamarParaCall={Boolean(voice.channelId)}
          onChamarParaCall={(member) => voiceActions.convidar(member.id)}
          onMenuDoMembro={menuDoMembro}
          voiceRooms={voiceRooms}
          onMenuDoParticipanteDeVoz={menuDoParticipanteDeVoz}
        />
      ) : (
        <div className={`app ${membrosVisiveis && !dmMode ? '' : 'sem-membros'}`}>
      <GuildBar
        guilds={guilds}
        activeGuildId={activeGuildId}
        dmMode={dmMode}
        unreadDmTotal={unreadDmTotal}
        unreadByGuild={unreadByGuild}
        onSelect={(guildId) => { setDmMode(false); setActiveGuildId(guildId); }}
        onOpenDms={() => setDmMode(true)}
        onCreate={() => setModal({ type: 'create-guild' })}
        onJoin={() => setModal({ type: 'join' })}
        onReportarBug={() => setModal({ type: 'reportar-bug' })}
      />

      {dmMode ? (
        <DMSidebar
          conversations={dms}
          activeDmId={activeDmId}
          unreadByDm={dmUnread}
          onlineIds={onlineIds}
          onSelectDm={selectDm}
          onNovaConversa={() => setModal({ type: 'nova-conversa' })}
          me={me}
          connected={connected}
          onOpenSettings={() => setConfiguracoesAbertas(true)}
          onOpenProfile={() => setModal({ type: 'profile', userId: me.id })}
        />
      ) : (
        <ChannelSidebar
          guild={guild}
          activeChannelId={activeChannelId}
          unreadByChannel={unreadByChannel}
          onSelectChannel={selectChannel}
          onCreateChannel={(channelType, categoryId) =>
            setModal({ type: 'create-channel', channelType, categoryId })}
          onOpenInvite={() => setModal({ type: 'invite' })}
          me={me}
          connected={connected}
          onOpenSettings={() => setConfiguracoesAbertas(true)}
          onOpenProfile={() => setModal({ type: 'profile', userId: me.id })}
          voice={voice}
          voiceRooms={voiceRooms}
          voiceActions={voiceActions}
          voiceChannelName={voiceChannelName}
          callMaximizada={callMaximizada}
          onToggleVoiceChannel={alternarCanalDeVoz}
          onMenuDoCanal={menuDoCanal}
          onMenuDaGuild={menuDaGuild}
          onMenuDaCategoria={menuDaCategoria}
          onMenuDoParticipanteDeVoz={menuDoParticipanteDeVoz}
          onAbrirMenuDeStatus={menuDeStatus}
          meuStatus={meuStatus}
          minhaAtividade={minhaAtividade}
        />
      )}

      {/* O áudio da call precisa continuar mesmo com ela minimizada. */}
      <VoiceAudioSink voice={voice} />

      <div className="chat-column">
        {callMaximizada && voice.channelId ? (
          <VoiceStage
            voice={voice}
            me={me}
            channelName={voiceChannelName}
            onMinimizar={() => setCallMaximizada(false)}
            podeExpulsar={temPermissao(guildMembroDeMim, guild, PERM.MOVER_MEMBROS)}
            votacoes={voiceVotacoes}
            onExpulsar={voiceActions.expulsar}
            onVotarExpulsao={voiceActions.votarExpulsao}
            telaAssistida={telaAssistida}
            onAssistir={setTelaAssistida}
            onPararDeAssistir={() => setTelaAssistida(null)}
          />
        ) : dmMode ? (
          activeDm ? (
            <ChatView
              channel={{ id: activeDm.id, name: activeDm.otherUser.username }}
              messages={dmMessages[activeDmId] ?? []}
              loading={dmChannelState[activeDmId]?.loading ?? false}
              hasMore={dmChannelState[activeDmId]?.hasMore ?? false}
              onLoadMore={() => loadDmHistory(activeDmId, dmMessages[activeDmId]?.[0]?.id)}
              onSend={sendDmMessage}
              onTyping={() => {}}
              typingUsers={[]}
              onOpenProfile={(author) => setModal({ type: 'profile', userId: author.id })}
              error={sendError}
              meId={me.id}
              onReagir={reagir}
              onEditarMensagem={editarMensagem}
              onApagarMensagem={apagarMensagem}
              onRodarComando={rodarComando}
              inserirNoCampo={inserirNoCampo}
              icon={<Avatar user={activeDm.otherUser} size={22} className="small" />}
              emptyMessage="Escolhe uma conversa na barra ao lado."
              placeholder={`Mensagem para ${activeDm.otherUser.username}`}
              beginningNote={
                <>Este e o comeco da sua conversa com <strong>{activeDm.otherUser.username}</strong>.</>
              }
            />
          ) : (
            <main className="chat empty">
              <p>Escolhe uma conversa na barra ao lado, ou clica em + pra começar uma.</p>
            </main>
          )
        ) : guilds.length === 0 ? (
          <main className="chat empty">
            <p>Voce ainda nao esta em nenhum servidor.</p>
            <div className="empty-actions">
              <button className="primary" onClick={() => setModal({ type: 'create-guild' })}>
                Criar um servidor
              </button>
              <button onClick={() => setModal({ type: 'join' })}>Entrar com um convite</button>
            </div>
          </main>
        ) : (
          <ChatView
            channel={activeChannel}
            messages={messages[activeChannelId] ?? []}
            loading={channelState[activeChannelId]?.loading ?? false}
            hasMore={channelState[activeChannelId]?.hasMore ?? false}
            onLoadMore={() => loadHistory(activeChannelId, messages[activeChannelId]?.[0]?.id)}
            onSend={sendMessage}
            onTyping={() => socketRef.current?.emit('typing:start', { channelId: activeChannelId })}
            typingUsers={typingUsers}
            onOpenProfile={(author) => setModal({ type: 'profile', userId: author.id })}
            error={sendError}
            members={guild?.members}
            roles={guild?.roles}
            meId={me.id}
            onReagir={reagir}
            onEditarMensagem={editarMensagem}
            onApagarMensagem={apagarMensagem}
            onFixarMensagem={fixarMensagem}
            podeModerar={podeGerenciarMensagens}
            onRodarComando={rodarComando}
            onAlternarMembros={() => setMembrosVisiveis((v) => !v)}
            membrosVisiveis={membrosVisiveis}
            inserirNoCampo={inserirNoCampo}
            naoLidasAoAbrir={marcadorNaoLidas[activeChannelId] ?? 0}
          />
        )}
      </div>

      <MemberList
        guild={dmMode ? null : guild}
        presencas={presencas}
        meId={me.id}
        visivel={membrosVisiveis}
        onOpenProfile={(member) => setModal({ type: 'profile', userId: member.id })}
        onPromote={(member, role) => api.setMemberRole(guild.id, member.id, role).catch(() => {})}
        onKick={acoesDoMembro.expulsar}
        podeChamarParaCall={Boolean(voice.channelId)}
        onChamarParaCall={(member) => voiceActions.convidar(member.id)}
        onMenuDoMembro={menuDoMembro}
      />
        </div>
      )}

      <ContextMenu estado={menuContexto.estado} onFechar={menuContexto.fechar} />

      {aviso && (
        <div className="aviso-flutuante" role="status" onClick={() => setAviso(null)}>
          {aviso}
        </div>
      )}

      {modal?.type === 'reportar-bug' && (
        <ReportBugModal onClose={() => setModal(null)} />
      )}

      {modal?.type === 'nota' && (
        <NotaModal membro={modal.membro} onClose={() => setModal(null)} onErro={setAviso} />
      )}

      {modal?.type === 'editar-canal' && (
        <EditarCanalModal
          canal={modal.canal}
          guildId={guild?.id}
          onClose={() => setModal(null)}
          onErro={setAviso}
        />
      )}

      {modal?.type === 'criar-categoria' && (
        <CriarCategoriaModal guildId={guild?.id} onClose={() => setModal(null)} onErro={setAviso} />
      )}

      {modal?.type === 'cargos' && guild && (
        <RolesModal guild={guild} onClose={() => setModal(null)} onErro={setAviso} />
      )}

      {modal?.type === 'editar-servidor' && guild && (
        <GuildSettingsModal
          guild={guild}
          onClose={() => setModal(null)}
          onSaved={(_atualizado, { manterAberto } = {}) => { if (!manterAberto) setModal(null); }}
        />
      )}

      {modal?.type === 'apelido' && (
        <ApelidoModal
          membro={modal.membro}
          guildId={guild?.id}
          onClose={() => setModal(null)}
          onErro={setAviso}
        />
      )}

      {voiceConvite && (
        <div className="convite-call-banner">
          <Avatar user={voiceConvite.de} size={32} className="small" />
          <span className="convite-texto">
            <strong>{voiceConvite.de?.username ?? 'alguém'}</strong> te chamou pra call em{' '}
            <strong>{voiceConvite.channelName}</strong>
          </span>
          <button className="primary" onClick={aceitarConviteDeCall}>Entrar</button>
          <button onClick={voiceActions.limparConvite}>Ignorar</button>
        </div>
      )}

      {modal?.type === 'confirm' && (
        <ConfirmDialog
          title={modal.title}
          message={modal.message}
          confirmLabel={modal.confirmLabel}
          onConfirm={() => { modal.onConfirm(); setModal(null); }}
          onCancel={() => setModal(null)}
        />
      )}

      {modal?.type === 'create-guild' && (
        <CreateGuildModal onClose={() => setModal(null)} onSubmit={createGuild} />
      )}
      {modal?.type === 'join' && (
        <JoinModal onClose={() => setModal(null)} onSubmit={joinByCode} />
      )}
      {modal?.type === 'create-channel' && (
        <CreateChannelModal
          channelType={modal.channelType}
          onClose={() => setModal(null)}
          onSubmit={async (name) => {
            const { channel } = await api.createChannel(guild.id, { name, type: modal.channelType });
            // Criado a partir de uma categoria: já nasce dentro dela.
            if (modal.categoryId) {
              await api.updateChannel(guild.id, channel.id, { categoryId: modal.categoryId })
                .catch((e) => setAviso(e.message));
            }
            setModal(null);
          }}
        />
      )}
      {modal?.type === 'invite' && <InviteModal guildId={guild.id} onClose={() => setModal(null)} />}
      {modal?.type === 'nova-conversa' && (
        <NovaConversaModal onClose={() => setModal(null)} onSubmit={iniciarConversa} />
      )}
      {modal?.type === 'profile' && (
        <ProfileCard
          userId={modal.userId}
          guild={guild}
          reloadToken={profileToken}
          onClose={() => setModal(null)}
          onEdit={() => setModal({ type: 'edit-profile' })}
        />
      )}
      {modal?.type === 'edit-profile' && (
        <ProfileEditor
          me={me}
          onClose={() => setModal({ type: 'profile', userId: me.id })}
          onSaved={(user, { manterAberto } = {}) => {
            setMe(user);
            setProfileToken((n) => n + 1);
            if (!manterAberto) setModal({ type: 'profile', userId: me.id });
          }}
        />
      )}

      {configuracoesAbertas && (
        <SettingsScreen
          me={me}
          souDono={guilds.some((g) => g.role === 'owner')}
          onClose={() => setConfiguracoesAbertas(false)}
          onLogout={() => { setConfiguracoesAbertas(false); pedirLogout(); }}
          onEditarPerfil={() => setModal({ type: 'edit-profile' })}
          interfaceTeste={interfaceTeste}
          onAlternarInterfaceTeste={setInterfaceTeste}
        />
      )}
    </>
  );
}

/* -------------------------------- modais -------------------------------- */

function useSubmit(action) {
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async (...args) => {
    setBusy(true); setError(null);
    try { await action(...args); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  return { submit, error, busy };
}

function CreateGuildModal({ onClose, onSubmit }) {
  const [name, setName] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const { submit, error, busy } = useSubmit(onSubmit);

  return (
    <Modal title="Criar servidor" onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); submit(name.trim(), isPublic); }}>
        <label>
          Nome do servidor
          <input value={name} onChange={(e) => setName(e.target.value)} minLength={2} maxLength={64} required autoFocus />
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} />
          Servidor publico
        </label>
        {error && <div className="auth-error">{error}</div>}
        <button className="primary" type="submit" disabled={busy}>Criar</button>
      </form>
    </Modal>
  );
}

function JoinModal({ onClose, onSubmit }) {
  const [code, setCode] = useState('');
  const [preview, setPreview] = useState(null);
  const { submit, error, busy } = useSubmit(onSubmit);

  useEffect(() => {
    const clean = code.trim().toUpperCase();
    if (clean.length !== 8) { setPreview(null); return undefined; }
    let cancelled = false;
    api.previewInvite(clean)
      .then(({ invite }) => !cancelled && setPreview(invite))
      .catch(() => !cancelled && setPreview(null));
    return () => { cancelled = true; };
  }, [code]);

  return (
    <Modal title="Entrar com um convite" onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); submit(code); }}>
        <label>
          Codigo do convite
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="ABCD2345" maxLength={8} required autoFocus />
        </label>
        {preview && (
          <p className="hint">
            {preview.alreadyMember ? 'Voce ja esta em' : 'Convite para'} <strong>{preview.guild.name}</strong>
            {' '}&mdash; {preview.guild.memberCount} membro(s)
          </p>
        )}
        {error && <div className="auth-error">{error}</div>}
        <button className="primary" type="submit" disabled={busy}>Entrar</button>
      </form>
    </Modal>
  );
}

function CreateChannelModal({ channelType, onClose, onSubmit }) {
  const [name, setName] = useState('');
  const { submit, error, busy } = useSubmit(onSubmit);

  return (
    <Modal title={`Novo canal de ${channelType === 'voice' ? 'voz' : 'texto'}`} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); submit(name.trim()); }}>
        <label>
          Nome do canal
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={48} required autoFocus />
        </label>
        {error && <div className="auth-error">{error}</div>}
        <button className="primary" type="submit" disabled={busy}>Criar</button>
      </form>
    </Modal>
  );
}

function NovaConversaModal({ onClose, onSubmit }) {
  const [contatos, setContatos] = useState(null);
  const [erro, setErro] = useState(null);

  useEffect(() => {
    api.dmContatos().then(({ contatos: lista }) => setContatos(lista)).catch((e) => setErro(e.message));
  }, []);

  return (
    <Modal title="Nova conversa" onClose={onClose}>
      {erro && <div className="auth-error">{erro}</div>}
      {contatos?.length === 0 && (
        <p className="hint">Ninguem pra chamar ainda — entra num servidor com mais gente primeiro.</p>
      )}
      <ul className="contato-lista">
        {contatos?.map((c) => (
          <li key={c.id}>
            <button className="contato-item" onClick={() => onSubmit(c.id)}>
              <Avatar user={c} size={32} />
              <span>{c.username}</span>
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

function InviteModal({ guildId, onClose }) {
  const [code, setCode] = useState(null);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api.createInvite(guildId)
      .then(({ invite }) => setCode(invite.code))
      .catch((err) => setError(err.message));
  }, [guildId]);

  return (
    <Modal title="Convite" onClose={onClose}>
      {error && <div className="auth-error">{error}</div>}
      {code && (
        <>
          <p className="hint">Passa esse codigo pra quem voce quer no servidor:</p>
          <div className="invite-code">{code}</div>
          <button
            className="primary"
            onClick={() => { navigator.clipboard?.writeText(code); setCopied(true); }}
          >
            {copied ? 'Copiado' : 'Copiar codigo'}
          </button>
          <p className="hint small">
            Enquanto o servidor so roda na sua maquina, o convite so funciona pra quem
            esta na mesma rede. Amigos de fora entram na Etapa 7.
          </p>
        </>
      )}
    </Modal>
  );
}
