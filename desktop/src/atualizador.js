const path = require('node:path');
const { BrowserWindow, ipcMain, screen } = require('electron');
const { autoUpdater } = require('electron-updater');

const ESPERA_INICIAL_MS = 15_000;
const INTERVALO_MS = 30 * 60 * 1000;
const REAVISO_MS = 20 * 60 * 1000;

autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = false;
// Atualizacao vem do GitHub Releases (ver "publish" em package.json), nao
// mais do nosso tunel - o instalador e grande (~90MB) e baixar ele pelo
// tunel caseiro toda hora e o que estourava a banda gratis do ngrok.

let infoBaixada = null;
let janelaAviso = null;
let timeoutReaviso = null;

const paginaLocal = (nome) => path.join(__dirname, nome);

/**
 * Não é fullscreen/kiosk de verdade (isso tomaria a tela toda do Windows,
 * inclusive fora do app). É uma janela do tamanho da área útil da tela,
 * sempre por cima - cobre a visão como se fosse tela cheia, mas sem
 * atrapalhar quem estiver numa chamada: a janela principal continua rodando
 * por trás, áudio e tudo, até a pessoa decidir reiniciar.
 */
function mostrarAviso() {
  if (!infoBaixada || janelaAviso) return;

  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  janelaAviso = new BrowserWindow({
    width,
    height,
    x: 0,
    y: 0,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    backgroundColor: '#16171b',
    webPreferences: {
      preload: paginaLocal('preload-atualizacao.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  janelaAviso.on('closed', () => { janelaAviso = null; });
  janelaAviso.loadFile(paginaLocal('atualizacao.html'));
}

function agendarReaviso() {
  clearTimeout(timeoutReaviso);
  timeoutReaviso = setTimeout(mostrarAviso, REAVISO_MS);
}

function iniciar() {
  autoUpdater.on('update-downloaded', (info) => {
    infoBaixada = info;
    mostrarAviso();
  });

  autoUpdater.on('error', (erro) => {
    console.error('[atualizacao]', erro);
  });

  const checar = () => autoUpdater.checkForUpdates().catch((erro) => {
    console.error('[atualizacao] falha ao checar', erro);
  });

  setTimeout(checar, ESPERA_INICIAL_MS);
  setInterval(checar, INTERVALO_MS);
}

ipcMain.handle('atualizacao:info', () => (infoBaixada ? { version: infoBaixada.version } : null));

ipcMain.handle('atualizacao:reiniciar', () => {
  // silent=true: instala sem abrir nenhuma janela de instalador (nem a
  // barrinha de progresso do NSIS). forceRunAfter=true: reabre o app sozinho
  // depois - a pessoa só vê a tela cheia de aviso e, alguns segundos depois,
  // o app de volta já na versão nova.
  autoUpdater.quitAndInstall(true, true);
});

ipcMain.handle('atualizacao:adiar', () => {
  janelaAviso?.close();
  agendarReaviso();
});

module.exports = { iniciar };
