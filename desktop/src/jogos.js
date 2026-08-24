const { exec } = require('node:child_process');

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

/** O primeiro conhecido que estiver rodando, ou null. */
async function detectar() {
  const rodando = await listarProcessos();
  for (const nome of rodando) {
    const bonito = CONHECIDOS.get(nome);
    if (bonito) return bonito;
  }
  return null;
}

/**
 * Vigia em segundo plano e chama `aoMudar(nomeOuNull)` só quando o resultado
 * muda - a interface não precisa saber que a checagem roda o tempo todo.
 */
function vigiar(aoMudar) {
  let ultimo;
  let timer = null;
  let parado = false;

  const rodar = async () => {
    const atual = await detectar();
    if (parado) return;
    if (atual !== ultimo) {
      ultimo = atual;
      aoMudar(atual);
    }
  };

  rodar();
  timer = setInterval(rodar, INTERVALO_MS);

  return () => {
    parado = true;
    if (timer) clearInterval(timer);
  };
}

module.exports = { vigiar, detectar, CONHECIDOS };
