const path = require('node:path');
const { BrowserWindow, ipcMain, screen } = require('electron');
const { autoUpdater } = require('electron-updater');

const ESPERA_INICIAL_MS = 15_000;
const INTERVALO_MS = 30 * 60 * 1000;
const REAVISO_MS = 20 * 60 * 1000;

autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;
// Atualizacao vem do GitHub Releases (ver "publish" em package.json), nao
// mais do nosso tunel - o instalador e grande (~90MB) e baixar ele pelo
// tunel caseiro toda hora e o que estourava a banda gratis do ngrok.

let infoBaixada = null;
let janelaAviso = null;
let timeoutReaviso = null;
let emCallAgora = false;
let jaMandouReiniciar = false;

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

/*
 * Reiniciar SEM perguntar nada, pro caso "já está numa call e tem
 * atualização esperando": a pessoa não vê tela de aviso nenhuma, o app
 * simplesmente reinicia sozinho na hora - a reconexão na mesma call depois
 * é o próprio client (React) que cuida, guardando em que canal estava antes
 * de qualquer restart (ver lib/retomarCall.js no client).
 */
function reiniciarNaHora() {
  if (jaMandouReiniciar) return;
  jaMandouReiniciar = true;
  clearTimeout(timeoutReaviso);
  janelaAviso?.close();
  autoUpdater.quitAndInstall(true, true);
}

function iniciar(veioDaNossaPagina) {
  autoUpdater.on('update-downloaded', (info) => {
    infoBaixada = info;
    if (emCallAgora) reiniciarNaHora();
    else mostrarAviso();
  });

  autoUpdater.on('error', (erro) => {
    console.error('[atualizacao]', erro);
  });

  const checar = () => autoUpdater.checkForUpdates().catch((erro) => {
    console.error('[atualizacao] falha ao checar', erro);
  });

  setTimeout(checar, ESPERA_INICIAL_MS);
  setInterval(checar, INTERVALO_MS);

  /*
   * O client manda isso toda vez que entra/sai de uma call (ver
   * useVoice.js). Se já tinha atualização baixada esperando (a pessoa
   * tinha adiado, ou o download só terminou depois que ela entrou na
   * call) e ela ACABOU de entrar numa call agora, dispara o reinício na
   * hora - não faz sentido esperar ela sair da call pra só então
   * perguntar.
   */
  ipcMain.on('app:em-call', (evento, { emCall } = {}) => {
    if (!veioDaNossaPagina(evento)) return;
    const entrouAgora = emCall && !emCallAgora;
    emCallAgora = Boolean(emCall);
    if (entrouAgora && infoBaixada) reiniciarNaHora();
  });
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
