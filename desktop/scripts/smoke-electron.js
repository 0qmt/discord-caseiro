/**
 * Teste do app de desktop, rodado pelo proprio Electron:
 *
 *   npm run smoke
 *
 * A janela sobe oculta de proposito - o teste nao rouba o foco da maquina.
 * Precisa do backend rodando em http://localhost:3001.
 */
const path = require('node:path');
const { app, BrowserWindow, desktopCapturer, session } = require('electron');
const endereco = require('../src/endereco.js');
const { instalarPermissoes, instalarCapturaDeTela } = require('../src/sessao.js');

const BASE = process.env.SMOKE_BASE ?? 'http://localhost:3001';
const RAIZ = path.join(__dirname, '..', 'src');

/*
 * Endereco da rede local (ex.: http://192.168.0.2:3001) para provar a parte
 * mais importante do app: num navegador comum esse endereco NAO e contexto
 * seguro e o microfone fica bloqueado. Aqui aplicamos a mesma flag do main.js,
 * antes do app ficar pronto, e conferimos que passa a ser seguro.
 */
const LAN = process.env.SMOKE_LAN_URL ?? null;
if (LAN && endereco.precisaLiberarOrigemInsegura(LAN)) {
  app.commandLine.appendSwitch('unsafely-treat-insecure-origin-as-secure', LAN);
  app.commandLine.appendSwitch('disable-features', 'BlockInsecurePrivateNetworkRequests');
}

let passou = 0;
const falhas = [];

function check(rotulo, condicao, detalhe = '') {
  if (condicao) {
    passou += 1;
    console.log(`  ok   ${rotulo}`);
  } else {
    falhas.push(rotulo);
    console.log(`  FALHOU ${rotulo} ${detalhe}`);
  }
}

function testarEnderecos() {
  console.log('\nendereço do servidor');

  check('completa esquema e porta padrão',
    endereco.normalizarEndereco('192.168.0.10') === 'http://192.168.0.10:3001',
    endereco.normalizarEndereco('192.168.0.10'));
  check('respeita a porta que a pessoa digitou',
    endereco.normalizarEndereco('192.168.0.10:8080') === 'http://192.168.0.10:8080');
  check('aceita https sem inventar porta',
    endereco.normalizarEndereco('https://casa.exemplo.com') === 'https://casa.exemplo.com');
  check('joga fora caminho e query',
    endereco.normalizarEndereco('http://localhost:3001/canal/x?a=1') === 'http://localhost:3001');
  check('texto vazio não vira endereço', endereco.normalizarEndereco('   ') === null);
  check('lixo não vira endereço', endereco.normalizarEndereco('ht!tp://??') === null);

  check('localhost não precisa de liberação',
    endereco.precisaLiberarOrigemInsegura('http://localhost:3001') === false);
  check('127.0.0.1 não precisa de liberação',
    endereco.precisaLiberarOrigemInsegura('http://127.0.0.1:3001') === false);
  check('IP da rede em http PRECISA de liberação',
    endereco.precisaLiberarOrigemInsegura('http://192.168.0.10:3001') === true);
  check('https nunca precisa de liberação',
    endereco.precisaLiberarOrigemInsegura('https://casa.exemplo.com') === false);

  check('mesma origem ignora caminho',
    endereco.mesmaOrigem('http://localhost:3001/a', 'http://localhost:3001') === true);
  check('porta diferente é outra origem',
    endereco.mesmaOrigem('http://localhost:3002', 'http://localhost:3001') === false);
}

async function testarSessao() {
  console.log('\npermissões e captura de tela');

  const sessao = session.defaultSession;
  const ehNossoServidor = (url) => endereco.mesmaOrigem(url, BASE);

  const { aoPedir, aoChecar } = instalarPermissoes(sessao, ehNossoServidor);
  instalarCapturaDeTela(sessao, () => null);

  // Interroga os handlers que foram realmente instalados.
  const pedir = (permissao, url) => new Promise((resolve) => {
    aoPedir({ getURL: () => url }, permissao, resolve);
  });

  check('microfone liberado para o nosso servidor', aoChecar(null, 'media', BASE) === true);
  check('microfone negado para site de fora',
    aoChecar(null, 'media', 'https://sitequalquer.com') === false);
  check('captura de tela liberada para o nosso servidor',
    aoChecar(null, 'display-capture', BASE) === true);
  check('permissão fora da lista continua negada',
    aoChecar(null, 'geolocation', BASE) === false);

  check('pedido de microfone do nosso servidor é aceito', await pedir('media', BASE) === true);
  check('pedido de microfone de site de fora é recusado',
    await pedir('media', 'https://sitequalquer.com/x') === false);

  // Não imprimimos os nomes: são as janelas abertas da máquina.
  const fontes = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: 0, height: 0 },
  });
  check('o Electron enxerga telas pra compartilhar', fontes.length > 0, `${fontes.length}`);
}

const comLimite = (promessa, ms, rotulo) => Promise.race([
  promessa,
  new Promise((_, rejeitar) =>
    setTimeout(() => rejeitar(new Error(`${rotulo} passou de ${ms}ms`)), ms)),
]);

