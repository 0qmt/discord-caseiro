const path = require('node:path');
const fs = require('node:fs/promises');
const { pathToFileURL } = require('node:url');
const {
  app, BrowserWindow, Menu, Notification, Tray, nativeImage, clipboard, ipcMain, session, shell, dialog,
  screen,
} = require('electron');
const fetchAdblock = require('cross-fetch');
const { ElectronBlocker } = require('@ghostery/adblocker-electron');
const config = require('./config.js');
const jogos = require('./jogos.js');
const { instalarPermissoes, instalarCapturaDeTela } = require('./sessao.js');

const DEV_URL = process.env.DISCORD_CASEIRO_DEV_URL ?? null;
const NOME_DO_APP = 'discordia';
const ehPortable = Boolean(process.env.PORTABLE_EXECUTABLE_FILE || process.env.PORTABLE_EXECUTABLE_DIR);
const MARCADOR_AVISO_PORTABLE = 'portable-update-notice-v1';

// Sem isso o Windows não sabe de qual "app" é a notificação e simplesmente
// não mostra nada, em silêncio - sem erro nenhum no console pra avisar.
app.setAppUserModelId('com.discordcaseiro.app');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// O Electron registra o executável instalado no Login do Windows. Mantemos a
// janela visível ao entrar na conta, como o usuário espera de um cliente de
// comunicação, e nunca criamos essa entrada durante o desenvolvimento.
if (process.platform === 'win32' && app.isPackaged) {
  app.setLoginItemSettings({ openAtLogin: true, openAsHidden: false });
}

let janela = null;
let janelaAudio = null;
let janelaPlayer = null;
let splash = null;
let bandeja = null;
let saindoDeVerdade = false;
let encerrandoParaAtualizacao = false;
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
const SOM_DE_MENCAO = pathToFileURL(paginaLocal('som-mencao.mp3')).toString();
const SOM_DE_CHAMADA = pathToFileURL(paginaLocal('som-chamada.mp3')).toString();

