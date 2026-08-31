import { useEffect, useState } from 'react';
import { api } from '../api.js';
import Avatar from './Avatar.jsx';
import ColorPicker from './ColorPicker.jsx';
import { getSaidaAudio, setSaidaAudio } from '../lib/audioOutput.js';
import { getEntradaAudio, setEntradaAudio } from '../lib/audioInput.js';
import { ehDesktop, estadoDaPermissao, notificar, pedirPermissaoDeNotificacao } from '../lib/notificar.js';
import {
  aplicarGradienteApp, aplicarTemaApp, reaplicarTemaSalvo, removerTemaApp,
  salvarTemaAppCor, salvarTemaAppGradiente, temaAppSalvo,
} from '../lib/temaApp.js';

const COR_TEMA_PADRAO = '#5865f2';
const INTENSIDADE_PADRAO = 50;
const GRAD_COR1_PADRAO = '#1c1033';
const GRAD_COR2_PADRAO = '#4b2ea3';
const GRAD_ANGULO_PADRAO = 135;

/**
 * Cor (ou gradiente) do app inteiro, igual à aba "Temas" do Discord de
 * verdade: escolhe, o app inteiro já muda na hora (é só CSS, não precisa
 * salvar pra ver) e dá pra navegar à vontade assim, pré-visualizando.
 * "Aplicar" é o que fixa de verdade (fica depois de fechar/recarregar);
 * saindo daqui sem aplicar, volta pro que já estava valendo antes.
 */
