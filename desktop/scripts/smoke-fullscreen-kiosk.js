/**
 * Prova de ponta a ponta do player exclusivo do cinema.
 *
 * O teste abre o Orbit, aciona a mesma ponte usada pelo botao do player e
 * confere tanto o estado nativo do Electron quanto os pixels do monitor.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  app, BrowserWindow, desktopCapturer, screen,
} = require('electron');

const BASE = process.env.SMOKE_BASE ?? 'http://192.168.0.63:3001';
const PLAYER = process.env.SMOKE_PLAYER ?? 'https://superflixapi.beer/filme/120';
const SAIDA = path.join(__dirname, '..', 'dist');

process.env.DISCORD_CASEIRO_DEV_URL = BASE;
app.setPath('userData', path.join(os.tmpdir(), `discord-caseiro-fullscreen-${process.pid}`));

require('../src/main.js');

const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function ate(rotulo, teste, limite = 20000) {
  const inicio = Date.now();
  while (Date.now() - inicio < limite) {
    const resultado = await teste();
    if (resultado) return resultado;
    await esperar(100);
  }
  throw new Error(`${rotulo} nao aconteceu em ${limite}ms`);
}

function exigir(condicao, mensagem, detalhe = '') {
  if (!condicao) throw new Error(`${mensagem}${detalhe ? `: ${detalhe}` : ''}`);
  console.log(`ok  ${mensagem}`);
}

async function capturarMonitor(display) {
  const fontes = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: {
      width: display.size.width,
      height: display.size.height,
    },
  });
  const fonte = fontes.find((item) => item.display_id === String(display.id)) ?? fontes[0];
  exigir(Boolean(fonte), 'o Electron encontrou o monitor para a captura');
  fs.mkdirSync(SAIDA, { recursive: true });
  fs.writeFileSync(path.join(SAIDA, 'fullscreen-kiosk-screen.png'), fonte.thumbnail.toPNG());
}

async function principal() {
  const principalWindow = await ate('janela principal', () => (
    BrowserWindow.getAllWindows().find((item) => item.webContents.getURL().startsWith(BASE))
  ));
  await ate('ponte do Orbit', () => principalWindow.webContents.executeJavaScript(
    "typeof window.appDesktop?.abrirPlayerTelaCheia === 'function'",
  ));

  const abriu = await principalWindow.webContents.executeJavaScript(
    `window.appDesktop.abrirPlayerTelaCheia(${JSON.stringify(PLAYER)})`,
  );
  exigir(abriu === true, 'a ponte abriu o player exclusivo');

  const playerWindow = await ate('janela kiosk', () => BrowserWindow.getAllWindows().find(
    (item) => item !== principalWindow
      && item.webContents.getURL().includes('/cinema-fullscreen?'),
  ));
  await ate('janela kiosk visivel', () => playerWindow.isVisible());
  await esperar(2500);

  const display = screen.getDisplayMatching(playerWindow.getBounds());
  const bounds = playerWindow.getBounds();
  exigir(playerWindow.isKiosk(), 'a janela esta em modo kiosk');
  exigir(playerWindow.isFullScreen(), 'a janela esta em fullscreen nativo');
  exigir(bounds.x === display.bounds.x && bounds.y === display.bounds.y,
    'a janela comeca no primeiro pixel do monitor', JSON.stringify({ bounds, display: display.bounds }));
  exigir(bounds.width === display.bounds.width && bounds.height === display.bounds.height,
    'a janela ocupa exatamente todo o monitor', JSON.stringify({ bounds, display: display.bounds }));
  exigir(principalWindow.isVisible() === false, 'o Orbit fica oculto enquanto o video esta aberto');

  const pagina = await playerWindow.webContents.executeJavaScript(`({
    iframe: document.querySelector('iframe')?.src ?? '',
    largura: document.querySelector('iframe')?.getBoundingClientRect().width ?? 0,
    altura: document.querySelector('iframe')?.getBoundingClientRect().height ?? 0,
    janelaLargura: innerWidth,
    janelaAltura: innerHeight,
  })`);
  exigir(pagina.iframe === PLAYER, 'o player permitido continua incorporado no shell', pagina.iframe);
  exigir(pagina.largura === pagina.janelaLargura && pagina.altura === pagina.janelaAltura,
    'o iframe preenche todos os pixels da janela', JSON.stringify(pagina));

  fs.mkdirSync(SAIDA, { recursive: true });
  fs.writeFileSync(
    path.join(SAIDA, 'fullscreen-kiosk-window.png'),
    (await playerWindow.webContents.capturePage()).toPNG(),
  );
  // O executavel de desenvolvimento pode disparar o primeiro aviso do
  // Firewall do Windows. Para a captura provar a moldura real do kiosk, o
  // player fica acima desse aviso apenas durante este teste.
  playerWindow.setAlwaysOnTop(true, 'screen-saver');
  playerWindow.focus();
  await esperar(500);
  await capturarMonitor(display);
  playerWindow.setAlwaysOnTop(false);

  playerWindow.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'ESC' });
  await ate('fechamento por Esc', () => playerWindow.isDestroyed());
  await ate('retorno ao Orbit', () => principalWindow.isVisible());
  exigir(principalWindow.isVisible(), 'Esc fecha o player e devolve o Orbit');

  console.log(JSON.stringify({
    base: BASE,
    player: PLAYER,
    bounds,
    display: display.bounds,
    capturas: [
      path.join(SAIDA, 'fullscreen-kiosk-window.png'),
      path.join(SAIDA, 'fullscreen-kiosk-screen.png'),
    ],
  }, null, 2));
  app.quit();
}

const vigia = setTimeout(() => {
  console.error('FALHOU: o teste geral passou de 45 segundos');
  app.exit(1);
}, 45000);

app.whenReady().then(() => principal().then(() => {
  clearTimeout(vigia);
}).catch((erro) => {
  clearTimeout(vigia);
  console.error(`FALHOU: ${erro.stack ?? erro}`);
  app.exit(1);
}));