async function janelaLocalDeAudio() {
  if (janelaAudio && !janelaAudio.isDestroyed()) return janelaAudio;

  janelaAudio = new BrowserWindow({
    width: 1,
    height: 1,
    show: false,
    skipTaskbar: true,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  janelaAudio.on('closed', () => { janelaAudio = null; });
  await janelaAudio.loadFile(paginaLocal('audio.html'));
  return janelaAudio;
}

async function tocarSomDeMencao(loop = false, url = SOM_DE_MENCAO) {
  const codigo = `
    (() => {
      const url = ${JSON.stringify(url)};
      const chave = '__discordiaSomDeMencao';
      let audio = window[chave];
      if (!audio || audio.src !== url) {
        audio = new Audio(url);
        audio.preload = 'auto';
        audio.volume = 1;
        window[chave] = audio;
      }
      audio.loop = ${loop ? 'true' : 'false'};
      audio.currentTime = 0;
      const tocando = audio.play();
      if (tocando && typeof tocando.catch === 'function') tocando.catch(() => {});
    })();
  `;

  const player = await janelaLocalDeAudio();
  if (player.isDestroyed()) return;
  player.webContents.executeJavaScript(codigo, true).catch((erro) => {
    console.warn('[notificacao] nao foi possivel tocar o som de mencao', erro);
  });
}

function emitirEstadoDeTelaCheia(ativa) {
  if (!janela || janela.isDestroyed()) return;
  janela.webContents.send('app:tela-cheia', Boolean(ativa));
}

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

const HOSTS_PERMITIDOS_NO_PLAYER = new Set([
  'superflixapi.beer',
  'www.superflixapi.beer',
]);

const PADROES_DE_ANUNCIO = [
  /(^|\.)doubleclick\.net$/i,
  /(^|\.)googlesyndication\.com$/i,
  /(^|\.)googleadservices\.com$/i,
  /(^|\.)adservice\.google\./i,
  /(^|\.)adnxs\.com$/i,
  /(^|\.)adsystem\.com$/i,
  /(^|\.)exoclick\.com$/i,
  /(^|\.)popads\.net$/i,
  /(^|\.)popcash\.net$/i,
  /(^|\.)propellerads\.com$/i,
  /(^|\.)propeller-tracking\.com$/i,
  /(^|\.)onclickads\.net$/i,
  /(^|\.)hilltopads\.net$/i,
  /(^|\.)juicyads\.com$/i,
  /(^|\.)adsterra\.com$/i,
  /(^|\.)adsterratools\.com$/i,
  /(^|\.)monetag\.com$/i,
  /(^|\.)trafficjunky\.net$/i,
  /(^|\.)popunder/i,
  /(^|\.)pushads/i,
];

const TRECHOS_DE_ANUNCIO = [
  '/ads/',
  '/adserver',
  '/advert',
  '/banner',
  '/popunder',
  '/popup',
  '/prebid',
  '/vast',
  '/vpaid',
  'doubleclick',
  'googlesyndication',
  'googleadservices',
  'onclick',
  'popads',
  'propeller',
  'adsterra',
  'monetag',
];

// Estas regras permanecem mesmo quando a lista externa esta disponivel. Elas
// cobrem anuncios que o proprio player hospeda no seu dominio, caso que listas
// genericas nao conseguem identificar sem conhecer o site em questao.
const FILTROS_LOCAIS_DE_ANUNCIO = [
  '||doubleclick.net^',
  '||googlesyndication.com^',
  '||googleadservices.com^',
  '||adservice.google^',
  '||adnxs.com^',
  '||adsystem.com^',
  '||exoclick.com^',
  '||popads.net^',
  '||popcash.net^',
  '||propellerads.com^',
  '||propeller-tracking.com^',
  '||onclickads.net^',
  '||hilltopads.net^',
  '||juicyads.com^',
  '||adsterra.com^',
  '||adsterratools.com^',
  '||monetag.com^',
  '||trafficjunky.net^',
  '||superflixapi.beer/ads^',
  '||superflixapi.beer/adserver^',
  '||superflixapi.beer/advert^',
  '||superflixapi.beer/banner^',
  '||superflixapi.beer/popunder^',
  '||superflixapi.beer/popup^',
  '||superflixapi.beer/prebid^',
  '||superflixapi.beer/vast^',
  '||superflixapi.beer/vpaid^',
];

const SETE_DIAS = 7 * 24 * 60 * 60 * 1000;
const bloqueadoresPorSessao = new WeakMap();

function deveBloquearPedido(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return true;
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) return false;
  if (ehNossoServidor(url)) return false;

  const host = parsed.hostname.toLowerCase();
  const caminho = `${parsed.pathname}${parsed.search}`.toLowerCase();
  // O player e permitido, mas isso nao pode liberar cegamente anuncios
  // hospedados no mesmo dominio, como /ads/... ou /advert/....
  if (PADROES_DE_ANUNCIO.some((padrao) => padrao.test(host))) return true;
  return TRECHOS_DE_ANUNCIO.some((trecho) => caminho.includes(trecho) || host.includes(trecho));
}

function instalarFallbackDeAnuncios(sessao) {
  sessao.webRequest.onBeforeRequest((detalhes, callback) => {
    callback({ cancel: deveBloquearPedido(detalhes.url) });
  });
}

async function lerCacheDoBloqueador(caminho) {
  try {
    const [dados, estatisticas] = await Promise.all([fs.readFile(caminho), fs.stat(caminho)]);
    return { dados, recente: Date.now() - estatisticas.mtimeMs < SETE_DIAS };
  } catch {
    return null;
  }
}

async function criarMotorDeBloqueio() {
  const caminhoCache = path.join(app.getPath('userData'), 'adblocker-ads.bin');
  const cache = await lerCacheDoBloqueador(caminhoCache);
  let bloqueador;

  if (cache?.recente) {
    try {
      bloqueador = ElectronBlocker.deserialize(cache.dados);
      console.info('[adblock] lista de anuncios carregada do cache local');
    } catch (erro) {
      // Nao confiamos num cache que nao passa na verificacao interna do motor.
      console.warn('[adblock] cache local invalido; baixando lista nova', erro?.message ?? erro);
    }
  }

  if (!bloqueador) {
    try {
      // Sem passar o cache aqui: a biblioteca prefere qualquer cache existente
      // e nao faria o refresh semanal. Gravamos a lista somente apos ela estar
      // completamente montada e validada em memoria.
      bloqueador = await ElectronBlocker.fromPrebuiltAdsOnly(fetchAdblock);
      await fs.writeFile(caminhoCache, bloqueador.serialize());
      console.info('[adblock] lista de anuncios atualizada');
    } catch (erro) {
      // Uma lista armazenada anteriormente continua sendo melhor do que ficar
      // sem protecao quando a rede estiver indisponivel no momento da abertura.
      if (!cache?.dados) throw erro;
      try {
        bloqueador = ElectronBlocker.deserialize(cache.dados);
        console.warn('[adblock] atualizacao da lista falhou; usando cache local', erro?.message ?? erro);
      } catch {
        throw erro;
      }
    }
  }

  bloqueador.updateFromDiff({ added: FILTROS_LOCAIS_DE_ANUNCIO });
  return bloqueador;
}

function instalarBloqueadorDeAnuncios(sessao) {
  const existente = bloqueadoresPorSessao.get(sessao);
  if (existente) return existente.pronto;

  // A primeira barreira e sincrona: nenhuma requisicao de anuncio fica sem
  // filtro enquanto as listas maiores sao carregadas ou atualizadas.
  instalarFallbackDeAnuncios(sessao);

  const estado = { pronto: null, bloqueador: null };
  estado.pronto = criarMotorDeBloqueio()
    .then((bloqueador) => {
      // O Electron so aceita um listener para onBeforeRequest. Trocar o
      // fallback pelo motor completo e atomico no mesmo ciclo do processo.
      const bloquearPelaLista = bloqueador.onBeforeRequest.bind(bloqueador);
      bloqueador.onBeforeRequest = (detalhes, callback) => {
        if (deveBloquearPedido(detalhes.url)) {
          callback({ cancel: true });
          return;
        }
        bloquearPelaLista(detalhes, callback);
      };
      sessao.webRequest.onBeforeRequest(null);
      bloqueador.enableBlockingInSession(sessao);
      estado.bloqueador = bloqueador;
      console.info('[adblock] motor de filtros amplo ativo');
      return bloqueador;
    })
    .catch((erro) => {
      // O fallback manual continua registrado e protege o player mesmo offline.
      console.warn('[adblock] motor de filtros indisponivel; fallback local mantido', erro?.stack ?? erro);
      return null;
    });
  bloqueadoresPorSessao.set(sessao, estado);
  return estado.pronto;
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
    const endereco = new URL(servidorAtual);
    endereco.searchParams.set('_app_boot', String(Date.now()));
    return janela.loadURL(endereco.toString());
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
    title: NOME_DO_APP,
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
    mostrarAvisoPortableUmaVez();
  });

  janela.on('enter-full-screen', () => emitirEstadoDeTelaCheia(true));
  janela.on('leave-full-screen', () => emitirEstadoDeTelaCheia(false));
  janela.webContents.on('page-title-updated', (evento) => {
    evento.preventDefault();
    janela.setTitle(NOME_DO_APP);
  });

  // Fechar no X so minimiza pra bandeja - continua recebendo chamada e
  // mensagem por trás. So sai de verdade pelo menu/bandeja "Sair".
  janela.on('close', (evento) => {
    if (saindoDeVerdade || encerrandoParaAtualizacao) return;
    evento.preventDefault();
    janela.hide();
  });

  // Popups de players externos tentam abrir navegador/abas invisiveis; no app,
  // janelas novas ficam bloqueadas e a navegacao principal continua protegida.
  janela.webContents.setWindowOpenHandler(({ url }) => {
    if (ehNossoServidor(url)) return { action: 'allow' };
    return { action: 'deny' };
  });

  janela.webContents.on('will-navigate', (evento, url) => {
    if (!ehNossoServidor(url) && !url.startsWith('file://')) {
      evento.preventDefault();
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
  bandeja.setToolTip(NOME_DO_APP);
  bandeja.setContextMenu(Menu.buildFromTemplate([
    { label: `Abrir ${NOME_DO_APP}`, click: mostrarJanelaPrincipal },
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
  if (payload.tocarSom) tocarSomDeMencao();
  if (!Notification.isSupported()) return;

  const aviso = new Notification({
    title: String(payload.titulo ?? NOME_DO_APP).slice(0, 120),
    body: String(payload.corpo ?? '').slice(0, 400),
    silent: Boolean(payload.silenciosa),
  });
  // Clicar na notificacao leva pro app, que e o que a pessoa espera.
  aviso.on('click', mostrarJanelaPrincipal);
  aviso.show();
});

ipcMain.on('app:tocar-som-mencao', (evento) => {
  if (!veioDaNossaPagina(evento)) return;
  tocarSomDeMencao();
});

ipcMain.on('app:iniciar-som-chamada', (evento) => {
  if (!veioDaNossaPagina(evento)) return;
  tocarSomDeMencao(true, SOM_DE_CHAMADA);
});

ipcMain.on('app:parar-som-chamada', (evento) => {
  if (!veioDaNossaPagina(evento)) return;
  janelaAudio?.webContents.executeJavaScript("window.__discordiaSomDeMencao?.pause(); window.__discordiaSomDeMencao.currentTime = 0;").catch(() => {});
});

ipcMain.handle('app:copiar-imagem', (evento, dados) => {
  if (!veioDaNossaPagina(evento)) return false;
  try {
    const bytes = Buffer.from(dados);
    // Evita que uma pagina comprometida use a ponte para esgotar memoria do
    // processo principal; fotos comuns ficam muito abaixo deste limite.
    if (!bytes.length || bytes.length > 30 * 1024 * 1024) return false;
    const imagem = nativeImage.createFromBuffer(bytes);
    if (imagem.isEmpty()) return false;
    clipboard.writeImage(imagem);
    return true;
  } catch {
    return false;
  }
});

ipcMain.handle('app:tela-cheia', (evento, ativa) => {
  if (!veioDaNossaPagina(evento) || !janela || janela.isDestroyed()) return false;
  janela.setFullScreen(Boolean(ativa));
  return janela.isFullScreen();
});

ipcMain.handle('app:versao', (evento) => {
  if (!veioDaNossaPagina(evento)) return null;
  return app.getVersion();
});

ipcMain.handle('app:instalacao', (evento) => {
  if (!veioDaNossaPagina(evento)) return null;
  return { portable: ehPortable, atualizacaoAutomatica: app.isPackaged && !ehPortable };
});

ipcMain.handle('app:reiniciar', (evento) => {
  if (!veioDaNossaPagina(evento)) return false;
  saindoDeVerdade = true;
  app.relaunch();
  app.exit(0);
  return true;
});

function prepararEncerramentoParaAtualizacao() {
  encerrandoParaAtualizacao = true;
  saindoDeVerdade = true;
  janelaAudio?.close();
  janelaPlayer?.close();
  return () => {
    encerrandoParaAtualizacao = false;
    saindoDeVerdade = false;
  };
}

async function mostrarAvisoPortableUmaVez() {
  if (!ehPortable) return;
  const marcador = path.join(app.getPath('userData'), MARCADOR_AVISO_PORTABLE);
  try {
    await fs.access(marcador);
    return;
  } catch {}

  try {
    await dialog.showMessageBox(janela, {
      type: 'info',
      title: NOME_DO_APP,
      message: 'Esta e a versao portable',
      detail: 'Ela nao recebe atualizacoes automaticas. Para receber atualizacoes pelo app, instale a versao discordia-Setup.exe uma unica vez.',
      buttons: ['Entendi'],
    });
    await fs.writeFile(marcador, 'shown\n', 'utf8');
  } catch (erro) {
    console.warn('[instalacao] nao foi possivel registrar aviso portable', erro);
  }
}

ipcMain.handle('app:abrir-player-tela-cheia', async (evento, bruto) => {
  if (!veioDaNossaPagina(evento)) return false;

  let endereco;
  try {
    endereco = new URL(String(bruto));
  } catch {
    return false;
  }

  if (!['http:', 'https:'].includes(endereco.protocol)
    || !HOSTS_PERMITIDOS_NO_PLAYER.has(endereco.hostname.toLowerCase())) return false;

  if (janelaPlayer && !janelaPlayer.isDestroyed()) {
    janelaPlayer.focus();
    return true;
  }

  if (!servidorAtual) return false;
  const shell = new URL('/cinema-fullscreen', servidorAtual);
  shell.searchParams.set('src', endereco.toString());
  const monitor = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());

  const player = new BrowserWindow({
    ...monitor.bounds,
    show: false,
    frame: false,
    kiosk: true,
    fullscreen: true,
    fullscreenable: true,
    autoHideMenuBar: true,
    backgroundColor: '#000000',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  janelaPlayer = player;

  player.setMenuBarVisibility(false);
  player.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  player.webContents.on('before-input-event', (inputEvent, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape') {
      inputEvent.preventDefault();
      player.close();
    }
  });
  player.once('ready-to-show', () => {
    if (player.isDestroyed()) return;
    janela?.setFullScreen(false);
    janela?.hide();
    player.setBounds(monitor.bounds, false);
    player.setKiosk(true);
    player.setFullScreen(true);
    player.setAlwaysOnTop(true, 'screen-saver');
    player.show();
    player.focus();

    // O Windows pode recalcular a area util um instante depois e reservar um
    // pixel para a barra de tarefas. Reafirmar o estado depois da transicao
    // garante que o video continue cobrindo o monitor inteiro.
    setTimeout(() => {
      if (player.isDestroyed()) return;
      player.setBounds(monitor.bounds, false);
      player.setKiosk(true);
      player.setFullScreen(true);
      player.focus();
    }, 250);
  });
  player.on('closed', () => {
    if (janelaPlayer === player) janelaPlayer = null;
    janela?.webContents.send('app:player-fechou');
    mostrarJanelaPrincipal();
  });
  player.webContents.on('did-fail-load', (_falha, codigo, descricao, _url, principal) => {
    if (!principal || codigo === -3 || player.isDestroyed()) return;
    console.error(`[cinema] shell falhou: ${descricao} (${codigo})`);
    player.close();
  });

  try {
    await player.loadURL(shell.toString());
    return !player.isDestroyed();
  } catch (erro) {
    console.error('[cinema] nao foi possivel abrir o shell fullscreen', erro);
    if (!player.isDestroyed()) player.close();
    return false;
  }
});

// Uma vigia so, compartilhada - a interface pode assinar e cancelar varias
// vezes (recarregar a pagina faz isso) sem acumular timer.
let pararVigiaDeJogo = null;

/**
 * Ícone do executável, como data URI - é a "foto do jogo".
 *
 * Sai do próprio .exe em vez de baixar de alguma API de capas: funciona
 * offline, não precisa de chave de serviço nenhum, e é o mesmo ícone que a
 * pessoa vê na barra de tarefas. Fica pequeno (32px) de propósito: vira
 * texto base64 que trafega por WebSocket junto da presença, e capa grande
 * ali seria peso a troco de nada.
 */
async function iconeDoExecutavel(caminho) {
  try {
    // 'large' (48px) e não 'normal' (32px): o cartão do perfil desenha a capa
    // em 48px, e subir uma imagem de 32 pra 48 deixa ela borrada.
    const img = await app.getFileIcon(caminho, { size: 'large' });
    if (!img || img.isEmpty()) return null;
    return img.resize({ width: 48, height: 48 }).toDataURL();
  } catch {
    return null;
  }
}

ipcMain.on('app:vigiar-jogo', (evento) => {
  if (!veioDaNossaPagina(evento)) return;
  if (pararVigiaDeJogo) return;
  pararVigiaDeJogo = jogos.vigiar((atividade) => {
    if (!janela || janela.isDestroyed()) return;
    janela.webContents.send('app:jogo', atividade);
  }, { buscarIcone: iconeDoExecutavel });
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
    instalarBloqueadorDeAnuncios(session.defaultSession);
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

    // Só instalado (via NSIS) o auto-update funciona de verdade - em dev
    // não existe app-update.yml e checkForUpdates só geraria ruído no log.
    // Portable nao possui instalador NSIS para o ciclo quitAndInstall. Ele
    // continua utilizavel, mas o updater automatico fica explicitamente
    // desabilitado nesse target.
    if (app.isPackaged && !ehPortable) {
      await require('./atualizador.js').iniciar(
        veioDaNossaPagina,
        prepararEncerramentoParaAtualizacao,
        { antesDeAbrir: true },
      );
      // A consulta ocorreu ainda na splash. Se houver atualização, o download
      // continua em segundo plano e a janela de reinício aparece ao terminar.
    }
    criarJanela();

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
    dialog.showErrorBox(NOME_DO_APP, String(erro?.stack ?? erro));
  });
}
