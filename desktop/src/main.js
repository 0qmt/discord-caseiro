const path = require('node:path');
const {
  app, BrowserWindow, Menu, Notification, Tray, nativeImage, ipcMain, session, shell, dialog,
} = require('electron');
const config = require('./config.js');
const jogos = require('./jogos.js');
const { instalarPermissoes, instalarCapturaDeTela } = require('./sessao.js');

const DEV_URL = process.env.DISCORD_CASEIRO_DEV_URL ?? null;

// Sem isso o Windows não sabe de qual "app" é a notificação e simplesmente
// não mostra nada, em silêncio - sem erro nenhum no console pra avisar.
app.setAppUserModelId('com.discordcaseiro.app');

let janela = null;
let splash = null;
let bandeja = null;
let saindoDeVerdade = false;
let servidorAtual = DEV_URL ?? config.ler().serverUrl;

/*
 * Isto precisa acontecer ANTES do app ficar pronto: flags de linha de comando
 * do Chromium só valem se forem definidas antes da inicialização. É esta linha
 * que faz microfone, câmera e captura de tela funcionarem num servidor caseiro
 * em http, sem ninguém precisar mexer em flag de navegador.
 */
if (config.precisaLiberarOrigemInsegura(servidorAtual)) {
  app.commandLine.appendSwitch('unsafely-treat-insecure-origin-as-secure', servidorAtual);
  app.commandLine.appendSwitch('disable-features', 'BlockInsecurePrivateNetworkRequests');
}

const ehNossoServidor = (url) => config.mesmaOrigem(url, servidorAtual);

const paginaLocal = (nome) => path.join(__dirname, nome);

/*
 * Servidores expostos por tunel gratuito (ngrok) mostram uma pagina de aviso
 * ("voce esta prestes a visitar...") pra qualquer pedido com cara de
 * navegador, a nao ser que o pedido leve este cabecalho - e isso vale pra
 * TODO pedido (documento, JS, CSS, fetch da API, websocket), nao so a
 * navegacao inicial: só a pagina html sem os assets/API por trás dela é uma
 * tela em branco. Por isso instalamos um hook na sessao inteira (ver
 * instalarCabecalhoDeTunel) em vez de so passar extraHeaders no loadURL.
 * Inofensivo contra servidor local ou na rede, entao mandamos sempre.
 */
const CABECALHOS_TUNEL = { 'ngrok-skip-browser-warning': '1' };

function instalarCabecalhoDeTunel(sessao) {
  sessao.webRequest.onBeforeSendHeaders((detalhes, callback) => {
    Object.assign(detalhes.requestHeaders, CABECALHOS_TUNEL);
    callback({ requestHeaders: detalhes.requestHeaders });
  });
}

async function servidorRespondendo(url) {
  try {
    const resposta = await fetch(`${url}/api/health`, {
      headers: CABECALHOS_TUNEL,
      signal: AbortSignal.timeout(4000),
    });
    return resposta.ok;
  } catch {
    return false;
  }
}

async function abrirOndeDer() {
  if (!servidorAtual) return janela.loadFile(paginaLocal('configurar.html'));

  if (await servidorRespondendo(servidorAtual)) {
    return janela.loadURL(servidorAtual);
  }

  return janela.loadFile(paginaLocal('configurar.html'), {
    query: { erro: 'fora-do-ar', endereco: servidorAtual },
  });
}

function mostrarSplash() {
  splash = new BrowserWindow({
    width: 280,
    height: 280,
    frame: false,
    resizable: false,
    show: true,
    alwaysOnTop: true,
    backgroundColor: '#16171b',
    webPreferences: { sandbox: true },
  });
  splash.loadFile(paginaLocal('splash.html'));
}

function criarJanela() {
  janela = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 560,
    backgroundColor: '#1d1f24',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: paginaLocal('preload-configurar.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  janela.once('ready-to-show', () => {
    if (splash && !splash.isDestroyed()) splash.close();
    splash = null;
    janela.show();
  });

  // Fechar no X so minimiza pra bandeja - continua recebendo chamada e
  // mensagem por trás. So sai de verdade pelo menu/bandeja "Sair".
  janela.on('close', (evento) => {
    if (saindoDeVerdade) return;
    evento.preventDefault();
    janela.hide();
  });

  // Link externo abre no navegador do sistema, não dentro do app.
  janela.webContents.setWindowOpenHandler(({ url }) => {
    if (!ehNossoServidor(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  janela.webContents.on('will-navigate', (evento, url) => {
    if (!ehNossoServidor(url) && !url.startsWith('file://')) {
      evento.preventDefault();
      shell.openExternal(url);
    }
  });

  abrirOndeDer();
}

function mostrarJanelaPrincipal() {
  if (!janela) return;
  if (janela.isMinimized()) janela.restore();
  janela.show();
  janela.focus();
}

function montarBandeja() {
  const icone = nativeImage.createFromPath(paginaLocal('logo.png')).resize({ width: 32, height: 32 });
  bandeja = new Tray(icone);
  bandeja.setToolTip('Discord Caseiro');
  bandeja.setContextMenu(Menu.buildFromTemplate([
    { label: 'Abrir Discord Caseiro', click: mostrarJanelaPrincipal },
    { type: 'separator' },
    {
      label: 'Sair',
      click: () => {
        saindoDeVerdade = true;
        app.quit();
      },
    },
  ]));
  bandeja.on('double-click', mostrarJanelaPrincipal);
}

function montarMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: 'Arquivo',
      submenu: [
        {
          label: 'Trocar de servidor...',
          click: () => janela?.loadFile(paginaLocal('configurar.html'), {
            query: { endereco: servidorAtual ?? '' },
          }),
        },
        { type: 'separator' },
        {
          label: 'Sair',
          click: () => {
            saindoDeVerdade = true;
            app.quit();
          },
        },
      ],
    },
    {
      label: 'Exibir',
      submenu: [
        { role: 'reload', label: 'Recarregar' },
        { role: 'forceReload', label: 'Recarregar ignorando cache' },
        { role: 'toggleDevTools', label: 'Ferramentas de desenvolvedor' },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Zoom normal' },
        { role: 'zoomIn', label: 'Aumentar zoom' },
        { role: 'zoomOut', label: 'Diminuir zoom' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Tela cheia' },
      ],
    },
  ]));
}

