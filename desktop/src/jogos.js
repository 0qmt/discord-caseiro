const { exec } = require('node:child_process');
const { capaDaSteam } = require('./capas.js');
const { lerMusica } = require('./musica.js');

/**
 * Detecção de "o que a pessoa está jogando", no estilo do Discord.
 *
 * A ideia é a mesma que eles usam: uma lista de executáveis conhecidos, e o
 * que estiver rodando vira a atividade. Não é heurística mágica - reconhecer
 * um jogo qualquer pelo processo daria falso positivo direto (todo
 * "launcher.exe" da vida viraria jogo).
 *
 * Só lê nome de processo. Nunca linha de comando, título de janela nem nada
 * que possa carregar caminho de arquivo ou dado pessoal junto.
 */

const INTERVALO_MS = 15_000;

/** executável (minúsculo, sem .exe) -> nome bonito que aparece pros amigos. */
const CONHECIDOS = new Map(Object.entries({
  // Jogos
  fortniteclient_win64_shipping: 'Fortnite',
  fortnitelauncher: 'Fortnite',
  valorant_win64_shipping: 'VALORANT',
  valorant: 'VALORANT',
  csgo: 'Counter-Strike',
  cs2: 'Counter-Strike 2',
  dota2: 'Dota 2',
  leagueoflegends: 'League of Legends',
  league_of_legends: 'League of Legends',
  gta5: 'GTA V',
  gtav: 'GTA V',
  rdr2: 'Red Dead Redemption 2',
  javaw: 'Minecraft',
  minecraft: 'Minecraft',
  minecraftlauncher: 'Minecraft',
  eldenring: 'Elden Ring',
  stardewvalley: 'Stardew Valley',
  terraria: 'Terraria',
  rocketleague: 'Rocket League',
  amongus: 'Among Us',
  phasmophobia: 'Phasmophobia',
  overwatch: 'Overwatch 2',
  apex_client: 'Apex Legends',
  r5apex: 'Apex Legends',
  palworld: 'Palworld',
  helldivers2: 'Helldivers 2',
  factorio: 'Factorio',
  hollow_knight: 'Hollow Knight',
  celeste: 'Celeste',
  hades: 'Hades',
  'the forest': 'The Forest',
  rust: 'Rust',
  roblox: 'Roblox',
  robloxplayerbeta: 'Roblox',
  fifa23: 'FIFA 23',
  fc24: 'EA FC 24',
  fc25: 'EA FC 25',
  pes: 'eFootball',
  forzahorizon5: 'Forza Horizon 5',
  witcher3: 'The Witcher 3',
  cyberpunk2077: 'Cyberpunk 2077',
  baldursgate3: "Baldur's Gate 3",
  bg3: "Baldur's Gate 3",
  deadbydaylight: 'Dead by Daylight',
  'dbd-win64-shipping': 'Dead by Daylight',
  warframe: 'Warframe',
  'destiny2': 'Destiny 2',
  'starfield': 'Starfield',
  'lethal company': 'Lethal Company',
  'lethalcompany': 'Lethal Company',
  'content warning': 'Content Warning',
  'repo': 'R.E.P.O.',

  // Programas que também fazem sentido mostrar
  code: 'Visual Studio Code',
  devenv: 'Visual Studio',
  idea64: 'IntelliJ IDEA',
  photoshop: 'Photoshop',
  illustrator: 'Illustrator',
  afterfx: 'After Effects',
  'adobe premiere pro': 'Premiere Pro',
  blender: 'Blender',
  obs64: 'OBS Studio',
  unity: 'Unity',
  unrealeditor: 'Unreal Engine',
  aseprite: 'Aseprite',
  figma: 'Figma',
}));

/**
 * Lista os processos rodando. Usa `tasklist` (existe em todo Windows) em vez
 * de PowerShell porque é bem mais rápido pra rodar a cada 15 segundos.
 */
function listarProcessos() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve([]);
    exec('tasklist /fo csv /nh', { windowsHide: true, timeout: 8000 }, (erro, saida) => {
      if (erro || !saida) return resolve([]);
      const nomes = [];
      for (const linha of saida.split('\n')) {
        // Formato: "nome.exe","1234","Console","1","12.345 K"
        const m = linha.match(/^"([^"]+)"/);
        if (m) nomes.push(m[1].replace(/\.exe$/i, '').toLowerCase());
      }
      resolve(nomes);
    });
  });
}

/**
 * Caminho do executável de um processo pelo nome.
 *
 * É o único lugar que lê caminho de arquivo, e serve só pra pegar o ÍCONE do
 * jogo (ver `iconeDoExecutavel` no main.js). O caminho nunca sai da máquina:
 * o que vai pro servidor é a imagem já convertida, e só dela.
 */
