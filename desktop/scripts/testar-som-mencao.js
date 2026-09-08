const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow } = require('electron');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const som = pathToFileURL(path.join(__dirname, '..', 'src', 'som-mencao.mp3')).toString();

app.whenReady().then(async () => {
  const janela = new BrowserWindow({
    width: 240,
    height: 120,
    show: false,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  await janela.loadFile(path.join(__dirname, '..', 'src', 'audio.html'));
  const resultado = await janela.webContents.executeJavaScript(`
    (async () => {
      try {
        const audio = new Audio(${JSON.stringify(som)});
        audio.volume = 1;
        audio.preload = 'auto';
        await audio.play();
        await new Promise((resolve) => setTimeout(resolve, 1200));
        return { ok: true, currentTime: audio.currentTime, paused: audio.paused };
      } catch (erro) {
        return { ok: false, name: erro?.name, message: erro?.message };
      }
    })();
  `);

  console.log(JSON.stringify(resultado));
  app.exit(resultado.ok ? 0 : 1);
}).catch((erro) => {
  console.error(erro);
  app.exit(1);
});
