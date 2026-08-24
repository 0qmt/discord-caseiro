import { useEffect, useState } from 'react';
import { api } from '../api.js';
import Avatar from './Avatar.jsx';
import { getSaidaAudio, setSaidaAudio } from '../lib/audioOutput.js';
import { ehDesktop, estadoDaPermissao, notificar, pedirPermissaoDeNotificacao } from '../lib/notificar.js';

/**
 * Estado da permissão de notificação, e o botão pra pedir.
 *
 * Isto existe porque "não recebo notificação" quase sempre é permissão
 * negada no navegador, e sem uma tela mostrando isso a pessoa não tem como
 * descobrir - fica achando que o app está quebrado.
 */
function SecaoNotificacoes() {
  const [permissao, setPermissao] = useState(() => estadoDaPermissao());
  const [testada, setTestada] = useState(false);

  const desktop = ehDesktop();

  const explicacao = {
    granted: desktop
      ? 'O app de desktop entrega as notificações pelo Windows - está tudo certo.'
      : 'O navegador está liberado pra mostrar notificações.',
    default: 'O navegador ainda não perguntou. Clique no botão abaixo pra liberar.',
    denied: 'O navegador bloqueou. Libere no cadeado ao lado do endereço e recarregue a página.',
    indisponivel: 'Este navegador não suporta notificações do sistema.',
  }[permissao] ?? '';

  return (
    <section className="settings-secao">
      <h2>Notificações</h2>

      <div className="settings-linha">
        <div>
          <strong>Permissão do sistema</strong>
          <p className="hint">{explicacao}</p>
        </div>
        <span className={`selo-permissao ${permissao}`}>
          {{ granted: 'liberado', default: 'não perguntado', denied: 'bloqueado' }[permissao] ?? 'indisponível'}
        </span>
      </div>

      <div className="settings-acoes">
        {permissao === 'default' && (
          <button
            className="primary"
            onClick={async () => setPermissao(await pedirPermissaoDeNotificacao())}
          >
            Liberar notificações
          </button>
        )}
        <button
          onClick={() => {
            notificar('Discord Caseiro', 'Se você está lendo isso, as notificações funcionam.');
            setTestada(true);
          }}
        >
          Enviar uma de teste
        </button>
      </div>
      {testada && permissao !== 'granted' && (
        <p className="hint">
          Não apareceu nada? Então é a permissão mesmo — veja a explicação acima.
        </p>
      )}

      <h3>Onde ajustar o resto</h3>
      <p className="hint">
        O nível de cada servidor e canal (tudo / só menções / nada) e o silenciar temporário
        ficam no botão direito em cima do servidor ou do canal, na barra lateral.
        O status <strong>Não perturbe</strong> cala tudo de uma vez.
      </p>
    </section>
  );
}

const VERSAO = __APP_VERSION__;
const BUILD = __BUILD_TIME__;

function formatarBuild(iso) {
  try {
    return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return iso;
  }
}

/**
 * Tela de configurações cheia, no molde do Discord: navegação à esquerda,
 * conteúdo à direita, X pra fechar no canto. Só entram seções que
 * correspondem a algo real do app — nada de imitar "Cobrança" do Discord sem
 * ter o que mostrar nela.
 */
