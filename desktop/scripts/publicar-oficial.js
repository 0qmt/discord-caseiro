const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const asar = require('asar');
const pkg = require('../package.json');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const produto = pkg.build?.productName ?? pkg.name;
const versao = pkg.version;
const tag = `v${versao}`;
const exeGerado = `${produto} Setup ${versao}.exe`;
const exe = exeGerado.replace(/\s+/g, '-');
const blockmap = `${exe}.blockmap`;
const aliasesInstalador = [
  'discordia-setup-latest.exe',
  'discord-caseiro-setup-latest.exe',
];
const arquivosUpdate = [exe, blockmap, 'latest.yml'];
const arquivos = [...arquivosUpdate, ...aliasesInstalador];
const repo = `${pkg.build.publish.owner}/${pkg.build.publish.repo}`;

function falhar(mensagem) { console.error(`[publicar:oficial] ERRO: ${mensagem}`); process.exit(1); }
function executar(comando, args, options = {}) {
  const r = spawnSync(comando, args, { cwd: ROOT, stdio: 'inherit', shell: false, ...options });
  if (r.status !== 0) falhar(`${comando} terminou com codigo ${r.status ?? 'desconhecido'}`);
  return r;
}
function gh(args, options = {}) { return executar('gh', args, options); }

if (fs.existsSync(DIST)) fs.rmSync(DIST, { recursive: true, force: true });
const builderCli = path.join(ROOT, 'node_modules', 'electron-builder', 'cli.js');
if (!fs.existsSync(builderCli)) falhar('electron-builder local ausente');
executar(process.execPath, [builderCli, '--publish=never']);

const paths = Object.fromEntries(arquivos.map((nome) => [nome, path.join(DIST, nome)]));
fs.copyFileSync(path.join(DIST, exeGerado), paths[exe]);
fs.copyFileSync(path.join(DIST, `${exeGerado}.blockmap`), paths[blockmap]);
for (const alias of aliasesInstalador) fs.copyFileSync(path.join(DIST, exeGerado), paths[alias]);
for (const nome of arquivos) if (!fs.existsSync(paths[nome])) falhar(`artefato ausente: ${nome}`);

const latest = fs.readFileSync(paths['latest.yml'], 'utf8');
const versionYml = latest.match(/^version:\s*(.+)$/m)?.[1]?.trim();
const pathYml = latest.match(/^path:\s*(.+)$/m)?.[1]?.trim();
const shaYml = latest.match(/^sha512:\s*(.+)$/m)?.[1]?.trim();
if (versionYml !== versao) falhar(`latest.yml informa ${versionYml}, esperado ${versao}`);
if (pathYml !== exe) falhar(`latest.yml aponta para ${pathYml}, esperado ${exe}`);
const shaLocal = crypto.createHash('sha512').update(fs.readFileSync(paths[exe])).digest('base64');
if (shaLocal !== shaYml) falhar('SHA-512 local nao corresponde ao latest.yml');
const payload = path.join(DIST, 'win-unpacked', 'resources', 'app.asar');
if (!fs.existsSync(payload)) falhar('payload win-unpacked/app.asar ausente');
const payloadVersion = JSON.parse(asar.extractFile(payload, 'package.json')).version;
if (payloadVersion !== versao) falhar(`payload interno ${payloadVersion} diverge de ${versao}`);
if (fs.statSync(paths[blockmap]).size <= 0) falhar('blockmap vazio');

const existe = spawnSync('gh', ['release', 'view', tag, '--repo', repo], { cwd: ROOT, stdio: 'ignore', shell: false }).status === 0;
if (existe) falhar(`release ${tag} ja existe; nao reutilizando artefatos ou tag`);

gh(['release', 'create', tag, '--repo', repo, '--draft', '--title', tag, '--notes', `Publicacao oficial ${tag}.`, paths[exe], paths[blockmap], paths['latest.yml']]);
for (const alias of aliasesInstalador) {
  gh(['release', 'upload', tag, '--repo', repo, paths[alias]]);
}

const remoto = JSON.parse(spawnSync('gh', ['release', 'view', tag, '--repo', repo, '--json', 'isDraft,assets,tagName'], { cwd: ROOT, encoding: 'utf8', shell: false }).stdout);
if (!remoto.isDraft) falhar('release nao esta draft durante a validacao');
if (remoto.tagName !== tag) falhar(`tag remota inesperada: ${remoto.tagName}`);
const assets = new Map((remoto.assets ?? []).map((asset) => [asset.name, asset]));
for (const nome of arquivos) {
  const asset = assets.get(nome);
  if (!asset) falhar(`asset remoto ausente: ${nome}`);
  if (Number(asset.size) !== fs.statSync(paths[nome]).size) falhar(`tamanho remoto divergente: ${nome}`);
}

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'discordia-release-'));
try {
  gh(['release', 'download', tag, '--repo', repo, '--pattern', 'latest.yml', '--dir', temp]);
  const remotoLatest = fs.readFileSync(path.join(temp, 'latest.yml'), 'utf8');
  if (!remotoLatest.includes(`version: ${versao}`) || !remotoLatest.includes(`path: ${exe}`) || !remotoLatest.includes(`sha512: ${shaLocal}`)) {
    falhar('latest.yml remoto nao corresponde ao build local');
  }
  gh(['release', 'download', tag, '--repo', repo, '--pattern', exe, '--dir', temp]);
  const shaRemoto = crypto.createHash('sha512').update(fs.readFileSync(path.join(temp, exe))).digest('base64');
  if (shaRemoto !== shaLocal || shaRemoto !== shaYml) falhar('SHA-512 do instalador remoto diverge do build local');
  for (const alias of aliasesInstalador) {
    gh(['release', 'download', tag, '--repo', repo, '--pattern', alias, '--dir', temp]);
    const shaAlias = crypto.createHash('sha512').update(fs.readFileSync(path.join(temp, alias))).digest('base64');
    if (shaAlias !== shaLocal) falhar(`SHA-512 do alias remoto diverge do build local: ${alias}`);
  }
} finally { fs.rmSync(temp, { recursive: true, force: true }); }

if (process.env.PUBLICAR_OFICIAL_SIMULAR_FALHA === '1') {
  falhar('falha remota simulada antes da publicacao; a release permanece draft');
}

gh(['release', 'edit', tag, '--repo', repo, '--draft=false']);
console.log(`[publicar:oficial] ${tag} publicada apos validacao local e remota.`);
