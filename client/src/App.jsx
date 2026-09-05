import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, clearToken, getToken } from './api.js';
import { createSocket, emitAck } from './socket.js';
import { nomeExibido, PERM, podeAgirSobre as podeAgirSobreMembro, temPermissao } from './lib/cargos.js';
import { mensagemMenciona, textoLegivel } from './lib/mencoes.js';
import {
  appEstaEmPrimeiroPlano,
  deveExibirNotificacaoNativaDeMencao,
  tocarSomDeMencao,
} from './lib/notificacaoDeMencao.js';
import { useArrastar } from './lib/arrastar.js';
import {
  chaveDe, configDe, deveNotificar, DURACOES_DE_SILENCIO, NIVEIS, PARA_SEMPRE,
} from './lib/notificacoes.js';
import { useAusenciaAutomatica, useDeteccaoDeJogo } from './lib/usePresenca.js';
import { notificar, pedirPermissaoDeNotificacao } from './lib/notificar.js';
import { useVoice } from './lib/useVoice.js';
import AuthView from './components/AuthView.jsx';
import Avatar from './components/Avatar.jsx';
import ConfirmDialog from './components/ConfirmDialog.jsx';
import ContextMenu, { useContextMenu } from './components/ContextMenu.jsx';
import Icon from './components/Icon.jsx';
import { itensDoMembro } from './components/MemberList.jsx';
import EncaminharModal from './components/EncaminharModal.jsx';
import GuildSettingsScreen from './components/GuildSettingsScreen.jsx';
import OrbitApp from './skins/orbit/OrbitApp.jsx';
import Modal from './components/Modal.jsx';
import ProfileCard from './components/ProfileCard.jsx';
import ProfileEditor from './components/ProfileEditor.jsx';
import ReportBugModal from './components/ReportBugModal.jsx';
import SettingsScreen from './components/SettingsScreen.jsx';
import { itensDeStatus } from './components/UserPanel.jsx';
import { temVideoDeOutros } from './components/VoiceStage.jsx';
import WatchTogetherModal from './components/WatchTogetherModal.jsx';

const TYPING_TTL = 4000;
const AVISO_TTL = 6000;

/**
 * Onde fica guardado "eu estava nessa call quando o app recarregou", pra
 * voltar pra ela sozinho depois de uma atualização. Vale por pouco tempo
 * (VALIDADE_RETOMAR_MS) de propósito: é pra emendar um recarregamento, não
 * pra reconectar numa call de ontem quando a pessoa abrir o app de novo.
 */
const CHAVE_RETOMAR_CALL = 'discord-caseiro:retomar-call';
const VALIDADE_RETOMAR_MS = 2 * 60 * 1000;

/**
 * Lê (e consome) a marca de "eu estava nessa call". Precisa ser chamada
 * SINCRONAMENTE no primeiro render, nunca de dentro de um efeito: o efeito
 * que mantém a marca em dia apaga ela assim que vê "não estou em call", e
 * logo depois de um recarregamento isso é verdade por um instante - como
 * efeitos rodam na ordem em que são declarados, a marca era apagada antes
 * de alguém conseguir lê-la, e a pessoa nunca voltava pra chamada.
 */
