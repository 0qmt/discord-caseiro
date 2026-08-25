/**
 * Depois de `npm run dist` (que gera o instalador + latest.yml em dist/), este
 * script separa em data/updates/ os arquivos que o GitHub Release precisa:
 * - os 3 que o electron-updater lê pra saber se tem versão nova (latest.yml,
 *   o .exe e o .blockmap, com o nome exato que o electron-builder deu a eles
 *   - o electron-updater é chato com isso);
 * - uma cópia extra do .exe com nome fixo (discord-caseiro-setup-latest.exe),
 *   só pra pagina de download poder linkar sem saber o número da versão -
 *   o link usa o atalho .../releases/latest/download/<nome fixo>.
 *
 * Isso só prepara os arquivos localmente. Publicar de verdade ainda precisa
 * de `gh release create vX.Y.Z <arquivos>` (ou `gh release upload` numa
 * release que já existe) - não automatizado aqui de propósito, porque cada
 * publicação até agora foi feita manualmente, sob supervisão.
 */
const fs = require('node:fs');
const path = require('node:path');
const pkg = require('../package.json');

const DIST = path.join(__dirname, '..', 'dist');
const DESTINO = path.join(__dirname, '..', '..', 'data', 'updates');

const versao = pkg.version;
const nsisExe = `Discord Caseiro Setup ${versao}.exe`;
const nsisBlockmap = `${nsisExe}.blockmap`;
const latestYml = 'latest.yml';

for (const nome of [nsisExe, nsisBlockmap, latestYml]) {
  if (!fs.existsSync(path.join(DIST, nome))) {
    console.error(`[publicar] faltou "${nome}" em ${DIST}. Rode "npm run dist" antes.`);
    process.exit(1);
  }
}

fs.mkdirSync(DESTINO, { recursive: true });

for (const nome of [nsisExe, nsisBlockmap, latestYml]) {
  fs.copyFileSync(path.join(DIST, nome), path.join(DESTINO, nome));
}

const nomeEstavel = 'discord-caseiro-setup-latest.exe';
fs.copyFileSync(path.join(DIST, nsisExe), path.join(DESTINO, nomeEstavel));

const tamanhoMb = (fs.statSync(path.join(DIST, nsisExe)).size / (1024 * 1024)).toFixed(0);

console.log(`[publicar] pronto em ${DESTINO}:`);
console.log(`  - ${nsisExe}`);
console.log(`  - ${nsisBlockmap}`);
console.log(`  - ${latestYml}`);
console.log(`  - ${nomeEstavel} (~${tamanhoMb} MB, cópia pra pagina de download)`);
console.log(`[publicar] falta so publicar: gh release create v${versao} "data/updates/${nsisExe}" "data/updates/${nsisBlockmap}" data/updates/${latestYml} data/updates/${nomeEstavel}`);
