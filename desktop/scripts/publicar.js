/**
 * Depois de `npm run exe` (que gera o instalador + latest.yml em dist/), este
 * script separa os arquivos que o mundo externo precisa em data/updates/:
 * - os 3 arquivos que o electron-updater lê pra saber se tem versão nova
 *   (latest.yml, o .exe e o .blockmap, com o nome exato que o electron-builder
 *   deu a eles - o electron-updater é chato com isso);
 * - uma cópia extra do .exe com nome fixo (discord-caseiro-setup-latest.exe),
 *   só pra pagina de download poder linkar sem saber o número da versão;
 * - um version.json pequeno, pra pagina de download mostrar a versão sem
 *   precisar entender o formato yaml do latest.yml.
 *
 * Isso só prepara os arquivos localmente. Publicar de verdade pros amigos
 * ainda precisa copiar data/updates/ pro servidor de produção (hoje, o
 * celular) - esse passo não está automatizado aqui de propósito, porque
 * cada deploy até agora foi feito manualmente, sob supervisão.
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
    console.error(`[publicar] faltou "${nome}" em ${DIST}. Rode "npm run exe" antes.`);
    process.exit(1);
  }
}

fs.mkdirSync(DESTINO, { recursive: true });

for (const nome of [nsisExe, nsisBlockmap, latestYml]) {
  fs.copyFileSync(path.join(DIST, nome), path.join(DESTINO, nome));
}

const nomeEstavel = 'discord-caseiro-setup-latest.exe';
fs.copyFileSync(path.join(DIST, nsisExe), path.join(DESTINO, nomeEstavel));

const tamanhoBytes = fs.statSync(path.join(DIST, nsisExe)).size;
const tamanhoMb = (tamanhoBytes / (1024 * 1024)).toFixed(0);

fs.writeFileSync(
  path.join(DESTINO, 'version.json'),
  JSON.stringify({
    version: versao,
    size: `~${tamanhoMb} MB`,
    releaseDate: new Date().toISOString(),
  }, null, 2),
);

console.log(`[publicar] pronto em ${DESTINO}:`);
console.log(`  - ${nsisExe}`);
console.log(`  - ${nsisBlockmap}`);
console.log(`  - ${latestYml}`);
console.log(`  - ${nomeEstavel} (cópia pra pagina de download)`);
console.log(`  - version.json (versão ${versao}, ${tamanhoMb} MB)`);
console.log('[publicar] falta só sincronizar essa pasta com o servidor de produção.');