function SecaoTemas() {
  const salvo = temaAppSalvo();
  const [modo, setModo] = useState(salvo?.tipo ?? 'cor');

  // modo "cor": `cor: null` = nenhum tema ainda, só começa a valer quando
  // a pessoa escolhe de verdade no seletor.
  const [cor, setCor] = useState(salvo?.tipo === 'cor' ? salvo.cor : null);
  const [intensidade, setIntensidade] = useState(salvo?.tipo === 'cor' ? salvo.intensidade : INTENSIDADE_PADRAO);

  // modo "gradiente": já começa com um par bonito, porque trocar pra essa
  // aba já é a pessoa dizendo "quero ver como fica" - igual escolher um
  // tema pronto na galeria do cartão de perfil.
  const [cor1, setCor1] = useState(salvo?.tipo === 'gradiente' ? salvo.cor1 : GRAD_COR1_PADRAO);
  const [cor2, setCor2] = useState(salvo?.tipo === 'gradiente' ? salvo.cor2 : GRAD_COR2_PADRAO);
  const [angulo, setAngulo] = useState(salvo?.tipo === 'gradiente' ? salvo.angulo : GRAD_ANGULO_PADRAO);

  const [seletorAberto, setSeletorAberto] = useState(null); // null | 'solida' | 'grad1' | 'grad2'

  useEffect(() => {
    if (modo === 'gradiente') aplicarGradienteApp(cor1, cor2, angulo);
    else aplicarTemaApp(cor, intensidade);
  }, [modo, cor, intensidade, cor1, cor2, angulo]);

  // Saiu da tela sem clicar em "Aplicar": desfaz a prévia e volta pro que
  // já estava valendo (o tema salvo, ou o padrão do app).
  useEffect(() => reaplicarTemaSalvo, []);

  const mudouDoSalvo = modo === 'gradiente'
    ? (salvo?.tipo !== 'gradiente' || cor1 !== salvo.cor1 || cor2 !== salvo.cor2 || angulo !== salvo.angulo)
    : (salvo?.tipo === 'gradiente' ? Boolean(cor) : cor !== (salvo?.cor ?? null) || (Boolean(cor) && intensidade !== (salvo?.intensidade ?? INTENSIDADE_PADRAO)));
  const jaEhPadrao = !salvo;

  return (
    <section className="settings-secao">
      <h2>Temas</h2>
      <p className="hint">
        Escolha uma cor ou um gradiente pro app inteiro. Você já vê o resultado agora, navegando
        à vontade — só fica valendo de verdade depois que clicar em "Aplicar tema".
      </p>

      <div className="tema-app-modos">
        <button type="button" className={modo === 'cor' ? 'ativo' : ''} onClick={() => setModo('cor')}>
          Cor sólida
        </button>
        <button type="button" className={modo === 'gradiente' ? 'ativo' : ''} onClick={() => setModo('gradiente')}>
          Gradiente
        </button>
      </div>

      {modo === 'cor' ? (
        <div className="tema-app-escolha">
          <div className="tema-cor-campo">
            <button
              type="button"
              className="tema-cor-botao"
              style={{ background: cor ?? 'var(--bg-3)' }}
              onClick={() => setSeletorAberto(seletorAberto === 'solida' ? null : 'solida')}
            />
            <span>Cor do tema</span>
            {seletorAberto === 'solida' && (
              <ColorPicker
                valor={cor ?? COR_TEMA_PADRAO}
                onEscolher={setCor}
                onFechar={() => setSeletorAberto(null)}
              />
            )}
          </div>
          {seletorAberto === 'solida' && <div className="click-fora" onClick={() => setSeletorAberto(null)} />}

          {cor && (
            <label className="tema-posicao">
              Intensidade
              <input
                type="range"
                min={0}
                max={100}
                value={intensidade}
                onChange={(e) => setIntensidade(Number(e.target.value))}
              />
            </label>
          )}
        </div>
      ) : (
        <div className="tema-app-escolha">
          <div
            className="tema-app-preview-gradiente"
            style={{ backgroundImage: `linear-gradient(${angulo}deg, ${cor1}, ${cor2})` }}
          />

          <div className="tema-cores">
            <div className="tema-cor-campo">
              <button
                type="button"
                className="tema-cor-botao"
                style={{ background: cor1 }}
                onClick={() => setSeletorAberto(seletorAberto === 'grad1' ? null : 'grad1')}
              />
              <span>Cor 1</span>
              {seletorAberto === 'grad1' && (
                <ColorPicker valor={cor1} onEscolher={setCor1} onFechar={() => setSeletorAberto(null)} />
              )}
            </div>

            <div className="tema-cor-campo">
              <button
                type="button"
                className="tema-cor-botao"
                style={{ background: cor2 }}
                onClick={() => setSeletorAberto(seletorAberto === 'grad2' ? null : 'grad2')}
              />
              <span>Cor 2</span>
              {seletorAberto === 'grad2' && (
                <ColorPicker valor={cor2} onEscolher={setCor2} onFechar={() => setSeletorAberto(null)} />
              )}
            </div>
          </div>
          {seletorAberto && <div className="click-fora" onClick={() => setSeletorAberto(null)} />}

          <label className="tema-posicao">
            Ângulo ({angulo}°)
            <input
              type="range"
              min={0}
              max={360}
              value={angulo}
              onChange={(e) => setAngulo(Number(e.target.value))}
            />
          </label>
        </div>
      )}

      <div className="settings-acoes">
        <button
          className="primary"
          onClick={() => {
            if (modo === 'gradiente') salvarTemaAppGradiente(cor1, cor2, angulo);
            else salvarTemaAppCor(cor, intensidade);
          }}
          disabled={(modo === 'cor' && !cor) || !mudouDoSalvo}
        >
          Aplicar tema
        </button>
        <button
          onClick={() => {
            removerTemaApp();
            aplicarTemaApp(null, 0);
            setModo('cor');
            setCor(null);
            setIntensidade(INTENSIDADE_PADRAO);
            setCor1(GRAD_COR1_PADRAO);
            setCor2(GRAD_COR2_PADRAO);
            setAngulo(GRAD_ANGULO_PADRAO);
          }}
          disabled={jaEhPadrao && !mudouDoSalvo}
        >
          Usar padrão
        </button>
      </div>
    </section>
  );
}

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
export default function SettingsScreen({
  me, souDono, onClose, onLogout, onEditarPerfil, interfaceTeste, onAlternarInterfaceTeste,
}) {
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
          <button
            className={`settings-item ${aba === 'temas' ? 'ativo' : ''}`}
            onClick={() => setAba('temas')}
          >
            Temas
          </button>
          <button
            className={`settings-item ${aba === 'versao-teste' ? 'ativo' : ''}`}
            onClick={() => setAba('versao-teste')}
          >
            Versão de teste
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

        {aba === 'temas' && <SecaoTemas />}

        {aba === 'versao-teste' && (
          <section className="settings-secao">
            <h2>Versão de teste</h2>
            <p className="hint">
              Um visual novo do app, em construção — vai ganhar mais recursos e ficar mais bonito
              aos poucos. Suas mensagens e servidores são os mesmos dos dois lados, é só a tela
              que muda; dá pra voltar pra clássica a qualquer momento, inclusive por um botão
              dentro da própria versão de teste.
            </p>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={interfaceTeste}
                onChange={(e) => onAlternarInterfaceTeste(e.target.checked)}
              />
              Ativar a versão de teste
            </label>
          </section>
        )}

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
  const [saidas, setSaidas] = useState([]);
  const [entradas, setEntradas] = useState([]);
  const [saida, setSaida] = useState(getSaidaAudio());
  const [entrada, setEntrada] = useState(getEntradaAudio());
  const [suportadoSaida, setSuportadoSaida] = useState(true);

  useEffect(() => {
    if (typeof HTMLMediaElement === 'undefined' || !HTMLMediaElement.prototype.setSinkId) {
      setSuportadoSaida(false);
    }
    navigator.mediaDevices?.enumerateDevices()
      .then((lista) => {
        setSaidas(lista.filter((d) => d.kind === 'audiooutput'));
        setEntradas(lista.filter((d) => d.kind === 'audioinput'));
      })
      .catch(() => {});
  }, []);

  const escolherSaida = (deviceId) => {
    setSaida(deviceId);
    setSaidaAudio(deviceId);
  };

  const mudarEntrada = (parcial) => setEntrada(setEntradaAudio(parcial));

  // 50% a 300%: abaixo disso a pessoa já tem como abaixar no próprio SO, e
  // acima o áudio começa a estourar (clipar) antes de ficar realmente mais
  // "alto" de um jeito útil.
  const percentualGanho = Math.round(entrada.ganho * 100);

  return (
    <section className="settings-secao">
      <h2>Voz e vídeo</h2>

      {!suportadoSaida ? (
        <p className="hint">Escolher saída de áudio não é suportado neste navegador.</p>
      ) : (
        <label className="settings-campo">
          <span>Saída de áudio (onde o som sai)</span>
          <select value={saida} onChange={(e) => escolherSaida(e.target.value)}>
            <option value="">Padrão do sistema</option>
            {saidas.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || 'Dispositivo de áudio'}
              </option>
            ))}
          </select>
        </label>
      )}

      <label className="settings-campo">
        <span>Entrada de áudio (microfone)</span>
        <select value={entrada.deviceId} onChange={(e) => mudarEntrada({ deviceId: e.target.value })}>
          <option value="">Padrão do sistema</option>
          {entradas.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || 'Microfone'}
            </option>
          ))}
        </select>
      </label>

      {saidas.length + entradas.length > 0 && saidas.every((d) => !d.label) && entradas.every((d) => !d.label) && (
        <p className="hint">
          Os dispositivos aparecem sem nome porque o navegador ainda não liberou -
          entra numa chamada de voz uma vez e volta aqui.
        </p>
      )}

      <label className="settings-campo checkbox">
        <input
          type="checkbox"
          checked={entrada.noiseSuppression}
          onChange={(e) => mudarEntrada({ noiseSuppression: e.target.checked })}
        />
        <span>Supressor de ruído (reduz ruído de fundo automaticamente)</span>
      </label>

      <label className="settings-campo">
        <span>Sensibilidade do microfone — {percentualGanho}%</span>
        <input
          type="range"
          min="50"
          max="300"
          step="10"
          value={percentualGanho}
          onChange={(e) => mudarEntrada({ ganho: Number(e.target.value) / 100 })}
        />
        <span className="hint">Mais pra esquerda = mais fraco, mais pra direita = mais forte.</span>
      </label>
      {percentualGanho !== 100 && (
        <button type="button" className="link" onClick={() => mudarEntrada({ ganho: 1 })}>
          Voltar pro normal (100%)
        </button>
      )}
    </section>
  );
}
