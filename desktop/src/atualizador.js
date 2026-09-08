const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow, ipcMain, screen } = require('electron');
const { autoUpdater } = require('electron-updater');

const ESPERA_INICIAL_MS = 15_000;
const INTERVALO_MS = 30 * 60 * 1000;
const REAVISO_MS = 20 * 60 * 1000;
const RETRY_INICIAL_MS = [5_000, 30_000];
const LIMITE_LOG = 512 * 1024;
const MAX_LOGS = 3;

autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = false;
// Atualizacao vem do GitHub Releases (ver "publish" em package.json), nao
// mais do nosso tunel - o instalador e grande (~90MB) e baixar ele pelo
// tunel caseiro toda hora e o que estourava a banda gratis do ngrok.

const ARQUIVO_TRANSICAO = 'update-transition.json';
let estado = {
  status: 'idle',
  currentVersion: null,
  availableVersion: null,
  percent: 0,
  transferred: 0,
  total: 0,
  error: null,
  downloaded: false,
};
let infoBaixada = null;
let janelaAviso = null;
let timeoutReaviso = null;
let emCallAgora = false;
let jaMandouReiniciar = false;
let registrarSaidaParaAtualizacao = () => {};
let arquivoLog = null;
let inicializado = false;
let timerChecagem = null;
let timerRetry = null;
let checagemEmAndamento = false;
let tentativaInicial = 0;
let ultimaVersaoBaixada = null;
let veioDaPaginaPermitida = () => false;
let resolverAbertura = null;
let modoDeAbertura = false;

const paginaLocal = (nome) => path.join(__dirname, nome);

function registrar(mensagem, extra = null) {
  const linha = `${new Date().toISOString()} ${mensagem}${extra ? ` ${JSON.stringify(extra)}` : ''}\n`;
  console.info(`[atualizacao] ${mensagem}`, extra ?? '');
  if (!arquivoLog) return;
  try {
    if (fs.existsSync(arquivoLog) && fs.statSync(arquivoLog).size + Buffer.byteLength(linha) > LIMITE_LOG) {
      for (let indice = MAX_LOGS - 1; indice >= 1; indice -= 1) {
        const antigo = `${arquivoLog}.${indice}`;
        const proximo = `${arquivoLog}.${indice + 1}`;
        if (fs.existsSync(antigo)) fs.renameSync(antigo, proximo);
      }
      fs.renameSync(arquivoLog, `${arquivoLog}.1`);
    }
    fs.appendFileSync(arquivoLog, linha.replace(String(process.env.USERPROFILE ?? ''), '<USER>'), 'utf8');
  } catch (erro) { console.warn('[atualizacao] falha ao gravar log', erro); }
}

function definirEstado(mudancas, evento = null) {
  estado = { ...estado, ...mudancas };
  if (evento) registrar(evento, estado);
}

function caminhoTransicao() { return path.join(app.getPath('userData'), ARQUIVO_TRANSICAO); }

function confirmarTransicaoAnterior() {
  const arquivo = caminhoTransicao();
  if (!fs.existsSync(arquivo)) return;
  try {
    const transicao = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
    const atual = app.getVersion();
    if (atual === transicao.expectedVersion) {
      registrar(`Update ${transicao.previousVersion} -> ${atual} confirmado`);
    } else {
      registrar(`Update ${transicao.previousVersion} -> ${transicao.expectedVersion} nao aplicado; app iniciou em ${atual}`);
    }
    fs.rmSync(arquivo, { force: true });
  } catch (erro) {
    registrar('Falha ao confirmar transicao do update', { erro: String(erro), stack: erro?.stack });
  }
}

function prepararTransicao(info, status = 'prepared') {
  const transicao = { status, previousVersion: app.getVersion(), expectedVersion: String(info.version) };
  const arquivo = caminhoTransicao();
  const temporario = `${arquivo}.tmp`;
  fs.writeFileSync(temporario, JSON.stringify(transicao), 'utf8');
  fs.renameSync(temporario, arquivo);
}

function areaDoMonitorAtual() {
  return screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
}

