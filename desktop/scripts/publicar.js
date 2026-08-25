/**
 * Depois de `npm run dist` (que gera o instalador + latest.yml em dist/), este
 * script separa em data/updates/ os arquivos que o GitHub Release precisa:
 * - os 3 que o electron-updater lê pra saber se tem versão nova (latest.yml,
 *   o .exe e o .blockmap);
 * - uma cópia extra do .exe com nome fixo (discord-caseiro-setup-latest.exe),
 *   só pra pagina de download poder linkar sem saber o número da versão -
 *   o link usa o atalho .../releases/latest/download/<nome fixo>.
 *
 * ---------------------------------------------------------------------------
 * O NOME DO ARQUIVO PRECISA SER EXATAMENTE O QUE ESTÁ NO latest.yml
 * ---------------------------------------------------------------------------
 *
 * O electron-builder gera o .exe com ESPAÇOS ("Discord Caseiro Setup X.exe")
 * mas escreve no latest.yml a versão com HÍFENS. E o GitHub, ao receber um
 * asset com espaços no nome, troca cada espaço por PONTO.
 *
 * Resultado do descuido: o app baixava o latest.yml, via que precisa de
 * "Discord-Caseiro-Setup-X.exe", pedia esse arquivo pro GitHub, e tomava 404
 * - porque lá o arquivo tinha virado "Discord.Caseiro.Setup.X.exe". A
 * atualização automática ficou quebrada assim nas versões 0.2.6 e 0.2.7
 * (esta última, corrigida na mão depois de publicada).
 *
 * Por isso a cópia daqui já sai renomeada pro nome com hífens, e a checagem
 * no fim confere que o nome bate com o que o latest.yml pede.
 */
const fs = require('node:fs');
const path = require('node:path');
const pkg = require('../package.json');

const DIST = path.join(__dirname, '..', 'dist');
const DESTINO = path.join(__dirname, '..', '..', 'data', 'updates');

const versao = pkg.version;
/** Como o electron-builder gera (com espaços). */
const geradoExe = `Discord Caseiro Setup ${versao}.exe`;
const geradoBlockmap = `${geradoExe}.blockmap`;
/** Como precisa chegar no GitHub (com hífens, igual ao latest.yml). */
const publicadoExe = `Discord-Caseiro-Setup-${versao}.exe`;
const publicadoBlockmap = `${publicadoExe}.blockmap`;
const latestYml = 'latest.yml';

for (const nome of [geradoExe, geradoBlockmap, latestYml]) {
  if (!fs.existsSync(path.join(DIST, nome))) {
    console.error(`[publicar] faltou "${nome}" em ${DIST}. Rode "npm run dist" antes.`);
    process.exit(1);
  }
}

fs.mkdirSync(DESTINO, { recursive: true });

fs.copyFileSync(path.join(DIST, geradoExe), path.join(DESTINO, publicadoExe));
fs.copyFileSync(path.join(DIST, geradoBlockmap), path.join(DESTINO, publicadoBlockmap));
fs.copyFileSync(path.join(DIST, latestYml), path.join(DESTINO, latestYml));

const nomeEstavel = 'discord-caseiro-setup-latest.exe';
fs.copyFileSync(path.join(DIST, geradoExe), path.join(DESTINO, nomeEstavel));

/*
 * A trava: lê do latest.yml o nome que o app VAI pedir e confere que é
 * exatamente o arquivo que estamos publicando. Um desencontro aqui significa
 * atualização automática quebrada pra todo mundo - melhor falhar agora, na
 * publicação, do que descobrir semanas depois porque ninguém atualizou.
 */
const yml = fs.readFileSync(path.join(DESTINO, latestYml), 'utf8');
const pedido = yml.match(/^path:\s*(.+)$/m)?.[1]?.trim();

if (pedido !== publicadoExe) {
  console.error('[publicar] ERRO: o latest.yml pede um arquivo com outro nome.');
  console.error(`  latest.yml pede: ${pedido}`);
  console.error(`  vamos publicar:  ${publicadoExe}`);
  console.error('  Publicar assim deixa a atualizacao automatica quebrada (404).');
  process.exit(1);
}

const tamanhoMb = (fs.statSync(path.join(DIST, geradoExe)).size / (1024 * 1024)).toFixed(0);

console.log(`[publicar] pronto em ${DESTINO}:`);
console.log(`  - ${publicadoExe}`);
console.log(`  - ${publicadoBlockmap}`);
console.log(`  - ${latestYml}  (confere: pede "${pedido}")`);
console.log(`  - ${nomeEstavel} (~${tamanhoMb} MB, cópia pra pagina de download)`);
console.log('[publicar] falta so publicar:');
console.log(`  gh release create v${versao} --title "v${versao}" --notes "..." \\`);
console.log(`    "data/updates/${publicadoExe}" \\`);
console.log(`    "data/updates/${publicadoBlockmap}" \\`);
console.log(`    "data/updates/${latestYml}" \\`);
console.log(`    "data/updates/${nomeEstavel}"`);