export default function SettingsScreen({ me, souDono, onClose, onLogout, onEditarPerfil }) {
  const [aba, setAba] = useState('conta');

  useEffect(() => {
    const aoTeclar = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [onClose]);

  return (
    <div className="settings-screen">
      <nav className="settings-nav">
        <div className="settings-user">
          <Avatar user={me} size={40} />
          <div className="settings-user-info">
            <strong>{me.username}</strong>
            <span>{me.email}</span>
          </div>
        </div>

        <div className="settings-grupo">
          <span className="settings-grupo-titulo">Usuário</span>
          <button
            className={`settings-item ${aba === 'conta' ? 'ativo' : ''}`}
            onClick={() => setAba('conta')}
          >
            Minha conta
          </button>
        </div>

        <div className="settings-grupo">
          <span className="settings-grupo-titulo">App</span>
          <button
            className={`settings-item ${aba === 'voz' ? 'ativo' : ''}`}
            onClick={() => setAba('voz')}
          >
            Voz e vídeo
          </button>
          <button
            className={`settings-item ${aba === 'notificacoes' ? 'ativo' : ''}`}
            onClick={() => setAba('notificacoes')}
          >
            Notificações
          </button>
          {souDono && (
            <button
              className={`settings-item ${aba === 'servidor' ? 'ativo' : ''}`}
              onClick={() => setAba('servidor')}
            >
              Servidor
            </button>
          )}
        </div>

        <div className="settings-grupo">
          <span className="settings-grupo-titulo">Discord Caseiro</span>
          <button
            className={`settings-item ${aba === 'sobre' ? 'ativo' : ''}`}
            onClick={() => setAba('sobre')}
          >
            Sobre
          </button>
        </div>

        <button className="settings-sair" onClick={onLogout}>
          Sair da conta <span>⏻</span>
        </button>
      </nav>

      <div className="settings-conteudo">
        <button className="settings-fechar" title="Fechar" onClick={onClose}>
          <span className="settings-fechar-x">×</span>
          <span className="settings-fechar-dica">ESC</span>
        </button>

        {aba === 'conta' && (
          <section className="settings-secao">
            <h2>Minha conta</h2>
            <div className="settings-card-conta">
              <Avatar user={me} size={72} />
              <div className="settings-card-conta-info">
                <strong>{me.username}</strong>
                <span>{me.email}</span>
              </div>
              <button className="primary" onClick={onEditarPerfil}>Editar perfil</button>
            </div>
          </section>
        )}

        {aba === 'voz' && <SecaoVoz />}

        {aba === 'notificacoes' && <SecaoNotificacoes />}

        {aba === 'servidor' && souDono && <SecaoServidor />}

        {aba === 'sobre' && (
          <section className="settings-secao">
            <h2>Sobre</h2>
            <p className="hint">
              Discord Caseiro — comunicação em tempo real self-hosted: servidor, canais,
              chat e chamadas rodando na sua própria máquina.
            </p>
            <div className="settings-versao">
              <div><span className="settings-versao-rotulo">Versão</span><span>{VERSAO}</span></div>
              <div><span className="settings-versao-rotulo">Compilado em</span><span>{formatarBuild(BUILD)}</span></div>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

/**
 * Nomes de dispositivo só vêm preenchidos depois que o navegador liberou
 * microfone alguma vez (getUserMedia) - por isso o aviso quando vem vazio,
 * em vez de simplesmente mostrar uma lista de opções sem nome nenhum.
 */
const INTERVALO_STATS_MS = 3000;

function formatarGB(bytes) {
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatarDuracao(segundos) {
  const dias = Math.floor(segundos / 86400);
  const horas = Math.floor((segundos % 86400) / 3600);
  const minutos = Math.floor((segundos % 3600) / 60);
  if (dias > 0) return `${dias}d ${horas}h`;
  if (horas > 0) return `${horas}h ${minutos}min`;
  return `${minutos}min`;
}

/** Barrinha de uso, tipo htop - so muda de cor quando ta ficando preocupante. */
function Barra({ percentual }) {
  const nivel = percentual > 85 ? 'critico' : percentual > 60 ? 'atencao' : 'ok';
  return (
    <div className="stat-barra">
      <div className={`stat-barra-preenchida ${nivel}`} style={{ width: `${Math.min(percentual, 100)}%` }} />
    </div>
  );
}

/** RAM e CPU do celular que hospeda o servidor - só pra quem administra. */
function SecaoServidor() {
  const [stats, setStats] = useState(null);
  const [erro, setErro] = useState(null);
  const [pedindoReload, setPedindoReload] = useState(false);
  const [reloadPedido, setReloadPedido] = useState(false);

  async function avisarTodoMundo() {
    setPedindoReload(true);
    try {
      await api.adminReload();
      setReloadPedido(true);
    } catch (e) {
      setErro(e.message);
    } finally {
      setPedindoReload(false);
    }
  }

  useEffect(() => {
    let cancelado = false;
    const buscar = () => {
      api.adminStats()
        .then((s) => { if (!cancelado) { setStats(s); setErro(null); } })
        .catch((e) => { if (!cancelado) setErro(e.message); });
    };
    buscar();
    const timer = setInterval(buscar, INTERVALO_STATS_MS);
    return () => { cancelado = true; clearInterval(timer); };
  }, []);

  return (
    <section className="settings-secao">
      <h2>Servidor</h2>
      <p className="hint">Saúde da máquina que está hospedando o Discord Caseiro, ao vivo.</p>

      {erro && <div className="auth-error">{erro}</div>}
      {!stats && !erro && <p className="hint">carregando...</p>}

      {stats && (
        <div className="stats-servidor">
          <div className="stat-linha">
            <span className="stat-rotulo">CPU ({stats.cpuCount} núcleos)</span>
            <span className="stat-valor">{stats.cpuPercent}%</span>
          </div>
          <Barra percentual={stats.cpuPercent} />

          <div className="stat-linha">
            <span className="stat-rotulo">Memória</span>
            <span className="stat-valor">{formatarGB(stats.memUsed)} / {formatarGB(stats.memTotal)}</span>
          </div>
          <Barra percentual={(stats.memUsed / stats.memTotal) * 100} />

          <div className="stat-linha">
            <span className="stat-rotulo">Ligado há</span>
            <span className="stat-valor">{formatarDuracao(stats.uptimeSeconds)}</span>
          </div>
        </div>
      )}

      <h2 className="settings-subtitulo">Atualizar todo mundo</h2>
      <p className="hint">
        Depois de publicar uma mudança, isso recarrega o app de todo mundo sozinho —
        quem estiver numa chamada só atualiza quando sair dela.
      </p>
      <button className="primary" onClick={avisarTodoMundo} disabled={pedindoReload}>
        {reloadPedido ? 'Aviso enviado' : pedindoReload ? 'Enviando...' : 'Recarregar todo mundo'}
      </button>
    </section>
  );
}

function SecaoVoz() {
  const [dispositivos, setDispositivos] = useState([]);
  const [saida, setSaida] = useState(getSaidaAudio());
  const [suportado, setSuportado] = useState(true);

  useEffect(() => {
    if (typeof HTMLMediaElement === 'undefined' || !HTMLMediaElement.prototype.setSinkId) {
      setSuportado(false);
      return;
    }
    navigator.mediaDevices?.enumerateDevices()
      .then((lista) => setDispositivos(lista.filter((d) => d.kind === 'audiooutput')))
      .catch(() => {});
  }, []);

  const escolher = (deviceId) => {
    setSaida(deviceId);
    setSaidaAudio(deviceId);
  };

  return (
    <section className="settings-secao">
      <h2>Voz e vídeo</h2>

      {!suportado ? (
        <p className="hint">Escolher saída de áudio não é suportado neste navegador.</p>
      ) : (
        <label className="settings-campo">
          <span>Saída de áudio</span>
          <select value={saida} onChange={(e) => escolher(e.target.value)}>
            <option value="">Padrão do sistema</option>
            {dispositivos.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || 'Dispositivo de áudio'}
              </option>
            ))}
          </select>
          {dispositivos.length > 0 && dispositivos.every((d) => !d.label) && (
            <span className="hint">
              Sem nome porque o navegador ainda não liberou - entra numa chamada uma vez e volta aqui.
            </span>
          )}
        </label>
      )}
    </section>
  );
}