function boundsDoAviso(area = areaDoMonitorAtual()) {
  const width = Math.min(640, area.width);
  const height = Math.min(420, area.height);
  return {
    x: Math.round(area.x + ((area.width - width) / 2)),
    y: Math.round(area.y + ((area.height - height) / 2)),
    width,
    height,
  };
}

function estaForaDasTelas(bounds) {
  return !screen.getAllDisplays().some(({ workArea }) => {
    const largura = Math.max(0, Math.min(bounds.x + bounds.width, workArea.x + workArea.width) - Math.max(bounds.x, workArea.x));
    const altura = Math.max(0, Math.min(bounds.y + bounds.height, workArea.y + workArea.height) - Math.max(bounds.y, workArea.y));
    return largura > 80 && altura > 80;
  });
}

function apresentarAviso() {
  if (!janelaAviso || janelaAviso.isDestroyed()) return false;
  const bounds = janelaAviso.getBounds();
  const precisaReposicionar = estaForaDasTelas(bounds);
  if (precisaReposicionar) janelaAviso.setBounds(boundsDoAviso());
  if (janelaAviso.isMinimized()) janelaAviso.restore();
  if (!janelaAviso.isVisible()) janelaAviso.show();
  janelaAviso.moveTop();
  janelaAviso.focus();
  registrar('janela de atualizacao apresentada', {
    bounds: janelaAviso.getBounds(),
    visivel: janelaAviso.isVisible(),
    minimizada: janelaAviso.isMinimized(),
    focada: janelaAviso.isFocused(),
    reposicionada: precisaReposicionar,
  });
  return true;
}

/**
 * Não é fullscreen/kiosk de verdade (isso tomaria a tela toda do Windows,
 * inclusive fora do app). É uma janela do tamanho da área útil da tela,
 * sempre por cima - cobre a visão como se fosse tela cheia, mas sem
 * atrapalhar quem estiver numa chamada: a janela principal continua rodando
 * por trás, áudio e tudo, até a pessoa decidir reiniciar.
 */