async function carregar(janela, carregamento) {
  await carregamento;
  // Espera o React montar de verdade, não só o HTML chegar.
  const pronto = await janela.webContents.executeJavaScript(`
    new Promise((resolve) => {
      const tenta = (n) => {
        if (document.querySelector('.auth-card, .app')) return resolve(true);
        if (n <= 0) return resolve(false);
        setTimeout(() => tenta(n - 1), 200);
      };
      tenta(40);
    })
  `);
  return pronto;
}

async function testarJanelas() {
  console.log('\njanela do app');

  const janela = new BrowserWindow({
    show: false,   // sem roubar o foco da máquina
    webPreferences: {
      preload: path.join(RAIZ, 'preload-configurar.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // 1) A tela de configuração é local e tem a ponte de IPC.
  await janela.loadFile(path.join(RAIZ, 'configurar.html'), {
    query: { erro: 'fora-do-ar', endereco: 'http://192.168.0.99:3001' },
  });
  const configuracao = await janela.webContents.executeJavaScript(`
    ({
      temPonte: typeof window.appConfig?.definir === 'function',
      aviso: document.querySelector('.aviso')?.textContent ?? null,
      campo: document.getElementById('endereco')?.value ?? null,
    })
  `);
  check('a tela de configuração expõe a ponte de IPC', configuracao.temPonte === true);
  check('avisa quando o servidor não respondeu',
    (configuracao.aviso ?? '').includes('192.168.0.99'), JSON.stringify(configuracao.aviso));
  check('já vem preenchida com o endereço tentado',
    configuracao.campo === 'http://192.168.0.99:3001', configuracao.campo);

  // 2) O cliente React carrega de verdade dentro do Electron.
  const montou = await carregar(janela, janela.loadURL(BASE));
  check('a interface do servidor sobe dentro do app', montou === true);

  const dentro = await janela.webContents.executeJavaScript(`
    ({
      titulo: document.title,
      pontePresente: typeof window.appConfig !== 'undefined',
      ponteDesktop: typeof window.appDesktop,
      desktopNotificar: typeof window.appDesktop?.notificar,
      desktopJogo: typeof window.appDesktop?.aoDetectarJogo,
      temMediaDevices: typeof navigator.mediaDevices?.getUserMedia === 'function',
      temDisplayMedia: typeof navigator.mediaDevices?.getDisplayMedia === 'function',
      contextoSeguro: window.isSecureContext,
    })
  `);
  check('o título é o do app', dentro.titulo === 'Discord Caseiro', dentro.titulo);
  // A ponte de CONFIGURAÇÃO (trocar de servidor) nunca pode chegar na página
  // vinda da rede; a ponte de APP (notificação e jogo) chega de propósito, e
  // quem confere se pode usá-la é o processo principal (ver main.js).
  check('a ponte de configuracao NAO vaza para a pagina do servidor',
    dentro.pontePresente === false);
  check('a ponte do app esta disponivel na pagina do servidor',
    dentro.ponteDesktop === 'object', dentro.ponteDesktop);
  check('a ponte do app expoe notificar', dentro.desktopNotificar === 'function');
  check('a ponte do app expoe a deteccao de jogo', dentro.desktopJogo === 'function');
  check('getUserMedia disponível na página', dentro.temMediaDevices === true);
  check('getDisplayMedia disponível na página', dentro.temDisplayMedia === true);
  check('localhost já é contexto seguro', dentro.contextoSeguro === true);

  if (LAN) {
    console.log('\nendereco da rede local');
    const montouLan = await comLimite(
      carregar(janela, janela.loadURL(LAN)), 20000, 'carregar pelo IP da rede',
    ).catch((erro) => String(erro.message));
    check('a interface tambem sobe pelo IP da rede', montouLan === true, String(montouLan));
    if (montouLan !== true) return janela.destroy();

    const naLan = await janela.webContents.executeJavaScript(`
      ({
        contextoSeguro: window.isSecureContext,
        temMediaDevices: typeof navigator.mediaDevices?.getUserMedia === 'function',
        temDisplayMedia: typeof navigator.mediaDevices?.getDisplayMedia === 'function',
      })
    `);
    check('IP da rede vira contexto seguro dentro do app', naLan.contextoSeguro === true,
      JSON.stringify(naLan));
    check('microfone disponivel pelo IP da rede', naLan.temMediaDevices === true);
    check('compartilhar tela disponivel pelo IP da rede', naLan.temDisplayMedia === true);
  }

  janela.destroy();
}

async function principal() {
  console.log(`\nTestando o app de desktop contra ${BASE}`);

  testarEnderecos();
  await testarSessao();
  await testarJanelas();

  const total = passou + falhas.length;
  console.log(`\n${passou}/${total} verificacoes passaram`);
  if (falhas.length) {
    console.log(`falhas: ${falhas.join(', ')}`);
    app.exit(1);
    return;
  }
  console.log('tudo certo\n');
  app.exit(0);
}

app.whenReady().then(() => {
  principal().catch((erro) => {
    console.error('\nsmoke do desktop quebrou:', erro);
    app.exit(1);
  });
});