function lerMarcaDeRetomar() {
  try {
    const marca = JSON.parse(localStorage.getItem(CHAVE_RETOMAR_CALL));
    localStorage.removeItem(CHAVE_RETOMAR_CALL);
    if (!marca?.channelId || Date.now() - marca.ts > VALIDADE_RETOMAR_MS) return null;
    return marca;
  } catch {
    return null;
  }
}

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
  // Lazy initializer (função, não valor): roda UMA vez, no primeiro render,
  // antes de qualquer efeito - ver o porquê em `lerMarcaDeRetomar`.
  const [marcaDeRetomar] = useState(lerMarcaDeRetomar);
  const midiaParaRetomarRef = useRef(marcaDeRetomar);
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
  const [mentionUnread, setMentionUnread] = useState({});
  // Quantas mensagens estavam não lidas quando cada canal foi aberto - é o
  // que decide se a tela abre em cima da primeira não lida ou no fim do
  // chat (ver selectChannel). Fica até trocar de canal e voltar.
  const [marcadorNaoLidas, setMarcadorNaoLidas] = useState({});

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
  const [cinemaAberto, setCinemaAberto] = useState(false);
  const [sendError, setSendError] = useState(null);
  const [profileToken, setProfileToken] = useState(0);
  // Tela cheia, separada do resto dos modais - fica aberta por baixo mesmo
  // se a pessoa abrir o editor de perfil de dentro dela.
  const [configuracoesAbertas, setConfiguracoesAbertas] = useState(false);
  /*
   * As configurações do SERVIDOR moram fora do `modal` de propósito: elas
   * abrem diálogos de confirmação (expulsar, banir), e se dividissem o mesmo
   * estado a confirmação substituiria a tela inteira em vez de aparecer por
   * cima dela - a pessoa confirmaria um banimento e cairia de volta no chat.
   */
  const [configServidor, setConfigServidor] = useState(null); // null | { aba }
  /*
   * Um estado de arrasto só pro app inteiro. A barra de canais e a lista de
   * membros são componentes irmãos, e arrastar alguém de uma pra outra só
   * funciona se as duas olharem pro MESMO estado - com um `useArrastar` em
   * cada, a barra não enxergaria a pessoa vindo da lista.
   */
  const arrasto = useArrastar();
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
  const [membrosVisiveis, setMembrosVisiveis] = useState(
    () => typeof window === 'undefined' || window.innerWidth > 1100,
  );
  // socketId de quem estamos assistindo a transmissao; null = ninguem.
  const [telaAssistida, setTelaAssistida] = useState(null);
  // Quando a pessoa escreve a atividade com /jogando, a detecção automática
  // do app de desktop para de sobrescrever.
  const atividadeManualRef = useRef(false);
  const menuContexto = useContextMenu();
  // Níveis de notificação por servidor/canal/DM, carregados do servidor.
  const [notifSettings, setNotifSettings] = useState({});
  const [chamadaSaindo, setChamadaSaindo] = useState(null);
  const [avisoCallAnimado, setAvisoCallAnimado] = useState(false);
  // Os handlers do socket são montados uma vez só; sem refs eles leriam para
  // sempre o valor que essas variáveis tinham na primeira renderização.
  const notifSettingsRef = useRef({});
  const statusRef = useRef('online');

  const { voice, voiceRooms, voiceVotacoes, voiceConvite, voiceResultadoConvite, voiceWatch, voiceActions } = useVoice(socket);

  useEffect(() => {
    if (!voiceConvite) return undefined;
    window.appDesktop?.iniciarSomDeChamada?.();
    return () => window.appDesktop?.pararSomDeChamada?.();
  }, [voiceConvite?.id]);

  useEffect(() => {
    if (!voiceResultadoConvite) return;
    const mensagens = {
      aceitou: 'aceitou sua chamada.',
      recusou: 'recusou sua chamada.',
      'nao-atendeu': 'não atendeu sua chamada.',
    };
    setChamadaSaindo(null);
    setAvisoCallAnimado(voiceResultadoConvite.resultado === 'nao-atendeu');
    setAviso(`${voiceResultadoConvite.resultado === 'aceitou' ? 'A pessoa' : 'O usuário'} ${mensagens[voiceResultadoConvite.resultado] ?? 'encerrou o convite.'}`);
  }, [voiceResultadoConvite]);

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
  const podeBanir = temPermissao(guildMembroDeMim, guild, PERM.BANIR);
  const podeMoverNaCall = temPermissao(guildMembroDeMim, guild, PERM.MOVER_MEMBROS);
  const podeModerarVoz = temPermissao(guildMembroDeMim, guild, PERM.SILENCIAR_MEMBROS) || temPermissao(guildMembroDeMim, guild, PERM.ENSURDECER_MEMBROS);
  const minhaAtividade = presencas[me?.id]?.activity ?? null;

  /*
   * Deploy novo: recarrega NA HORA, mesmo em chamada - quem estava numa
   * call volta pra ela sozinho logo depois (ver o efeito de "retomar call"
   * abaixo). Antes isso esperava a pessoa sair da chamada, e o resultado
   * era metade das pessoas rodando a versão velha por horas.
   *
   * A marca de retomar é reescrita AQUI, com a hora de agora, de propósito:
   * ela é gravada quando a pessoa entra na call e só vale por 2 minutos
   * (pra não reconectar num restart comum, dias depois). Sem reescrever,
   * quem estivesse em call há mais de 2 minutos - ou seja, praticamente
   * todo mundo - recarregaria e NÃO voltaria pra chamada.
   */
  useEffect(() => {
    if (!atualizacaoPendente) return;
    if (voice.channelId) {
      localStorage.setItem(CHAVE_RETOMAR_CALL, JSON.stringify({
        guildId: activeGuildId,
        channelId: voice.channelId,
        ts: Date.now(),
        camera: voice.self.camera,
        screen: voice.self.screen,
        muted: voice.self.muted,
        deafened: voice.self.deafened,
        callMaximizada,
      }));
    }
    const reiniciar = window.appDesktop?.reiniciarApp?.();
    if (!reiniciar) window.location.reload();
  }, [atualizacaoPendente, voice.channelId, activeGuildId, voice.self.camera, voice.self.screen, voice.self.muted, voice.self.deafened, callMaximizada]);

  /*
   * Avisa o app de desktop se estamos numa call agora - é o que decide lá
   * (atualizador.js) se uma atualização baixada reinicia na hora ou espera
   * a pessoa sair da call. Não faz nada fora do Electron (a ponte
   * simplesmente não existe no navegador).
   */
  useEffect(() => {
    window.appDesktop?.emCall?.(Boolean(voice.channelId));
  }, [voice.channelId]);

  /*
   * Versões antigas do desktop já baixavam o update, mas às vezes deixavam o
   * instalador preso em "pending" esperando um aviso/reinício que a pessoa não
   * via. A ponte `emCall(true)` existe nelas e força o atualizador a instalar
   * assim que houver pacote baixado, sem pedir reinstalação manual.
   */
  useEffect(() => {
    if (!window.appDesktop?.emCall) return;
    window.appDesktop.emCall(true);
    const intervalo = setInterval(() => window.appDesktop?.emCall?.(true), 30_000);
    const parar = setTimeout(() => clearInterval(intervalo), 10 * 60 * 1000);
    return () => {
      clearInterval(intervalo);
      clearTimeout(parar);
    };
  }, []);

  /*
   * Guarda em qual call estávamos, pra reconectar sozinho se o app reiniciar
   * por causa de uma atualização (ver entrarNaVoz abaixo e o efeito de
   * "retomar call" logo depois do carregamento dos servidores). `ts` é o
   * que evita reconectar num restart comum, dias depois - só vale por
   * pouco tempo.
   */
  useEffect(() => {
    if (!voice.channelId) { localStorage.removeItem(CHAVE_RETOMAR_CALL); return; }
    const bruto = localStorage.getItem(CHAVE_RETOMAR_CALL);
    // Já escrito por `entrarNaVoz` com o guildId certo - aqui só teria que
    // criar do zero se por algum motivo não passou por lá (não deveria
    // acontecer, mas não custa não deixar sem marca nenhuma).
    if (bruto) return;
    localStorage.setItem(CHAVE_RETOMAR_CALL, JSON.stringify({ guildId: activeGuildId, channelId: voice.channelId, ts: Date.now() }));
  }, [voice.channelId]);

  /** Entra numa call de voz e já marca pra reconectar sozinho num restart de atualização. */
  function entrarNaVoz(channelId, guildId) {
    localStorage.setItem(CHAVE_RETOMAR_CALL, JSON.stringify({ guildId, channelId, ts: Date.now() }));
    voiceActions.join(channelId);
  }

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
  const mencoesComSomRef = useRef(new Set());

  const tocarSomDeMencaoUmaVez = useCallback((messageId) => {
    if (!messageId || mencoesComSomRef.current.has(messageId)) return;
    mencoesComSomRef.current.add(messageId);
    tocarSomDeMencao();
    if (mencoesComSomRef.current.size > 200) {
      const primeiro = mencoesComSomRef.current.values().next().value;
      mencoesComSomRef.current.delete(primeiro);
    }
  }, []);

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
      connect: () => {
        setConnected(true);
        // Reconexões podem ter perdido eventos enquanto o servidor estava
        // fora; o contador volta sempre da fonte persistente.
        api.mencoesNaoLidas()
          .then(({ mentions }) => setMentionUnread(mentions ?? {}))
          .catch(() => {});
      },
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
        setMentionUnread((prev) => Object.fromEntries(
          Object.entries(prev).filter(([, info]) => info.guildId !== guildId),
        ));
        if (activeGuildRef.current === guildId) { setActiveGuildId(null); setGuild(null); }
      },

      // O dono apagou o servidor: some da barra na hora pra todo mundo que
      // estava dentro, sem ninguém ficar olhando pra um servidor fantasma.
      'guild:deleted': ({ guildId }) => {
        setGuilds((prev) => prev.filter((g) => g.id !== guildId));
        setMentionUnread((prev) => Object.fromEntries(
          Object.entries(prev).filter(([, info]) => info.guildId !== guildId),
        ));
        if (activeGuildRef.current === guildId) {
          setActiveGuildId(null);
          setGuild(null);
          setModal(null);
          setConfigServidor(null);
          setAviso('Esse servidor foi excluído pelo dono.');
        }
      },

      'message:new': ({ guildId, message }) => {
        upsertMessage(message.channelId, message);
        if (message.author.id !== me.id && mensagemMenciona(message.content, me.id)) {
          tocarSomDeMencaoUmaVez(message.id);
        }
        const estouVendoEsseCanal = !dmModeRef.current && message.channelId === activeChannelRef.current;
        const estaEmPrimeiroPlano = appEstaEmPrimeiroPlano();

        /*
         * Mensagem que chega com o canal aberto na frente já nasce lida.
         *
         * Sem isso a marca de leitura ficava parada no instante em que o
         * canal foi ABERTO: tudo que chegasse depois continuava "não lido"
         * pro servidor por mais que estivesse na tela, e ao voltar pro canal
         * o app rolava lá pra cima, pra mensagens que a pessoa já tinha
         * acabado de ler.
         *
         * `document.hasFocus()` é o que separa "está lendo" de "deixou o app
         * aberto atrás de outra janela" - nesse segundo caso a mensagem
         * continua não lida, que é o certo.
         */
        if (estouVendoEsseCanal && estaEmPrimeiroPlano) {
          socketRef.current?.emit('channel:read', { channelId: message.channelId });
        }

        if ((!estouVendoEsseCanal || !estaEmPrimeiroPlano) && message.author.id !== me.id) {
          setUnread((prev) => ({
            ...prev,
            [message.channelId]: {
              guildId,
              count: (prev[message.channelId]?.count ?? 0) + 1,
            },
          }));
          // Mensagens comuns seguem as preferências daqui; menções usam o
          // evento dirigido abaixo para som, contador e regra de foco.
          const ehMencao = mensagemMenciona(message.content, me.id);
          if (!ehMencao && deveNotificar({
            settings: notifSettingsRef.current,
            status: statusRef.current,
            guildId,
            channelId: message.channelId,
            ehMencao: false,
          })) {
            const corpo = textoLegivel(message.content, guildRef.current?.members) || '📎 anexo';
            notificar(
              ehMencao ? `${message.author.username} marcou você` : message.author.username,
              corpo,
            );
          }
        }
      },

      'mention:new': ({ guildId, channelId, message }) => {
        if (!message || message.author.id === me.id) return;
        setMentionUnread((prev) => ({
          ...prev,
          [channelId]: {
            guildId,
            count: (prev[channelId]?.count ?? 0) + 1,
          },
        }));
        tocarSomDeMencaoUmaVez(message.id);

        if (deveExibirNotificacaoNativaDeMencao({
          channelId,
          activeChannelId: activeChannelRef.current,
          dmMode: dmModeRef.current,
          appFocado: appEstaEmPrimeiroPlano(),
        })) {
          const corpo = textoLegivel(message.content, guildRef.current?.members) || 'anexo';
          notificar(`${message.author.username} marcou você`, corpo, {
            icone: message.author.avatarUrl ?? undefined,
          });
        }
      },

      'mention:removed': ({ channelId }) => {
        setMentionUnread((prev) => {
          const atual = prev[channelId];
          if (!atual) return prev;
          const count = Math.max(0, atual.count - 1);
          if (count > 0) return { ...prev, [channelId]: { ...atual, count } };
          const next = { ...prev };
          delete next[channelId];
          return next;
        });
      },

      'mention:read': ({ channelId }) => {
        setMentionUnread((prev) => {
          if (!prev[channelId]) return prev;
          const next = { ...prev };
          delete next[channelId];
          return next;
        });
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
        setMentionUnread((prev) => {
          if (!prev[id]) return prev;
          const next = { ...prev };
          delete next[id];
          return next;
        });
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

  useEffect(() => {
    if (!me) return;
    api.mencoesNaoLidas()
      .then(({ mentions }) => setMentionUnread(mentions ?? {}))
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
    const timer = setTimeout(() => {
      setAviso(null);
      setAvisoCallAnimado(false);
    }, AVISO_TTL);
    return () => clearTimeout(timer);
  }, [aviso]);

  function fecharAviso() {
    setAviso(null);
    setAvisoCallAnimado(false);
  }

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

  /*
   * Reconecta sozinho na call que estava rolando, se o app acabou de
   * recarregar por causa de uma atualização durante a call. A marca já foi
   * lida lá em cima (`marcaDeRetomar`), sincronamente - aqui só falta
   * esperar ter `me` e socket pra poder entrar de verdade. `tentou` garante
   * uma tentativa só: sem isso, um `me` mudando de novo (reconexão de rede,
   * por exemplo) reentraria na call depois da pessoa já ter saído dela.
   */
  const tentouRetomarCallRef = useRef(false);
  useEffect(() => {
    // `connected` (socket de pé) é obrigatório, não só `me`: entrar numa
    // call é `clientRef.current?.join(...)` no useVoice, e esse client só
    // nasce depois que o socket conecta - chamar antes disso não dá erro
    // nenhum, simplesmente não faz nada, e a pessoa fica fora da chamada
    // sem entender por quê.
    if (!me || !connected || !marcaDeRetomar || tentouRetomarCallRef.current) return;
    tentouRetomarCallRef.current = true;
    setDmMode(false);
    if (marcaDeRetomar.guildId) setActiveGuildId(marcaDeRetomar.guildId);
    entrarNaVoz(marcaDeRetomar.channelId, marcaDeRetomar.guildId);
    setCallMaximizada(true);
  }, [me, connected, marcaDeRetomar]);

  useEffect(() => {
    const marca = midiaParaRetomarRef.current;
    if (!marca || voice.channelId !== marca.channelId) return;
    midiaParaRetomarRef.current = null;

    if (marca.callMaximizada) setCallMaximizada(true);
    if (marca.muted && !voice.self.muted) voiceActions.toggleMute();
    if (marca.deafened && !voice.self.deafened) voiceActions.toggleDeafen();
    if (marca.camera && !voice.self.camera) voiceActions.toggleCamera();
    if (marca.screen && !voice.self.screen) {
      setAviso('Selecione a tela de novo para voltar a compartilhar.');
      voiceActions.toggleScreen();
    }
  }, [voice.channelId, voice.self.muted, voice.self.deafened, voice.self.camera, voice.self.screen, voiceActions]);

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
    api.marcarMencoesLidas(channelId).catch(() => {});
    setUnread((prev) => {
      if (!prev[channelId]) return prev;
      const next = { ...prev };
      delete next[channelId];
      return next;
    });
    setMentionUnread((prev) => {
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
      entrarNaVoz(channelId, activeGuildId);
      setCallMaximizada(true);
    }
  }

  /* ------------------------- acoes de mensagem ------------------------- */

  const reagir = (messageId, emoji) =>
    socketRef.current?.emit('message:react', { messageId, emoji });

  const editarMensagem = (messageId, content) =>
    emitAck(socketRef.current, 'message:edit', { messageId, content })
      .then((r) => { if (r?.error) setSendError(r.error); });

  const fixarMensagem = async (messageId, pinned) => {
    const resposta = await emitAck(socketRef.current, 'message:pin', { messageId, pinned });
    if (resposta?.error) {
      setSendError(resposta.error);
      return;
    }

    // O broadcast mantém os outros clientes sincronizados. A confirmação
    // local evita que o selo dependa da volta desse mesmo broadcast pela rede.
    setMessages((prev) => {
      const next = {};
      for (const [channelId, list] of Object.entries(prev)) {
        next[channelId] = list.map((message) => (message.id === messageId
          ? { ...message, pinnedAt: pinned ? Date.now() : null }
          : message));
      }
      return next;
    });
    setSendError(null);
  };

  /*
   * Voltar o foco pra janela com um canal aberto marca ele como lido.
   *
   * É o par do que acontece em `message:new`: lá, mensagem que chega com a
   * janela na frente já nasce lida; aqui se cobre o caminho inverso - as que
   * chegaram enquanto o app estava atrás de outra janela e agora estão na
   * tela, sendo lidas de fato.
   */
  useEffect(() => {
    const aoFocar = () => {
      const canalId = activeChannelRef.current;
      if (!canalId || dmModeRef.current) return;
      socketRef.current?.emit('channel:read', { channelId: canalId });
      setUnread((prev) => {
        if (!prev[canalId]) return prev;
        const next = { ...prev };
        delete next[canalId];
        return next;
      });
    };
    window.addEventListener('focus', aoFocar);
    return () => window.removeEventListener('focus', aoFocar);
  }, []);

/** Aplica uma ordem nova de canais: otimista na tela, depois manda pro servidor. */
  async function aplicarNovaOrdem(nova, categoriaPorId) {
    setGuild((prev) => (prev ? { ...prev, channels: nova } : prev));
    const ordem = nova.map((c) => ({ id: c.id, categoryId: categoriaPorId(c) }));
    try {
      await api.reordenarCanais(guild.id, ordem);
    } catch (err) {
      setAviso(err.message);
      // Deu ruim: pede a versão de verdade em vez de deixar a tela mentindo.
      api.getGuild(guild.id).then(({ guild: real }) => setGuild(real)).catch(() => {});
    }
  }

  /**
   * Soltar um canal em cima de outro: tira da posição de origem e enfia
   * antes ou depois do destino - conforme a METADE da linha em que o mouse
   * estava (ver lib/arrastar.js) - e manda a lista inteira nova pro
   * servidor. É a mesma barrinha do Discord: em cima da linha significa
   * "fica acima dela", embaixo significa "fica abaixo".
   *
   * A ordem é aplicada na tela na hora (otimista) porque o servidor devolve
   * a guild inteira - esperar a volta faria o canal piscar de volta pro
   * lugar antigo antes de assentar no novo.
   *
   * Remove o arrastado ANTES de achar o índice do destino, de propósito:
   * assim o índice do destino já vem certo no MUNDO PÓS-REMOÇÃO, sem
   * precisar corrigir deslocamento na mão pra cada direção do arrasto.
   */
  async function reordenarCanais(idArrastado, idDestino, metade = 'depois') {
    if (!guild) return;
    const lista = [...guild.channels];
    const de = lista.findIndex((c) => c.id === idArrastado);
    if (de < 0) return;
    const [item] = lista.splice(de, 1);

    const paraIdx = lista.findIndex((c) => c.id === idDestino);
    if (paraIdx < 0) return;
    const insercao = metade === 'antes' ? paraIdx : paraIdx + 1;
    lista.splice(insercao, 0, item);

    // O canal arrastado herda a categoria de onde caiu - é o que faz
    // arrastar pra dentro de uma categoria funcionar no mesmo gesto.
    const categoriaDestino = guild.channels.find((c) => c.id === idDestino)?.categoryId ?? null;
    aplicarNovaOrdem(lista, (c) => (c.id === idArrastado ? categoriaDestino : (c.categoryId ?? null)));
  }

  /**
   * Soltar na zona depois do último canal de um tipo: joga o canal pro fim
   * daquele tipo sem precisar acertar o pixel exato da última vaga - é o
   * "se eu quiser mover pro último, qualquer área depois do último já
   * serve", igual mover um carro pra última vaga da garagem sem precisar
   * encostar exatamente nela.
   *
   * Sai de qualquer categoria ao cair aqui: o fim da lista é sempre o fim
   * "solto", nunca dentro de uma categoria específica.
   */
  async function moverParaFim(idArrastado, tipoAlvo) {
    if (!guild) return;
    const lista = [...guild.channels];
    const de = lista.findIndex((c) => c.id === idArrastado);
    if (de < 0) return;

    const [item] = lista.splice(de, 1);
    let posicao = lista.length;
    for (let i = lista.length - 1; i >= 0; i -= 1) {
      if (lista[i].type === tipoAlvo) { posicao = i + 1; break; }
    }
    lista.splice(posicao, 0, item);
    aplicarNovaOrdem(lista, (c) => (c.id === idArrastado ? null : (c.categoryId ?? null)));
  }

  /**
   * Puxar alguém pra um canal de voz arrastando.
   *
   * Quem já está numa call é MOVIDO (o servidor manda o cliente da pessoa
   * trocar de sala); quem não está em nenhuma recebe um convite, porque
   * arrastar alguém pra dentro de uma chamada sem avisar seria sequestro.
   */
  function puxarParaCall(carga, canal) {
    // Já está numa call: dá pra mover direto, sem pedir licença - é o que a
    // permissão de mover membros permite fazer.
    const jaNaCall = Object.values(voiceRooms).flat().find((p) => p.user.id === carga.userId);
    if (jaNaCall) {
      voiceActions.mover(jaNaCall.socketId, canal.id);
      return;
    }

    /*
     * Não está em call nenhuma: só dá pra convidar, e o servidor convida
     * sempre pra call de QUEM CHAMA (ver voice:convidar) - não pra um canal
     * escolhido. Então isso só funciona se eu já estiver no canal de destino;
     * fora disso o certo é dizer o que falta em vez de mandar um convite que
     * levaria a pessoa pro lugar errado.
     */
    if (voice.channelId !== canal.id) {
      setAviso(`Entre em #${canal.name} primeiro pra poder chamar alguém pra lá.`);
      return;
    }
    voiceActions.convidar(carga.userId);
    setChamadaSaindo({ id: carga.userId, nome: carga.nome });
  }

  /**
   * Marcar como não lido a partir de uma mensagem.
   *
   * Manda a marca pro instante logo ANTES dela (1ms), pra que ela própria
   * volte a contar como não lida - marcar no createdAt exato deixaria a
   * mensagem escolhida do lado lido, e a contagem começaria na seguinte.
   */
  function marcarComoNaoLido(message) {
    const canalId = message.channelId ?? activeChannelId;
    socketRef.current?.emit('channel:read', { channelId: canalId, ate: message.createdAt - 1 });
    api.naoLidas(activeGuildId)
      .then(({ unread }) => {
        const info = unread?.[canalId];
        if (info) setUnread((prev) => ({ ...prev, [canalId]: { ...info, guildId: activeGuildId } }));
      })
      .catch(() => {});
    setAviso('Marcado como não lido.');
  }

  /**
   * Encaminhar: manda o conteúdo pro destino escolhido sem sair de onde se
   * está. Não leva `replyToId` - a mensagem citada não existe do outro lado.
   */
  async function encaminharMensagem(destino, message) {
    const payload = { content: message.content ?? '', attachment: message.attachment ?? null };
    const evento = destino.tipo === 'dm' ? 'dm:send' : 'message:send';
    const alvo = destino.tipo === 'dm'
      ? { dmChannelId: destino.id, ...payload }
      : { channelId: destino.id, ...payload };

    const r = await emitAck(socketRef.current, evento, {
      ...alvo,
      nonce: `fw-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    });
    if (r?.error) throw new Error(r.error);
  }

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
    mencionar: (m) => setInserirNoCampo({
      texto: `@${nomeExibido(m)} `,
      userId: m.id,
      token: Date.now(),
    }),
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
      setChamadaSaindo({ id: m.id, nome: m.username });
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
      itens.push({ label: 'Configurações do servidor', icone: <Icon name="settings" size={15} />, onClick: () => setConfigServidor({ aba: 'perfil' }) });
    }
    if (guild.role === 'owner' || guild.role === 'admin') {
      itens.push({ label: 'Cargos', icone: <Icon name="tag" size={15} />, onClick: () => setConfigServidor({ aba: 'cargos' }) });
      itens.push({ label: 'Membros', icone: <Icon name="users" size={15} />, onClick: () => setConfigServidor({ aba: 'membros' }) });
    }
    if (podeBanir) {
      itens.push({ label: 'Banimentos', icone: <Icon name="ban" size={15} />, onClick: () => setConfigServidor({ aba: 'banimentos' }) });
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
    voiceActions.responderConvite(voiceConvite.id, 'aceitar');
    setDmMode(false);
    setActiveGuildId(voiceConvite.guildId);
    entrarNaVoz(voiceConvite.channelId, voiceConvite.guildId);
    setCallMaximizada(true);
    voiceActions.limparConvite();
  }

  function recusarConviteDeCall() {
    if (!voiceConvite) return;
    voiceActions.responderConvite(voiceConvite.id, 'recusar');
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
    setMessages({}); setChannelState({}); setUnread({}); setMentionUnread({});
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

  const mentionByChannel = useMemo(
    () => Object.fromEntries(Object.entries(mentionUnread).map(([id, info]) => [id, info.count])),
    [mentionUnread],
  );

  const mentionByGuild = useMemo(() => {
    const totals = {};
    for (const info of Object.values(mentionUnread)) {
      totals[info.guildId] = (totals[info.guildId] ?? 0) + info.count;
    }
    return totals;
  }, [mentionUnread]);

  const activeChannel = guild?.channels.find((c) => c.id === activeChannelId) ?? null;
  const activeDm = dms.find((c) => c.id === activeDmId) ?? null;
  const voiceChannel = guild?.channels.find((c) => c.id === voice.channelId) ?? null;
  const voiceChannelName = voiceChannel?.name ?? 'chamada';
  const typingUsers = Object.values(typing[activeChannelId] ?? {}).map((t) => t.username);

  if (booting) return <div className="boot">carregando...</div>;
  if (!me) return <AuthView onAuthenticated={setMe} />;

  return (
    <>
      {/* O recarregamento acontece na hora (ver o efeito de atualização),
          então isto some sozinho em seguida - é só pra a tela não piscar do
          nada sem nenhuma explicação. */}
      {atualizacaoPendente && (
        <div className="banner-atualizacao">
          {voice.channelId
            ? 'Atualizando — você volta pra chamada em seguida...'
            : 'Atualizando...'}
        </div>
      )}

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
          channelLoading={channelState[activeChannelId]?.loading ?? false}
          channelHasMore={channelState[activeChannelId]?.hasMore ?? false}
          onLoadMore={() => loadHistory(activeChannelId, messages[activeChannelId]?.[0]?.id)}
          dmLoading={dmChannelState[activeDmId]?.loading ?? false}
          dmHasMore={dmChannelState[activeDmId]?.hasMore ?? false}
          onLoadMoreDm={() => loadDmHistory(activeDmId, dmMessages[activeDmId]?.[0]?.id)}
          unreadDmTotal={unreadDmTotal}
          unreadByGuild={unreadByGuild}
          unreadByChannel={unreadByChannel}
          unreadByDm={dmUnread}
          mentionByGuild={mentionByGuild}
          mentionByChannel={mentionByChannel}
          typingUsers={typingUsers}
          sendError={sendError}
          connected={connected}
          voice={voice}
          voiceActions={voiceActions}
          callMaximizada={callMaximizada}
          voiceVotacoes={voiceVotacoes}
          voiceWatch={voiceWatch}
          voiceRooms={voiceRooms}
          voiceChannelName={voiceChannelName}
          onSelectGuild={(guildId) => { setCinemaAberto(false); setDmMode(false); setActiveGuildId(guildId); }}
          onOpenDms={() => { setCinemaAberto(false); setDmMode(true); }}
          onSelectChannel={selectChannel}
          onSelectDm={selectDm}
          onToggleVoiceChannel={alternarCanalDeVoz}
          onSend={sendMessage}
          onSendDm={sendDmMessage}
          onTyping={() => socketRef.current?.emit('typing:start', { channelId: activeChannelId })}
          onNovaConversa={() => setModal({ type: 'nova-conversa' })}
          onCreateGuild={() => setModal({ type: 'create-guild' })}
          onJoinGuild={() => setModal({ type: 'join' })}
          onCreateChannel={(channelType, categoryId) =>
            setModal({ type: 'create-channel', channelType, categoryId })}
          onOpenInvite={() => setModal({ type: 'invite' })}
          onOpenCinema={() => setCinemaAberto(true)}
          onReportarBug={() => setModal({ type: 'reportar-bug' })}
          cinemaAberto={cinemaAberto}
          onCloseCinema={() => setCinemaAberto(false)}
          onErroCinema={setAviso}
          onOpenSettings={() => setConfiguracoesAbertas(true)}
          onOpenProfile={(userId) => setModal({ type: 'profile', userId })}
          onMinimizarCall={() => setCallMaximizada(false)}
          onExpulsarDaCall={voiceActions.expulsar}
          onVotarExpulsaoDaCall={voiceActions.votarExpulsao}
          telaAssistida={telaAssistida}
          onAssistir={setTelaAssistida}
          onPararDeAssistir={() => setTelaAssistida(null)}
          onOpenApps={() => setModal({ type: 'watch-app' })}
          presencas={presencas}
          minhaAtividade={minhaAtividade}
          meuStatus={meuStatus}
          membrosVisiveis={membrosVisiveis}
          onAlternarMembros={() => setMembrosVisiveis((v) => !v)}
          onPromote={(member, role) => api.setMemberRole(guild.id, member.id, role).catch(() => {})}
          onKick={acoesDoMembro.expulsar}
          podeChamarParaCall={Boolean(voice.channelId)}
          podeModerarVoz={podeModerarVoz}
          onChamarParaCall={(member) => {
            voiceActions.convidar(member.id);
            setChamadaSaindo({ id: member.id, nome: member.username });
          }}
          onMenuDoMembro={menuDoMembro}
          onMenuDoParticipanteDeVoz={menuDoParticipanteDeVoz}
          onMenuDaGuild={menuDaGuild}
          onMenuDoCanal={menuDoCanal}
          onMenuDaCategoria={menuDaCategoria}
          onAbrirMenuDeStatus={menuDeStatus}
          onReagir={reagir}
          onEditarMensagem={editarMensagem}
          onApagarMensagem={apagarMensagem}
          onFixarMensagem={fixarMensagem}
          onEncaminhar={(m) => setModal({ type: 'encaminhar', mensagem: m })}
          onMarcarNaoLido={marcarComoNaoLido}
          onDenunciar={(m) => setModal({ type: 'reportar-bug', mensagem: m })}
          podeModerar={podeGerenciarMensagens}
          onRodarComando={rodarComando}
          inserirNoCampo={inserirNoCampo}
          podeOrdenarCanais={podeGerenciarCanais}
          podeMoverNaCall={podeMoverNaCall}
          onReordenarCanais={reordenarCanais}
          onPuxarParaCall={puxarParaCall}
          onMoverParaFim={moverParaFim}
          arrasto={arrasto}
          aoArrastarMembro={(membro) => arrasto.comecar({
            tipo: 'membro',
            id: membro.id,
            userId: membro.id,
            nome: nomeExibido(membro),
            rotulo: nomeExibido(membro),
            icone: '🔊',
          })}
        />
      <ContextMenu estado={menuContexto.estado} onFechar={menuContexto.fechar} />

      {aviso && (
        <div className={`aviso-flutuante${avisoCallAnimado ? ' aviso-call-animado' : ''}`} role="status" onClick={fecharAviso}>
          {aviso}
        </div>
      )}

      {modal?.type === 'reportar-bug' && (
        <ReportBugModal mensagemDenunciada={modal.mensagem} onClose={() => setModal(null)} />
      )}

      {modal?.type === 'encaminhar' && (
        <EncaminharModal
          mensagem={modal.mensagem}
          guilds={guilds}
          dms={dms}
          onEnviar={encaminharMensagem}
          onClose={() => setModal(null)}
        />
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

      {/* Cargos, membros, convites, banimentos, auditoria e excluir: tudo numa
          tela cheia só, no molde da tela de configurações do usuário. O item
          do menu decide em qual seção ela abre. */}
      {configServidor && guild && (
        <GuildSettingsScreen
          guild={guild}
          me={me}
          abaInicial={configServidor.aba}
          onClose={() => setConfigServidor(null)}
          onErro={setAviso}
          onConfirmar={(pedido) => setModal({ type: 'confirm', ...pedido })}
          onGuildAtualizada={() => {}}
          onGuildExcluida={() => setConfigServidor(null)}
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

      {modal?.type === 'watch-app' && voice.channelId && (
        <WatchTogetherModal
          channelId={voice.channelId}
          onClose={() => setModal(null)}
          onErro={setAviso}
          onStart={async (channelId, media) => {
            const resposta = await voiceActions.watchStart(channelId, media);
            if (resposta?.error) throw new Error(resposta.error);
            setCallMaximizada(true);
          }}
        />
      )}

      {voiceConvite && (
        <div className="convite-call-banner">
          <Avatar user={voiceConvite.de} size={32} className="small" />
          <span className="convite-texto">
            <strong>{voiceConvite.de?.username ?? 'alguém'}</strong> te chamou pra call em{' '}
            <strong>{voiceConvite.channelName}</strong>
          </span>
          <button className="primary" onClick={aceitarConviteDeCall}>Aceitar</button>
          <button className="recusar" onClick={recusarConviteDeCall}>Recusar</button>
        </div>
      )}

      {chamadaSaindo && !voiceConvite && (
        <div className="convite-call-banner chamada-saindo-banner" role="status">
          <div className="chamada-saindo-linha">
            <span className="chamada-saindo-icone" aria-hidden="true">☎</span>
            <span className="convite-texto">
              Chamando <strong>{chamadaSaindo.nome ?? 'alguém'}</strong>
            </span>
            <span className="chamada-pontos" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
          </div>
          <button
            className="chamada-parar"
            onClick={() => {
              voiceActions.cancelarConvite(chamadaSaindo.id);
              setChamadaSaindo(null);
            }}
          >
            Parar de chamar
          </button>
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
          atividade={presencas[modal.userId]?.activity ?? null}
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