function mostrarAviso() {
  registrar('abrirJanelaAtualizacao chamada', {
    temInfo: Boolean(infoBaixada),
    janelaExiste: Boolean(janelaAviso),
    janelaDestruida: janelaAviso?.isDestroyed?.() ?? null,
    visivel: janelaAviso?.isVisible?.() ?? null,
    minimizada: janelaAviso?.isMinimized?.() ?? null,
  });
  if (!infoBaixada) return;
  if (janelaAviso && !janelaAviso.isDestroyed()) {
    registrar('janela de atualizacao ja existia', {
      visivel: janelaAviso.isVisible(),
      minimizada: janelaAviso.isMinimized(),
    });
    apresentarAviso();
    return;
  }

  janelaAviso = new BrowserWindow({
    ...boundsDoAviso(),
    show: false,
    frame: false,
    resizable: false,
    minimizable: true,
    skipTaskbar: false,
    alwaysOnTop: true,
    backgroundColor: '#16171b',
    webPreferences: {
      preload: paginaLocal('preload-atualizacao.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  registrar('BrowserWindow de atualizacao criada', {
    bounds: janelaAviso.getBounds(),
    visivel: janelaAviso.isVisible(),
    sempreNoTopo: janelaAviso.isAlwaysOnTop(),
    show: false,
    skipTaskbar: false,
    modal: false,
    parent: janelaAviso.getParentWindow()?.id ?? null,
  });

  janelaAviso.on('ready-to-show', () => {
    registrar('janela de atualizacao ready-to-show');
    apresentarAviso();
  });
  janelaAviso.on('show', () => registrar('janela de atualizacao show'));
  janelaAviso.on('focus', () => registrar('janela de atualizacao focus'));
  janelaAviso.on('hide', () => registrar('janela de atualizacao hide'));
  janelaAviso.on('close', () => registrar('janela de atualizacao close'));
  janelaAviso.on('closed', () => { registrar('janela de atualizacao closed'); janelaAviso = null; });
  janelaAviso.webContents.on('did-fail-load', (_evento, codigo, descricao, url, principal) => {
    registrar('falha ao carregar janela de atualizacao', { codigo, descricao, url, principal });
  });
  janelaAviso.webContents.on('did-finish-load', () => {
    registrar('atualizacao.html carregado');
    // Fallback imediato se o Chromium nao emitir ready-to-show.
    apresentarAviso();
  });
  janelaAviso.webContents.on('render-process-gone', (_evento, detalhes) => registrar('renderer da atualizacao terminou', detalhes));
  janelaAviso.webContents.on('preload-error', (_evento, caminho, erro) => registrar('falha no preload da atualizacao', { caminho, erro: String(erro) }));
  janelaAviso.webContents.on('console-message', (_evento, nivel, mensagem, linha, origem) => {
    if (nivel >= 2) registrar('console do renderer da atualizacao', { nivel, mensagem, linha, origem });
  });
  registrar('loadFile da atualizacao iniciado');
  janelaAviso.loadFile(paginaLocal('atualizacao.html')).catch((erro) => {
    registrar('loadFile da atualizacao rejeitado', { erro: String(erro), stack: erro?.stack });
  });
}

function agendarReaviso() {
  clearTimeout(timeoutReaviso);
  timeoutReaviso = setTimeout(mostrarAviso, REAVISO_MS);
}

/*
 * A instalacao sempre e iniciada por uma escolha explicita do usuario. Se o
 * download terminar durante uma call, o aviso fica pendente ate ela terminar.
 */
function reiniciarNaHora() {
  if (jaMandouReiniciar || estado.status !== 'ready' || !infoBaixada) return false;
  jaMandouReiniciar = true;
  clearTimeout(timeoutReaviso);
  janelaAviso?.close();
  definirEstado({ status: 'installing' }, 'Instalacao solicitada');
  prepararTransicao(infoBaixada, 'prepared');
  let restaurarSaidaNormal = null;
  try {
    restaurarSaidaNormal = registrarSaidaParaAtualizacao();
    prepararTransicao(infoBaixada, 'requested');
    registrar('Encerramento para update iniciado');
    autoUpdater.quitAndInstall(true, true);
    registrar('quitAndInstall chamado');
    return true;
  } catch (erro) {
    jaMandouReiniciar = false;
    definirEstado({ status: 'ready', error: String(erro?.message ?? erro) }, 'Falha imediata ao iniciar instalacao');
    registrar('Stack da falha imediata do quitAndInstall', { stack: erro?.stack });
    try { fs.rmSync(caminhoTransicao(), { force: true }); } catch {}
    try { restaurarSaidaNormal?.(); } catch (restaurarErro) { registrar('Falha ao restaurar saida normal', { stack: restaurarErro?.stack }); }
    return false;
  }
}

function concluirAbertura(resultado) {
  const resolver = resolverAbertura;
  resolverAbertura = null;
  resolver?.(resultado);
}

function iniciar(veioDaNossaPagina, prepararSaida, { antesDeAbrir = false } = {}) {
  if (inicializado) return Promise.resolve('continuar');
  inicializado = true;
  modoDeAbertura = Boolean(antesDeAbrir);
  veioDaPaginaPermitida = veioDaNossaPagina ?? (() => false);
  registrarSaidaParaAtualizacao = prepararSaida ?? (() => {});
  arquivoLog = path.join(app.getPath('userData'), 'updater.log');
  confirmarTransicaoAnterior();
  estado.currentVersion = app.getVersion();
  registrar(`App iniciado: ${estado.currentVersion}`);

  autoUpdater.on('checking-for-update', () => definirEstado({ status: 'checking', error: null }, 'Verificando atualizacao'));
  autoUpdater.on('update-available', (info) => {
    infoBaixada = info;
    definirEstado({ status: 'available', availableVersion: info.version, downloaded: false }, 'Release encontrada');
    // A splash só espera a resposta da consulta. Esperar o download inteiro
    // aqui deixa o app aparentemente travado quando a rede é lenta, o cache
    // está sendo recuperado ou o updater demora a emitir erro.
    concluirAbertura('continuar');
  });
  autoUpdater.on('update-not-available', (info) => {
    definirEstado({ status: 'idle', availableVersion: info.version, downloaded: false }, 'Nenhuma atualizacao disponivel');
    concluirAbertura('continuar');
  });
  autoUpdater.on('download-progress', (progresso) => {
    definirEstado({ status: 'downloading', percent: progresso.percent ?? 0, transferred: progresso.transferred ?? 0, total: progresso.total ?? 0 }, 'Download em andamento');
  });
  autoUpdater.on('update-downloaded', (info) => {
    registrar('update-downloaded recebido', { version: info.version, emCall: emCallAgora });
    if (estado.status === 'ready' && ultimaVersaoBaixada === info.version) return;
    infoBaixada = info;
    ultimaVersaoBaixada = info.version;
    definirEstado({ status: 'ready', availableVersion: info.version, percent: 100, downloaded: true }, 'Download concluido');
    registrar('Update ready');
    // Estar em chamada nunca pode esconder a unica forma de aplicar uma
    // atualizacao. A instalacao ainda depende de clique explicito, portanto
    // nao derruba audio, camera ou tela por conta propria.
    mostrarAviso();
  });

  autoUpdater.on('error', (erro) => {
    definirEstado({ status: 'failed', error: String(erro?.message ?? erro), downloaded: false }, 'Falha na atualizacao');
    registrar('Stack da falha', { stack: erro?.stack });
    concluirAbertura('continuar');
  });

  const checar = async () => {
    if (checagemEmAndamento || estado.status === 'downloading' || estado.status === 'installing') return;
    if (estado.status === 'ready' && infoBaixada) return;
    checagemEmAndamento = true;
    try { await autoUpdater.checkForUpdates(); tentativaInicial = 0; }
    catch (erro) {
      definirEstado({ status: 'failed', error: String(erro?.message ?? erro) }, 'Falha ao checar atualizacao');
      registrar('Stack da falha ao checar', { stack: erro?.stack });
      if (tentativaInicial < RETRY_INICIAL_MS.length) {
        const espera = RETRY_INICIAL_MS[tentativaInicial++];
        clearTimeout(timerRetry);
        timerRetry = setTimeout(checar, espera);
      }
    } finally { checagemEmAndamento = false; }
  };

  if (modoDeAbertura) checar();
  else setTimeout(checar, ESPERA_INICIAL_MS);
  timerChecagem = setInterval(checar, INTERVALO_MS);

  /*
   * O client manda isso toda vez que entra/sai de uma call (ver
   * useVoice.js). Se já tinha atualização baixada esperando (a pessoa
   * tinha adiado, ou o download só terminou depois que ela entrou numa
   * call), a janela volta a aparecer quando ela sai. Nunca reiniciamos no
   * meio de uma chamada.
   */
  ipcMain.on('app:em-call', (evento, { emCall } = {}) => {
    if (!veioDaPaginaPermitida(evento)) return;
    emCallAgora = Boolean(emCall);
    if (!emCallAgora && infoBaixada && estado.status === 'ready') mostrarAviso();
  });
  return modoDeAbertura ? new Promise((resolve) => { resolverAbertura = resolve; }) : Promise.resolve('continuar');
}

ipcMain.handle('atualizacao:info', (evento) => (
  veioDaPaginaPermitida(evento) ? { ...estado } : null
));

ipcMain.handle('atualizacao:mostrar', (evento) => {
  if (!veioDaPaginaPermitida(evento) || estado.status !== 'ready' || !infoBaixada) return false;
  mostrarAviso();
  return true;
});

ipcMain.handle('atualizacao:reiniciar', (evento) => {
  if (!veioDaPaginaPermitida(evento)) return false;
  // silent=true: instala sem abrir nenhuma janela de instalador (nem a
  // barrinha de progresso do NSIS). forceRunAfter=true: reabre o app sozinho
  // depois - a pessoa só vê a tela cheia de aviso e, alguns segundos depois,
  // o app de volta já na versão nova.
  return reiniciarNaHora();
});

ipcMain.handle('atualizacao:adiar', (evento) => {
  if (!veioDaPaginaPermitida(evento)) return false;
  janelaAviso?.close();
  agendarReaviso();
  return true;
});

module.exports = { iniciar };