/*
 * A ponte `window.appDesktop` fica exposta em qualquer pagina, entao a
 * checagem de quem pode usa-la e feita aqui: so a janela carregada do NOSSO
 * servidor (ou uma pagina local do proprio app) e atendida. Confiar num
 * `location.origin` lido dentro do preload seria confiar na propria pagina.
 */
function veioDaNossaPagina(evento) {
  const url = evento.senderFrame?.url ?? '';
  return url.startsWith('file://') || ehNossoServidor(url);
}

ipcMain.on('app:notificar', (evento, payload = {}) => {
  if (!veioDaNossaPagina(evento)) return;
  if (!Notification.isSupported()) return;

  const aviso = new Notification({
    title: String(payload.titulo ?? 'Discord Caseiro').slice(0, 120),
    body: String(payload.corpo ?? '').slice(0, 400),
    silent: false,
  });
  // Clicar na notificacao leva pro app, que e o que a pessoa espera.
  aviso.on('click', mostrarJanelaPrincipal);
  aviso.show();
});

// Uma vigia so, compartilhada - a interface pode assinar e cancelar varias
// vezes (recarregar a pagina faz isso) sem acumular timer.
let pararVigiaDeJogo = null;

ipcMain.on('app:vigiar-jogo', (evento) => {
  if (!veioDaNossaPagina(evento)) return;
  if (pararVigiaDeJogo) return;
  pararVigiaDeJogo = jogos.vigiar((nome) => {
    if (!janela || janela.isDestroyed()) return;
    janela.webContents.send('app:jogo', nome);
  });
});

ipcMain.on('app:parar-vigia-jogo', () => {
  pararVigiaDeJogo?.();
  pararVigiaDeJogo = null;
});

ipcMain.handle('config:ler', () => ({
  serverUrl: servidorAtual ?? '',
  travadoPeloDev: Boolean(DEV_URL),
}));

ipcMain.handle('config:definir', async (_evento, bruto) => {
  const endereco = config.normalizarEndereco(bruto);
  if (!endereco) return { erro: 'endereço inválido' };

  if (!(await servidorRespondendo(endereco))) {
    return { erro: `não achei um servidor em ${endereco}` };
  }

  config.salvar({ serverUrl: endereco });

  // O reinício é de propósito: a flag que libera microfone e tela numa origem
  // http só entra em vigor na inicialização do Chromium.
  if (config.precisaLiberarOrigemInsegura(endereco) && endereco !== servidorAtual) {
    app.relaunch();
    app.exit(0);
    return { ok: true, reiniciando: true };
  }

  servidorAtual = endereco;
  janela?.loadURL(endereco);
  return { ok: true };
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', mostrarJanelaPrincipal);

  app.whenReady().then(async () => {
    instalarCabecalhoDeTunel(session.defaultSession);
    instalarPermissoes(session.defaultSession, ehNossoServidor);
    instalarCapturaDeTela(session.defaultSession, () => janela);
    montarMenu();
    montarBandeja();
    mostrarSplash();

    // O app já serve tudo com nome de arquivo com hash (index-XYZ.js) e o
    // index.html com no-cache, mas mesmo assim o cache em disco do Electron
    // (diferente de uma aba de navegador comum, ele sobrevive a fechar e
    // abrir o app de novo) às vezes insiste numa cópia velha. Começar cada
    // abertura sem cache nenhum é a forma mais simples de garantir que
    // "fechei e abri" realmente pega a versão nova.
    await session.defaultSession.clearCache();
    criarJanela();

    // Só instalado (via NSIS) o auto-update funciona de verdade - em dev
    // não existe app-update.yml e checkForUpdates só geraria ruído no log.
    if (app.isPackaged) require('./atualizador.js').iniciar();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) criarJanela();
    });
  });

  // Rede de segurança: qualquer caminho de saída que eu não tenha previsto
  // (Cmd+Q no mac, encerrar pelo gerenciador de tarefas, etc.) ainda conta
  // como "saindo de verdade", pra não travar o app tentando só esconder.
  app.on('before-quit', () => { saindoDeVerdade = true; });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  process.on('uncaughtException', (erro) => {
    dialog.showErrorBox('Discord Caseiro', String(erro?.stack ?? erro));
  });
}
