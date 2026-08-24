const path = require('node:path');
const { BrowserWindow, desktopCapturer, ipcMain } = require('electron');

const PERMISSOES_LIBERADAS = new Set([
  'media', 'display-capture', 'audioCapture', 'videoCapture', 'notifications',
]);

/**
 * Sem isto o Electron nega getUserMedia (e a notificação de menção/DM) em
 * silêncio, sem erro nenhum pra avisar. Só liberamos para a origem do
 * servidor configurado.
 */
function instalarPermissoes(sessao, ehNossoServidor) {
  const aoPedir = (webContents, permissao, callback) => {
    callback(PERMISSOES_LIBERADAS.has(permissao) && ehNossoServidor(webContents.getURL()));
  };

  const aoChecar = (_webContents, permissao, origem) =>
    PERMISSOES_LIBERADAS.has(permissao) && ehNossoServidor(origem);

  sessao.setPermissionRequestHandler(aoPedir);
  sessao.setPermissionCheckHandler(aoChecar);

  // Devolvidos para o teste poder interrogar os handlers de verdade, em vez de
  // repetir a regra por fora.
  return { aoPedir, aoChecar };
}

/** Janelinha com miniaturas das telas e janelas abertas. */
function abrirSeletor(fontes, janelaPai) {
  return new Promise((resolve) => {
    const seletor = new BrowserWindow({
      width: 760,
      height: 560,
      parent: janelaPai ?? undefined,
      modal: Boolean(janelaPai),
      resizable: false,
      minimizable: false,
      maximizable: false,
      title: 'Escolha o que compartilhar',
      backgroundColor: '#1d1f24',
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, 'preload-seletor.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    let respondido = false;
    const responder = (fonte) => {
      if (respondido) return;
      respondido = true;
      ipcMain.removeHandler('seletor:escolher');
      ipcMain.removeHandler('seletor:listar');
      resolve(fonte);
      if (!seletor.isDestroyed()) seletor.close();
    };

    ipcMain.handle('seletor:listar', () => fontes.map((f) => ({
      id: f.id,
      name: f.name,
      thumbnail: f.thumbnail.toDataURL(),
      tipo: f.id.startsWith('screen:') ? 'tela' : 'janela',
    })));

    ipcMain.handle('seletor:escolher', (_evento, id) =>
      responder(fontes.find((f) => f.id === id) ?? null));

    // Fechar no X conta como cancelar.
    seletor.on('closed', () => responder(null));

    seletor.loadFile(path.join(__dirname, 'seletor.html'));
  });
}

/**
 * No Electron, getDisplayMedia() não abre seletor nenhum sozinho: sem este
 * handler a chamada simplesmente falha.
 */
function instalarCapturaDeTela(sessao, obterJanela) {
  sessao.setDisplayMediaRequestHandler(async (_pedido, callback) => {
    let fontes;
    try {
      fontes = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        thumbnailSize: { width: 320, height: 180 },
        fetchWindowIcons: false,
      });
    } catch {
      callback();
      return;
    }

    const escolhido = await abrirSeletor(fontes, obterJanela?.());
    // Sem argumento = a pessoa cancelou.
    if (!escolhido) callback();
    else callback({ video: escolhido });
  }, { useSystemPicker: false });
}

module.exports = { instalarPermissoes, instalarCapturaDeTela, PERMISSOES_LIBERADAS };