function caminhoDoProcesso(nomeExe) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve(null);
    const seguro = String(nomeExe).replace(/[^a-z0-9_-]/gi, '');
    if (!seguro) return resolve(null);
    /*
     * `Get-Process -Name X | Select Path` PARECE funcionar, mas o `.Path`
     * depende de enumerar os MÓDULOS do processo - e isso falha em silêncio
     * (erro não-terminante, `-ErrorAction SilentlyContinue` não pega) pra
     * vários processos legítimos, o caso mais comum sendo um jogo de 32
     * bits sendo consultado por um PowerShell de 64 bits. Quando falha, a
     * gente simplesmente não descobre o caminho e cai no ícone genérico -
     * foi exatamente o que aconteceu com o Roblox (Fortnite, 64 bits, nunca
     * teve esse problema).
     *
     * `Win32_Process.ExecutablePath` via CIM vem da informação de criação do
     * processo, sem precisar enumerar módulo nenhum - não tem esse
     * problema de arquitetura.
     */
    exec(
      `powershell -NoProfile -NonInteractive -Command "(Get-CimInstance Win32_Process -Filter \\"Name='${seguro}.exe'\\" -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty ExecutablePath)"`,
      { windowsHide: true, timeout: 6000 },
      (erro, saida) => resolve(erro ? null : (String(saida).trim() || null)),
    );
  });
}

/**
 * O primeiro conhecido que estiver rodando, ou null.
 *
 * Devolve o nome bonito E o executável que bateu - o executável é o que
 * permite ir buscar o ícone depois.
 */
async function detectar() {
  const rodando = await listarProcessos();
  for (const nome of rodando) {
    const bonito = CONHECIDOS.get(nome);
    if (bonito) return { nome: bonito, exe: nome };
  }
  return null;
}

/**
 * Vigia jogo E música em segundo plano, e chama `aoMudar(atividade|null)` só
 * quando o resultado muda de verdade.
 *
 * Jogo ganha do que está tocando: se a pessoa está jogando com música ao
 * fundo, o que interessa mostrar é o jogo - a música vira o "de fundo" no
 * sentido literal.
 *
 * `desde` é o pulo do gato do "há quanto tempo": marcado uma vez, quando a
 * atividade COMEÇA, e preservado nas checagens seguintes. Se fosse recalculado
 * a cada volta, o contador reiniciaria a cada 15 segundos e nunca passaria
 * disso.
 */
function vigiar(aoMudar, { buscarIcone } = {}) {
  let ultima = null;
  let timer = null;
  let parado = false;

  /** Duas atividades são "a mesma" quando o que aparece na tela é igual. */
  const mesmaCoisa = (a, b) => a?.tipo === b?.tipo
    && a?.nome === b?.nome
    && a?.detalhe === b?.detalhe;

  const rodar = async () => {
    const jogo = await detectar();
    let atual = null;

    if (jogo) {
      atual = { tipo: 'jogo', nome: jogo.nome, detalhe: null, exe: jogo.exe };
    } else {
      const musica = await lerMusica();
      if (musica) {
        atual = {
          tipo: 'musica',
          nome: musica.titulo,
          detalhe: musica.artista,
          app: musica.app,
        };
      }
    }

    if (parado) return;
    if (mesmaCoisa(atual, ultima)) return;

    if (atual) {
      atual.desde = Date.now();
      /*
       * Capa só pra jogo, e só uma vez por atividade - buscar a cada ciclo
       * seria caro à toa, já que a arte do mesmo jogo não muda.
       *
       * Arte oficial da Steam primeiro (bonita, grande, reconhecível); o
       * ícone do executável entra quando o jogo não está na Steam - é o caso
       * de Roblox, Fortnite, Minecraft e League, onde o ícone do .exe é
       * justamente o logo oficial.
       */
      if (atual.tipo === 'jogo') {
        atual.imagem = await capaDaSteam(atual.nome);
        if (parado) return;
        if (!atual.imagem && buscarIcone) {
          const caminho = await caminhoDoProcesso(atual.exe);
          if (parado) return;
          atual.imagem = caminho ? await buscarIcone(caminho) : null;
        }
      }
      delete atual.exe;
    }

    ultima = atual;
    aoMudar(atual);
  };

  rodar();
  timer = setInterval(rodar, INTERVALO_MS);

  return () => {
    parado = true;
    if (timer) clearInterval(timer);
  };
}

module.exports = { vigiar, detectar, CONHECIDOS };
