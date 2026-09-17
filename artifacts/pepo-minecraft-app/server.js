'use strict';
/*
 * Minecraft Server Panel — app do Umbrel (tema umbrelOS).
 * Node puro, sem dependencias. Java vem da imagem base (eclipse-temurin 25).
 *
 * Dados persistentes em /data (volume do Umbrel):
 *   /data/server.jar        jar do Paper
 *   /data/panel.json        config do painel (Xms/Xmx, versao, autostart...)
 *   /data/world*, plugins/, server.properties, eula.txt ...
 */

const http = require('http');
const https = require('https');
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const url = require('url');
const zlib = require('zlib');
const crypto = require('crypto');

const DATA = process.env.MC_DATA || '/data';
const PORT = parseInt(process.env.PANEL_PORT || '8080', 10);
const APP_ROOT = __dirname;
const PUBLIC_DIR = path.join(APP_ROOT, 'public');
const CFG_PATH = path.join(DATA, 'panel.json');
const JAR_PATH = path.join(DATA, 'server.jar');
const FABRIC_JAR_PATH = path.join(DATA, 'fabric-server-launch.jar');
const PROPS_PATH = path.join(DATA, 'server.properties');
const EULA_PATH = path.join(DATA, 'eula.txt');
const PLUGINS = path.join(DATA, 'plugins');
const PLUGINS_OFF = path.join(DATA, 'plugins-disabled');
const MODS = path.join(DATA, 'mods');
const MODS_OFF = path.join(DATA, 'mods-disabled');
const BACKUPS = path.join(DATA, 'panel-backups');
const PROFILES_DIR = path.join(DATA, 'profiles');
const PROFILES_PATH = path.join(PROFILES_DIR, 'profiles.json');
const PROFILE_WORLDS = path.join(DATA, 'profile-worlds');
const PROFILE_TRASH = path.join(DATA, 'profile-trash');
const PACKAGE_LIBRARY = path.join(DATA, 'package-library');
const UA = 'pepo-umbrel-minecraft-panel/1.0 (+self-hosted)';

const LOADERS = {
  vanilla: { label: 'Vanilla', family: 'vanilla', jar: JAR_PATH, packages: 'none' },
  paper: { label: 'Paper', family: 'bukkit', jar: JAR_PATH, packages: 'plugins' },
  purpur: { label: 'Purpur', family: 'bukkit', jar: JAR_PATH, packages: 'plugins' },
  fabric: { label: 'Fabric', family: 'fabric', jar: FABRIC_JAR_PATH, packages: 'mods' },
  quilt: { label: 'Quilt', family: 'quilt', jar: path.join(DATA, 'quilt-server-launch.jar'), packages: 'mods' },
  forge: { label: 'Forge', family: 'forge', jar: path.join(DATA, 'forge-server-launch.jar'), packages: 'mods' },
  neoforge: { label: 'NeoForge', family: 'neoforge', jar: path.join(DATA, 'neoforge-server-launch.jar'), packages: 'mods' },
};

// --------------------------------------------------------------------------
// config
// --------------------------------------------------------------------------
const DEFAULT_CFG = {
  xms: '1024M',
  xmx: '1536M',
  javaFlags: [],          // flags extras (ex.: Aikar)
  autostart: false,
  mcVersion: '',          // preenchido ao instalar o server
  build: null,
  installedAt: 0,
  loader: '',
  packageConfirmations: {},
  activeProfileId: '',
  connectHostname: 'discord-caseiro.duckdns.org', // dominio dinamico da casa (aponta pro mesmo IP); limpe se nao quiser
  lanHint: 'umbrel.local',// como os amigos da mesma rede chegam
};
const GAME_PORT = 25565;  // fixo: o docker-compose publica 25565:25565
function loadCfg() {
  let c = { ...DEFAULT_CFG };
  try { if (fs.existsSync(CFG_PATH)) Object.assign(c, JSON.parse(fs.readFileSync(CFG_PATH, 'utf8'))); } catch (e) { log('cfg parse: ' + e.message); }
  return c;
}
function saveCfg() { try { fs.writeFileSync(CFG_PATH, JSON.stringify(CFG, null, 2)); } catch (e) { log('cfg save: ' + e.message); } }
let CFG = loadCfg();

function inferLoader() {
  if (fs.existsSync(FABRIC_JAR_PATH)) return 'fabric';
  if (fs.existsSync(LOADERS.quilt.jar)) return 'quilt';
  if (fs.existsSync(LOADERS.neoforge.jar)) return 'neoforge';
  if (fs.existsSync(LOADERS.forge.jar)) return 'forge';
  if (fs.existsSync(JAR_PATH)) return 'paper';
  return 'paper';
}
if (!LOADERS[CFG.loader]) { CFG.loader = inferLoader(); saveCfg(); }

function log(m) { process.stdout.write(`[${new Date().toISOString()}] ${m}\n`); }
try { fs.mkdirSync(DATA, { recursive: true }); } catch (_) {}

// --------------------------------------------------------------------------
// estado do processo
// --------------------------------------------------------------------------
const mc = {
  proc: null,
  startedAt: 0,
  stopping: false,
  buf: [],
  sse: new Set(),
  lastExit: null,
  players: [],
  maxPlayers: null,
  doneAt: 0,
  detectedLoader: null,
  loadedPackages: new Set(),
  packageErrors: [],
};
const BUF_MAX = 800;

function emit(line) {
  const e = { t: Date.now(), line: String(line).replace(/\s+$/, '') };
  mc.buf.push(e);
  if (mc.buf.length > BUF_MAX) mc.buf.splice(0, mc.buf.length - BUF_MAX);
  const p = `data: ${JSON.stringify(e)}\n\n`;
  for (const r of mc.sse) { try { r.write(p); } catch (_) {} }
  parseLine(e.line);
}
function feed(b) {
  const s = b.toString('utf8').split(/\r?\n/);
  s.forEach((l, i) => { if (i === s.length - 1 && l === '') return; emit(l); });
}
function parseLine(l) {
  let m;
  if ((m = l.match(/Done \(([\d.]+)s\)!/))) mc.doneAt = Date.now();
  if (/Fabric Loader|Loading Minecraft .* with Fabric/i.test(l)) mc.detectedLoader = 'fabric';
  else if (/Quilt Loader/i.test(l)) mc.detectedLoader = 'quilt';
  else if (/NeoForge/i.test(l)) mc.detectedLoader = 'neoforge';
  else if (/Minecraft Forge|Forge Mod Loader/i.test(l)) mc.detectedLoader = 'forge';
  else if (/This server is running Paper|Paper version/i.test(l)) mc.detectedLoader = 'paper';
  else if (/Purpur version|This server is running Purpur/i.test(l)) mc.detectedLoader = 'purpur';
  if ((m = l.match(/^\s*(?:[-+]\s+|Loading mod\s+)([a-z0-9_.-]{2,80})(?:\s|$)/i))) mc.loadedPackages.add(m[1].toLowerCase());
  if (/\b(?:failed to load|could not load|mod resolution encountered|incompatible mod set|requires version)\b/i.test(l)) {
    mc.packageErrors.push({ at: Date.now(), line: l.slice(0, 500) });
    if (mc.packageErrors.length > 30) mc.packageErrors.shift();
  }
  if ((m = l.match(/([A-Za-z0-9_]{2,16}) joined the game/))) { if (!mc.players.includes(m[1])) mc.players.push(m[1]); }
  if ((m = l.match(/([A-Za-z0-9_]{2,16}) left the game/))) { mc.players = mc.players.filter((p) => p !== m[1]); }
  if ((m = l.match(/There are (\d+) of a max of (\d+) players online:?\s*(.*)/))) {
    mc.maxPlayers = parseInt(m[2], 10);
    mc.players = (m[3] || '').split(/,\s*/).map((s) => s.trim()).filter(Boolean);
  }
}

function running() { return !!(mc.proc && mc.proc.exitCode === null && !mc.proc.killed); }
function activeLoader() { return LOADERS[CFG.loader] ? CFG.loader : inferLoader(); }
function activeLauncher() { return LOADERS[activeLoader()].jar; }
function loaderInstalled(id) {
  if (!LOADERS[id]) return false;
  if (!['vanilla', 'paper', 'purpur'].includes(id)) return fs.existsSync(LOADERS[id].jar);
  if (!fs.existsSync(JAR_PATH)) return false;
  if (id === 'paper') return activeLoader() === 'paper' || CFG.build != null;
  return activeLoader() === id;
}
function javaArgs() {
  return [
    `-Xms${CFG.xms}`, `-Xmx${CFG.xmx}`,
    ...(Array.isArray(CFG.javaFlags) ? CFG.javaFlags : []),
    '-Dcom.mojang.eula.agree=true',
    '-jar', activeLauncher(), '--nogui',
  ];
}

function startServer() {
  if (running()) return { ok: false, error: 'ja esta rodando' };
  if (!fs.existsSync(activeLauncher())) return { ok: false, error: `launcher de ${LOADERS[activeLoader()].label} nao esta instalado` };
  if (!eulaAccepted()) return { ok: false, error: 'aceite a EULA da Mojang antes de iniciar' };
  const args = javaArgs();
  log('start: java ' + args.join(' '));
  emit('>>> iniciando: java ' + args.join(' '));
  mc.players = []; mc.doneAt = 0; mc.detectedLoader = null; mc.loadedPackages.clear(); mc.packageErrors = [];
  let child;
  try { child = spawn('java', args, { cwd: DATA, stdio: ['pipe', 'pipe', 'pipe'] }); }
  catch (e) { return { ok: false, error: e.message }; }
  mc.proc = child; mc.startedAt = Date.now(); mc.stopping = false; mc.lastExit = null;
  child.stdout.on('data', feed);
  child.stderr.on('data', feed);
  child.on('error', (e) => { emit('!!! erro no processo: ' + e.message); });
  child.on('exit', (code, sig) => {
    mc.lastExit = { code, sig, at: Date.now() };
    emit(`<<< servidor parou (code ${code}${sig ? ', ' + sig : ''})`);
    mc.proc = null; mc.stopping = false; mc.players = []; mc.doneAt = 0;
  });
  return { ok: true };
}
function sendCmd(c) {
  if (!running()) return { ok: false, error: 'servidor parado' };
  try { mc.proc.stdin.write(c.replace(/\r?\n/g, '') + '\n'); emit('$ ' + c); return { ok: true }; }
  catch (e) { return { ok: false, error: e.message }; }
}
function waitExit(p, ms) {
  return new Promise((res) => {
    if (!p || p.exitCode !== null) return res(true);
    const to = setTimeout(() => res(false), ms);
    p.once('exit', () => { clearTimeout(to); res(true); });
  });
}
async function stopServer(force) {
  if (!running()) return { ok: false, error: 'servidor parado' };
  mc.stopping = true;
  if (force) { mc.proc.kill('SIGKILL'); return { ok: true, note: 'kill enviado' }; }
  emit('>>> stop...');
  try { mc.proc.stdin.write('stop\n'); } catch (_) {}
  const p = mc.proc;
  if (!(await waitExit(p, 25000))) {
    emit('>>> SIGTERM...'); p.kill('SIGTERM');
    if (!(await waitExit(p, 8000))) { emit('>>> SIGKILL...'); p.kill('SIGKILL'); }
  }
  return { ok: true };
}

// --------------------------------------------------------------------------
// EULA / properties
// --------------------------------------------------------------------------
function eulaAccepted() {
  try { return /eula\s*=\s*true/i.test(fs.readFileSync(EULA_PATH, 'utf8')); } catch (_) { return false; }
}
function setEula(v) {
  fs.writeFileSync(EULA_PATH, `# gerenciado pelo painel\neula=${v ? 'true' : 'false'}\n`);
}
function readProps() {
  const map = {};
  try {
    fs.readFileSync(PROPS_PATH, 'utf8').split(/\r?\n/).forEach((l) => {
      if (!l || l.startsWith('#')) return;
      const i = l.indexOf('='); if (i < 0) return;
      map[l.slice(0, i)] = l.slice(i + 1);
    });
  } catch (_) {}
  return map;
}
function writeProps(patch) {
  let lines = [];
  try { lines = fs.readFileSync(PROPS_PATH, 'utf8').split(/\r?\n/); } catch (_) {}
  const seen = new Set();
  const out = lines.map((l) => {
    if (!l || l.startsWith('#')) return l;
    const i = l.indexOf('='); if (i < 0) return l;
    const k = l.slice(0, i);
    if (k in patch) { seen.add(k); return `${k}=${patch[k]}`; }
    return l;
  });
  for (const k of Object.keys(patch)) if (!seen.has(k)) out.push(`${k}=${patch[k]}`);
  fs.writeFileSync(PROPS_PATH, out.filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n').replace(/\n*$/, '\n'));
}

// --------------------------------------------------------------------------
// http helpers (saida)
// --------------------------------------------------------------------------
function fetchBuf(u, opts = {}, redir = 0) {
  return new Promise((resolve, reject) => {
    if (redir > 6) return reject(new Error('muitos redirects'));
    let mod, U;
    try { U = new URL(u); mod = U.protocol === 'http:' ? http : https; } catch (e) { return reject(new Error('url invalida')); }
    const req = mod.request(U, { method: opts.method || 'GET', headers: { 'User-Agent': UA, 'Accept': '*/*', ...(opts.headers || {}) } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(fetchBuf(new URL(res.headers.location, u).toString(), opts, redir + 1));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.setTimeout(opts.timeout || 45000, () => req.destroy(new Error('timeout')));
    if (opts.body) req.write(opts.body);
    req.end();
  });
}
async function fetchJSON(u, opts) {
  const r = await fetchBuf(u, opts);
  if (r.status !== 200) throw new Error(`HTTP ${r.status} em ${u}`);
  return JSON.parse(r.body.toString('utf8'));
}
function downloadToFile(u, dest) {
  return new Promise((resolve, reject) => {
    const go = (link, redir) => {
      if (redir > 6) return reject(new Error('muitos redirects'));
      let U, mod;
      try { U = new URL(link); mod = U.protocol === 'http:' ? http : https; } catch (e) { return reject(new Error('url invalida')); }
      const req = mod.get(U, { headers: { 'User-Agent': UA } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) { res.resume(); return go(new URL(res.headers.location, link).toString(), redir + 1); }
        if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
        const tmp = dest + '.part';
        const ws = fs.createWriteStream(tmp);
        let n = 0;
        res.on('data', (c) => { n += c.length; });
        res.pipe(ws);
        ws.on('finish', () => ws.close(() => { fs.renameSync(tmp, dest); resolve({ bytes: n }); }));
        ws.on('error', reject);
      });
      req.on('error', reject);
      req.setTimeout(120000, () => req.destroy(new Error('timeout')));
    };
    go(u, 0);
  });
}
function isZip(buf) { return buf && buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b; }

// --------------------------------------------------------------------------
// Paper (fill.papermc.io v3)
// --------------------------------------------------------------------------
// --------------------------------------------------------------------------
// endereco de conexao (IP publico + LAN)
// --------------------------------------------------------------------------
let _pubIp = { v: null, at: 0 };
async function publicIp() {
  if (_pubIp.v && Date.now() - _pubIp.at < 600000) return _pubIp.v;
  for (const u of ['https://api.ipify.org', 'https://ifconfig.me/ip', 'https://icanhazip.com']) {
    try {
      const r = await fetchBuf(u, { timeout: 8000 });
      const ip = r.body.toString('utf8').trim();
      if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) { _pubIp = { v: ip, at: Date.now() }; return ip; }
    } catch (_) {}
  }
  return _pubIp.v; // stale ou null
}

async function paperVersions() {
  const j = await fetchJSON('https://fill.papermc.io/v3/projects/paper');
  // v3: { project:{...}, versions: { "1.21": ["1.21.4",...], ... } }  OU  { versions: ["1.21.4", ...] }
  let list = [];
  if (Array.isArray(j.versions)) list = j.versions.slice();
  else if (j.versions && typeof j.versions === 'object') for (const k of Object.keys(j.versions)) list = list.concat(j.versions[k]);
  // ordena por "numero" decrescente, mantendo unicos
  const uniq = [...new Set(list)];
  uniq.sort(cmpVerDesc);
  return uniq;
}
function verKey(v) {
  const parts = String(v).split(/[.\-]/);
  const nums = []; let pre = false;
  for (const p of parts) { if (/^\d+$/.test(p)) nums.push(parseInt(p, 10)); else { pre = true; break; } }
  return { nums, pre };
}
// ordena da versao mais nova pra mais antiga; releases estaveis antes de rc/pre
function cmpVerDesc(a, b) {
  const ka = verKey(a), kb = verKey(b);
  const n = Math.max(ka.nums.length, kb.nums.length);
  for (let i = 0; i < n; i++) { const d = (kb.nums[i] || 0) - (ka.nums[i] || 0); if (d) return d; }
  return (ka.pre ? 1 : 0) - (kb.pre ? 1 : 0);
}
async function paperDownloadUrl(version) {
  const j = await fetchJSON(`https://fill.papermc.io/v3/projects/paper/versions/${encodeURIComponent(version)}/builds`);
  const builds = Array.isArray(j) ? j : (j.builds || []);
  if (!builds.length) throw new Error('sem builds pra ' + version);
  const stable = builds.filter((b) => (b.channel || '').toUpperCase() === 'STABLE');
  const pick = (stable[0] || builds[0]);
  const dl = pick.downloads && (pick.downloads['server:default'] || pick.downloads['application'] || pick.downloads['server']);
  if (!dl || !dl.url) throw new Error('build sem url de download');
  return { url: dl.url, build: pick.id || pick.build || null };
}

// --------------------------------------------------------------------------
// plugins
// --------------------------------------------------------------------------
function safeJar(n) {
  const b = path.basename(String(n || '')).replace(/[^\w.\- ]+/g, '_').trim();
  return (b && /\.jar$/i.test(b)) ? b : null;
}
function listJars(enabledDir, disabledDir) {
  const out = [];
  const scan = (dir, enabled) => {
    let items = []; try { items = fs.readdirSync(dir); } catch (_) { return; }
    for (const n of items) {
      if (!/\.jar$/i.test(n)) continue;
      let st; try { st = fs.statSync(path.join(dir, n)); } catch (_) { continue; }
      out.push({ name: n, enabled, size: st.size, mtime: st.mtimeMs, ...inspectJar(path.join(dir, n), n) });
    }
  };
  scan(enabledDir, true); scan(disabledDir, false);
  out.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  return out;
}
function archiveList(file) {
  let result = spawnSync('unzip', ['-Z1', file], { encoding: 'utf8', timeout: 4000 });
  if (result.status === 0 && result.stdout) return result.stdout;
  result = spawnSync('tar', ['-tf', file], { encoding: 'utf8', timeout: 4000 });
  return result.status === 0 ? (result.stdout || '') : '';
}
function archiveRead(file, entry) {
  let result = spawnSync('unzip', ['-p', file, entry], { encoding: 'utf8', timeout: 4000 });
  if (result.status === 0 && result.stdout) return result.stdout;
  result = spawnSync('tar', ['-xOf', file, entry], { encoding: 'utf8', timeout: 4000 });
  return result.status === 0 ? (result.stdout || '') : '';
}
function inspectJar(file, filename) {
  const result = { validJar: false, metadata: null, packageId: null, compatible: null, validationLevel: 0, validationLabel: 'Nao validado' };
  try {
    const fd = fs.openSync(file, 'r'); const head = Buffer.alloc(4);
    fs.readSync(fd, head, 0, 4, 0); fs.closeSync(fd);
    result.validJar = isZip(head);
  } catch (_) { return result; }
  if (!result.validJar) return result;
  result.validationLevel = 1; result.validationLabel = 'JAR valido';
  try {
    const listing = archiveList(file);
    const candidates = [
      ['fabric.mod.json', 'fabric'], ['quilt.mod.json', 'quilt'], ['META-INF/neoforge.mods.toml', 'neoforge'],
      ['META-INF/mods.toml', 'forge'], ['paper-plugin.yml', 'paper'], ['plugin.yml', 'bukkit'],
    ];
    const found = candidates.find(([entry]) => listing.split(/\r?\n/).includes(entry));
    if (found) {
      result.metadata = found[1];
      if (found[0].endsWith('.json')) {
        const raw = archiveRead(file, found[0]);
        try {
          const j = JSON.parse(raw);
          result.packageId = String(j.id || (j.quilt_loader && j.quilt_loader.id) || '').toLowerCase() || null;
        } catch (_) {}
      }
      const loader = activeLoader();
      const expected = LOADERS[loader].family;
      result.compatible = result.metadata === expected || (expected === 'bukkit' && ['bukkit', 'paper'].includes(result.metadata));
      if (result.compatible) { result.validationLevel = 2; result.validationLabel = 'Metadados compativeis'; }
      else result.validationLabel = `Feito para ${result.metadata}; servidor usa ${loader}`;
    }
  } catch (_) {}
  const stem = filename.replace(/\.jar$/i, '').toLowerCase();
  const loaded = [result.packageId, stem, stem.split(/[-_]/)[0]].filter(Boolean).some((id) => mc.loadedPackages.has(id) || mc.buf.some((e) => e.line.toLowerCase().includes(id)));
  if (result.compatible && loaded) { result.validationLevel = 3; result.validationLabel = 'Carregado pelo loader'; }
  if (result.validationLevel >= 3 && mc.doneAt) { result.validationLevel = 4; result.validationLabel = 'Servidor e mundo iniciaram'; }
  const confirmation = CFG.packageConfirmations && CFG.packageConfirmations[filename];
  if (confirmation) { result.validationLevel = 5; result.validationLabel = 'Funcao confirmada'; result.confirmation = confirmation; }
  return result;
}
function toggleJar(name, enable, enabledDir, disabledDir) {
  const j = safeJar(name); if (!j) return { ok: false, error: 'nome invalido' };
  fs.mkdirSync(enabledDir, { recursive: true }); fs.mkdirSync(disabledDir, { recursive: true });
  const from = path.join(enable ? disabledDir : enabledDir, j);
  const to = path.join(enable ? enabledDir : disabledDir, j);
  if (!fs.existsSync(from)) return { ok: false, error: 'nao encontrado' };
  try { fs.renameSync(from, to); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; }
}
function deleteJar(name, enabledDir, disabledDir) {
  const j = safeJar(name); if (!j) return { ok: false, error: 'nome invalido' };
  let done = false;
  for (const d of [enabledDir, disabledDir]) { const p = path.join(d, j); if (fs.existsSync(p)) { fs.unlinkSync(p); done = true; } }
  return done ? { ok: true } : { ok: false, error: 'nao encontrado' };
}
function listPlugins() { return listJars(PLUGINS, PLUGINS_OFF); }
function togglePlugin(name, enable) { return toggleJar(name, enable, PLUGINS, PLUGINS_OFF); }
function deletePlugin(name) { return deleteJar(name, PLUGINS, PLUGINS_OFF); }
function listMods() { return listJars(MODS, MODS_OFF); }
function toggleMod(name, enable) { return toggleJar(name, enable, MODS, MODS_OFF); }
function deleteMod(name) { return deleteJar(name, MODS, MODS_OFF); }

// --------------------------------------------------------------------------
// perfis e biblioteca compartilhada de pacotes
// --------------------------------------------------------------------------
let PROFILE_STATE = { version: 1, activeProfileId: null, profiles: [], library: [] };
let profileSwitchState = { running: false, targetId: null, phase: null, startedAt: 0, error: null };

function atomicWriteJSON(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}
function saveProfiles() { atomicWriteJSON(PROFILES_PATH, PROFILE_STATE); }
function slugId(value) {
  const slug = String(value || 'perfil').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'perfil';
  return `${slug}-${Date.now().toString(36)}`;
}
function sha256File(file) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r'); const buf = Buffer.alloc(1024 * 1024);
  try { let n; while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) hash.update(buf.subarray(0, n)); }
  finally { fs.closeSync(fd); }
  return hash.digest('hex');
}
function libraryFile(entry) { return path.join(PACKAGE_LIBRARY, entry.kind, `${entry.sha256}-${entry.filename}`); }
function libraryEntry(key) { return PROFILE_STATE.library.find((entry) => entry.key === key) || null; }
function importPackageToLibrary(file, kind) {
  const filename = safeJar(path.basename(file)); if (!filename || !fs.existsSync(file)) return null;
  const sha256 = sha256File(file); const key = `${kind}:${sha256}`;
  let entry = libraryEntry(key);
  if (!entry) {
    const inspected = inspectJar(file, filename);
    entry = { key, kind, sha256, filename, size: fs.statSync(file).size, metadata: inspected.metadata, packageId: inspected.packageId, importedAt: Date.now() };
    PROFILE_STATE.library.push(entry);
  }
  const dest = libraryFile(entry);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (!fs.existsSync(dest)) { try { fs.linkSync(file, dest); } catch (_) { fs.copyFileSync(file, dest); } }
  return entry;
}
function importDirectoryToLibrary(dir, kind) {
  let files = []; try { files = fs.readdirSync(dir); } catch (_) {}
  return files.filter((name) => /\.jar$/i.test(name)).map((name) => importPackageToLibrary(path.join(dir, name), kind)).filter(Boolean);
}
function activeProfile() { return PROFILE_STATE.profiles.find((profile) => profile.id === PROFILE_STATE.activeProfileId) || null; }
function packageCompatible(entry, loader) {
  const info = LOADERS[loader]; if (!entry || !info) return false;
  if (entry.kind === 'mod') return info.packages === 'mods' && entry.metadata === info.family;
  return info.packages === 'plugins' && ['bukkit', 'paper'].includes(entry.metadata);
}
function snapshotActiveProfile() {
  const profile = activeProfile(); if (!profile) return;
  const enabledMods = importDirectoryToLibrary(MODS, 'mod');
  const enabledPlugins = importDirectoryToLibrary(PLUGINS, 'plugin');
  importDirectoryToLibrary(MODS_OFF, 'mod'); importDirectoryToLibrary(PLUGINS_OFF, 'plugin');
  if (!profile.packagesDirty) {
    profile.mods = enabledMods.map((entry) => entry.key);
    profile.plugins = enabledPlugins.map((entry) => entry.key);
  }
  profile.properties = readProps();
  profile.worldName = profile.properties['level-name'] || profile.worldName || 'world';
  profile.loader = activeLoader(); profile.mcVersion = CFG.mcVersion || profile.mcVersion || '';
  profile.xms = CFG.xms; profile.xmx = CFG.xmx; profile.javaFlags = Array.isArray(CFG.javaFlags) ? CFG.javaFlags.slice() : [];
  profile.updatedAt = Date.now(); saveProfiles();
}
function initializeProfiles() {
  fs.mkdirSync(PROFILES_DIR, { recursive: true }); fs.mkdirSync(PACKAGE_LIBRARY, { recursive: true });
  if (fs.existsSync(PROFILES_PATH)) {
    try { PROFILE_STATE = JSON.parse(fs.readFileSync(PROFILES_PATH, 'utf8')); } catch (e) { throw new Error(`profiles.json invalido: ${e.message}`); }
    PROFILE_STATE.profiles = Array.isArray(PROFILE_STATE.profiles) ? PROFILE_STATE.profiles : [];
    PROFILE_STATE.library = Array.isArray(PROFILE_STATE.library) ? PROFILE_STATE.library : [];
  }
  if (!PROFILE_STATE.profiles.length) {
    const properties = readProps();
    const principal = {
      id: 'principal', name: 'Principal', worldName: properties['level-name'] || 'world', loader: activeLoader(), mcVersion: CFG.mcVersion || '',
      xms: CFG.xms, xmx: CFG.xmx, javaFlags: Array.isArray(CFG.javaFlags) ? CFG.javaFlags.slice() : [], properties,
      mods: [], plugins: [], createdAt: Date.now(), updatedAt: Date.now(), lastStartedAt: null, lastResult: null,
    };
    PROFILE_STATE.activeProfileId = principal.id; PROFILE_STATE.profiles = [principal];
    principal.mods = importDirectoryToLibrary(MODS, 'mod').map((entry) => entry.key);
    principal.plugins = importDirectoryToLibrary(PLUGINS, 'plugin').map((entry) => entry.key);
    importDirectoryToLibrary(MODS_OFF, 'mod'); importDirectoryToLibrary(PLUGINS_OFF, 'plugin');
    saveProfiles();
  }
  for (const entry of PROFILE_STATE.library) {
    if (!entry.metadata && fs.existsSync(libraryFile(entry))) {
      const inspected = inspectJar(libraryFile(entry), entry.filename);
      entry.metadata = inspected.metadata; entry.packageId = inspected.packageId;
    }
  }
  if (!PROFILE_STATE.profiles.some((profile) => profile.id === PROFILE_STATE.activeProfileId)) PROFILE_STATE.activeProfileId = PROFILE_STATE.profiles[0].id;
  CFG.activeProfileId = PROFILE_STATE.activeProfileId; saveCfg(); saveProfiles();
}
function profileWorldPath(profile) {
  const full = path.resolve(DATA, String(profile.worldName || ''));
  if (!full.startsWith(path.resolve(DATA) + path.sep)) throw new Error('caminho de mundo invalido');
  return full;
}
function profilesView() {
  return PROFILE_STATE.profiles.map((profile) => ({
    id: profile.id, name: profile.name, active: profile.id === PROFILE_STATE.activeProfileId, loader: profile.loader, mcVersion: profile.mcVersion,
    worldName: profile.worldName, worldExists: isWorldDir(profileWorldPath(profile)), worldSize: fs.existsSync(profileWorldPath(profile)) ? dirSize(profileWorldPath(profile)) : 0,
    modCount: (profile.mods || []).length, pluginCount: (profile.plugins || []).length, packagesDirty: !!profile.packagesDirty, lastStartedAt: profile.lastStartedAt || null, lastResult: profile.lastResult || null,
  }));
}
function libraryView(loader) {
  return PROFILE_STATE.library.map((entry) => ({ ...entry, compatible: packageCompatible(entry, loader), present: fs.existsSync(libraryFile(entry)) }));
}
function createProfile(input) {
  const name = String(input.name || '').trim().slice(0, 48); if (!name) throw new Error('informe o nome do perfil');
  const loader = String(input.loader || activeLoader()).toLowerCase(); if (!LOADERS[loader]) throw new Error('loader invalido');
  if (!loaderInstalled(loader)) throw new Error(`${LOADERS[loader].label} ainda nao esta instalado`);
  const mcVersion = String(input.mcVersion || CFG.mcVersion || '').trim();
  if (mcVersion !== String(CFG.mcVersion || '')) throw new Error('esta versao ainda nao possui runtime instalado');
  const id = slugId(name); const source = PROFILE_STATE.profiles.find((profile) => profile.id === input.sourceProfileId) || activeProfile();
  let selected = Array.isArray(input.packageKeys) ? input.packageKeys : (input.copyPackages && source ? [...(source.mods || []), ...(source.plugins || [])] : []);
  selected = [...new Set(selected)].filter((key) => { const entry = libraryEntry(key); return entry && packageCompatible(entry, loader); });
  const properties = { ...(source && source.properties || readProps()), 'level-name': `profile-worlds/${id}` };
  const profile = {
    id, name, worldName: properties['level-name'], loader, mcVersion, xms: source?.xms || CFG.xms, xmx: source?.xmx || CFG.xmx,
    javaFlags: Array.isArray(source?.javaFlags) ? source.javaFlags.slice() : [], properties,
    mods: selected.filter((key) => libraryEntry(key)?.kind === 'mod'), plugins: selected.filter((key) => libraryEntry(key)?.kind === 'plugin'),
    createdAt: Date.now(), updatedAt: Date.now(), lastStartedAt: null, lastResult: null,
  };
  PROFILE_STATE.profiles.push(profile); saveProfiles(); return profile;
}
function setProfilePackages(profileId, keys) {
  const profile = PROFILE_STATE.profiles.find((item) => item.id === profileId); if (!profile) throw new Error('perfil nao encontrado');
  const selected = [...new Set(Array.isArray(keys) ? keys : [])].filter((key) => { const entry = libraryEntry(key); return entry && packageCompatible(entry, profile.loader); });
  profile.mods = selected.filter((key) => libraryEntry(key)?.kind === 'mod');
  profile.plugins = selected.filter((key) => libraryEntry(key)?.kind === 'plugin');
  profile.packagesDirty = true;
  profile.updatedAt = Date.now(); saveProfiles(); return profile;
}
function stageProfilePackages(profile) {
  const root = path.join(PROFILES_DIR, `.stage-${Date.now()}-${process.pid}`);
  for (const dir of ['mods', 'plugins', 'mods-disabled', 'plugins-disabled']) fs.mkdirSync(path.join(root, dir), { recursive: true });
  for (const key of [...(profile.mods || []), ...(profile.plugins || [])]) {
    const entry = libraryEntry(key); if (!entry || !packageCompatible(entry, profile.loader)) throw new Error(`pacote incompativel no perfil: ${key}`);
    const source = libraryFile(entry); if (!fs.existsSync(source)) throw new Error(`arquivo ausente na biblioteca: ${entry.filename}`);
    const dest = path.join(root, entry.kind === 'mod' ? 'mods' : 'plugins', entry.filename);
    try { fs.linkSync(source, dest); } catch (_) { fs.copyFileSync(source, dest); }
  }
  return root;
}
function writeProfileProperties(profile) {
  const props = { ...(profile.properties || {}), 'level-name': profile.worldName };
  const lines = Object.entries(props).filter(([key]) => /^[A-Za-z0-9._-]+$/.test(key)).map(([key, value]) => `${key}=${String(value).replace(/[\r\n]/g, '')}`);
  fs.writeFileSync(PROPS_PATH, `# gerenciado pelo perfil ${profile.name}\n${lines.join('\n')}\n`);
}
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitForServerReady(timeoutMs = 120000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (!running()) return { ok: false, error: mc.lastExit ? `processo encerrou com codigo ${mc.lastExit.code}` : 'processo encerrou' };
    if (mc.doneAt) return { ok: true };
    await delay(1000);
  }
  return { ok: false, error: 'tempo limite aguardando o mundo iniciar' };
}
function moveRuntimeDirectories(fromRoot, toRoot, suffix = '') {
  fs.mkdirSync(toRoot, { recursive: true });
  for (const name of ['mods', 'plugins', 'mods-disabled', 'plugins-disabled']) {
    const from = path.join(fromRoot, name); const to = path.join(toRoot, `${name}${suffix}`);
    if (fs.existsSync(from)) fs.renameSync(from, to);
  }
}
async function switchProfile(profileId) {
  if (profileSwitchState.running) throw new Error('ja existe uma troca de perfil em andamento');
  const target = PROFILE_STATE.profiles.find((profile) => profile.id === profileId); if (!target) throw new Error('perfil nao encontrado');
  if (target.id === PROFILE_STATE.activeProfileId && running() && !target.packagesDirty) return { ok: true, alreadyActive: true };
  if (!loaderInstalled(target.loader)) throw new Error(`runtime de ${target.loader} nao instalado`);
  snapshotActiveProfile();
  const previous = activeProfile(); const previousPropsText = fs.existsSync(PROPS_PATH) ? fs.readFileSync(PROPS_PATH, 'utf8') : '';
  const previousCfg = { loader: CFG.loader, mcVersion: CFG.mcVersion, xms: CFG.xms, xmx: CFG.xmx, javaFlags: CFG.javaFlags, activeProfileId: CFG.activeProfileId };
  const stage = stageProfilePackages(target); const history = path.join(PROFILES_DIR, '.runtime-history', `${Date.now()}-${previous?.id || 'none'}`);
  profileSwitchState = { running: true, targetId: target.id, phase: 'salvando', startedAt: Date.now(), error: null };
  try {
    if (running()) { sendCmd(`say Trocando para o perfil ${target.name} em 5 segundos.`); await delay(3000); await stopServer(false); }
    profileSwitchState.phase = 'montando'; moveRuntimeDirectories(DATA, history); moveRuntimeDirectories(stage, DATA);
    writeProfileProperties(target);
    CFG.loader = target.loader; CFG.mcVersion = target.mcVersion; CFG.xms = target.xms; CFG.xmx = target.xmx; CFG.javaFlags = target.javaFlags || [];
    CFG.activeProfileId = target.id; PROFILE_STATE.activeProfileId = target.id; saveCfg(); saveProfiles();
    profileSwitchState.phase = 'iniciando'; const started = startServer(); if (!started.ok) throw new Error(started.error);
    const health = await waitForServerReady(); if (!health.ok) throw new Error(health.error);
    target.lastStartedAt = Date.now(); target.lastResult = { ok: true, at: Date.now() }; target.packagesDirty = false; target.updatedAt = Date.now(); saveProfiles();
    try { fs.rmSync(stage, { recursive: true, force: true }); } catch (_) {}
    profileSwitchState = { running: false, targetId: null, phase: 'pronto', startedAt: 0, error: null };
    return { ok: true, activeProfileId: target.id };
  } catch (error) {
    profileSwitchState.phase = 'rollback'; profileSwitchState.error = error.message;
    if (running()) await stopServer(false);
    const failed = path.join(history, 'failed-target'); fs.mkdirSync(failed, { recursive: true }); moveRuntimeDirectories(DATA, failed);
    moveRuntimeDirectories(history, DATA);
    fs.writeFileSync(PROPS_PATH, previousPropsText);
    Object.assign(CFG, previousCfg); PROFILE_STATE.activeProfileId = previous?.id || previousCfg.activeProfileId; saveCfg();
    if (target) target.lastResult = { ok: false, at: Date.now(), error: error.message, rolledBack: true }; saveProfiles();
    let rollbackReady = false;
    if (previous) { const restarted = startServer(); if (restarted.ok) rollbackReady = (await waitForServerReady()).ok; }
    profileSwitchState = { running: false, targetId: null, phase: 'rollback-concluido', startedAt: 0, error: error.message };
    const wrapped = new Error(error.message); wrapped.rolledBack = true; wrapped.rollbackReady = rollbackReady; throw wrapped;
  }
}
function trashProfile(profileId) {
  const index = PROFILE_STATE.profiles.findIndex((profile) => profile.id === profileId); if (index < 0) throw new Error('perfil nao encontrado');
  const profile = PROFILE_STATE.profiles[index]; if (profile.id === PROFILE_STATE.activeProfileId) throw new Error('o perfil ativo nao pode ser excluido');
  const trash = path.join(PROFILE_TRASH, `${Date.now()}-${profile.id}`); fs.mkdirSync(trash, { recursive: true });
  const world = profileWorldPath(profile); if (fs.existsSync(world)) fs.renameSync(world, path.join(trash, path.basename(world)));
  atomicWriteJSON(path.join(trash, 'profile.json'), profile);
  PROFILE_STATE.profiles.splice(index, 1); saveProfiles(); return { id: profile.id, trash };
}

// --------------------------------------------------------------------------
// modrinth
// --------------------------------------------------------------------------
const PLUGIN_LOADERS = ['paper', 'spigot', 'bukkit', 'purpur', 'folia'];
const MOD_LOADERS = ['fabric', 'forge', 'neoforge', 'quilt'];
function loadersForKind(kind, loader) {
  if (kind === 'mod') {
    const wanted = String(loader || '').toLowerCase();
    return MOD_LOADERS.includes(wanted) ? [wanted] : MOD_LOADERS;
  }
  return PLUGIN_LOADERS;
}
async function modrinthSearch(q, gameVersion, kind = 'plugin', loader = '') {
  const loaders = loadersForKind(kind, loader);
  const facets = [loaders.map((l) => `categories:${l}`)];
  if (gameVersion) facets.push([`versions:${gameVersion}`]);
  const u = `https://api.modrinth.com/v2/search?limit=20&query=${encodeURIComponent(q || '')}&facets=${encodeURIComponent(JSON.stringify(facets))}`;
  const j = await fetchJSON(u);
  return (j.hits || []).map((h) => ({
    slug: h.slug, title: h.title, description: h.description, downloads: h.downloads,
    icon: h.icon_url, categories: h.categories, client_side: h.client_side, server_side: h.server_side,
  }));
}
async function modrinthInstall(slug, gameVersion, kind = 'plugin', loader = '') {
  const loaders = loadersForKind(kind, loader);
  const qs = `loaders=${encodeURIComponent(JSON.stringify(loaders))}` + (gameVersion ? `&game_versions=${encodeURIComponent(JSON.stringify([gameVersion]))}` : '');
  let vers = await fetchJSON(`https://api.modrinth.com/v2/project/${encodeURIComponent(slug)}/version?${qs}`);
  if (!vers.length && gameVersion) vers = await fetchJSON(`https://api.modrinth.com/v2/project/${encodeURIComponent(slug)}/version?loaders=${encodeURIComponent(JSON.stringify(loaders))}`);
  if (!vers.length) throw new Error('nenhuma versao compativel encontrada no Modrinth');
  const v = vers[0];
  const file = (v.files || []).find((f) => f.primary) || (v.files || [])[0];
  if (!file) throw new Error('versao sem arquivo');
  const name = safeJar(file.filename) || safeJar(slug + '.jar');
  const dir = kind === 'mod' ? MODS : PLUGINS;
  fs.mkdirSync(dir, { recursive: true });
  const r = await downloadToFile(file.url, path.join(dir, name));
  return { name, bytes: r.bytes, version: v.version_number, loader: loaders[0] || null };
}

// --------------------------------------------------------------------------
// worlds / mapas
// --------------------------------------------------------------------------
function isWorldDir(p) {
  try { return fs.existsSync(path.join(p, 'level.dat')); } catch (_) { return false; }
}
function listWorlds() {
  const active = readProps()['level-name'] || 'world';
  let items = []; try { items = fs.readdirSync(DATA, { withFileTypes: true }); } catch (_) {}
  const out = [];
  for (const d of items) {
    if (!d.isDirectory()) continue;
    const full = path.join(DATA, d.name);
    if (!isWorldDir(full)) continue;
    out.push({ name: d.name, active: d.name === active, size: dirSize(full), hasNether: fs.existsSync(full + '_nether'), hasEnd: fs.existsSync(full + '_the_end') });
  }
  out.sort((a, b) => (b.active - a.active) || a.name.localeCompare(b.name));
  return out;
}

function listBackups() {
  let items = []; try { items = fs.readdirSync(BACKUPS, { withFileTypes: true }); } catch (_) {}
  return items.filter((d) => d.isFile() && /\.zip$/i.test(d.name)).map((d) => {
    const st = fs.statSync(path.join(BACKUPS, d.name));
    return { name: d.name, size: st.size, createdAt: st.mtimeMs };
  }).sort((a, b) => b.createdAt - a.createdAt);
}
async function createBackup(label) {
  fs.mkdirSync(BACKUPS, { recursive: true });
  const active = String(activeProfile()?.worldName || readProps()['level-name'] || 'world');
  const activePath = path.resolve(DATA, active);
  if (!activePath.startsWith(path.resolve(DATA) + path.sep) || !isWorldDir(activePath)) throw new Error('mundo ativo nao encontrado');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safeLabel = String(label || 'manual').replace(/[^a-z0-9_-]+/gi, '-').slice(0, 40) || 'manual';
  const filename = `${stamp}-${safeLabel}-${path.basename(active)}.zip`;
  if (running()) { sendCmd('save-all flush'); sendCmd('save-off'); await new Promise((r) => setTimeout(r, 1200)); }
  try {
    const names = [active, `${active}_nether`, `${active}_the_end`, 'server.properties', 'whitelist.json', 'ops.json'].filter((n) => fs.existsSync(path.join(DATA, n)));
    const r = spawnSync('zip', ['-rq', path.join(BACKUPS, filename), ...names], { cwd: DATA, encoding: 'utf8', timeout: 180000 });
    if (r.status !== 0) throw new Error(r.stderr || 'zip falhou');
  } finally { if (running()) sendCmd('save-on'); }
  return listBackups().find((b) => b.name === filename);
}
function dirSize(p) {
  let total = 0;
  const stack = [p];
  while (stack.length) {
    const cur = stack.pop();
    let st; try { st = fs.lstatSync(cur); } catch (_) { continue; }
    if (st.isDirectory()) { let ch = []; try { ch = fs.readdirSync(cur); } catch (_) {} for (const c of ch) stack.push(path.join(cur, c)); }
    else total += st.size;
  }
  return total;
}
function safeWorldName(n) {
  const b = path.basename(String(n || '')).replace(/[^\w.\- ]+/g, '_').trim();
  return b && b !== '.' && b !== '..' ? b : null;
}
function extractZip(zipPath, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  const r = spawnSync('unzip', ['-o', '-q', zipPath, '-d', destDir], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error('unzip falhou: ' + (r.stderr || r.stdout || r.status));
}

// --------------------------------------------------------------------------
// http helpers (entrada)
// --------------------------------------------------------------------------
function body(req, limit = 512 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on('data', (c) => { n += c.length; if (n > limit) { reject(new Error('corpo grande demais')); req.destroy(); return; } chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
async function jbody(req) { const b = await body(req, 2 * 1024 * 1024); return JSON.parse(b.toString('utf8') || '{}'); }
function sendJSON(res, code, obj) {
  const s = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(s);
}
function serveStatic(p, res) {
  const requested = p === '/' ? 'index.html' : p.replace(/^\//, '');
  const full = path.resolve(PUBLIC_DIR, requested);
  if (!full.startsWith(path.resolve(PUBLIC_DIR) + path.sep) && full !== path.join(PUBLIC_DIR, 'index.html')) return false;
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return false;
  const ext = path.extname(full).toLowerCase();
  const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
  res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream', 'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600' });
  fs.createReadStream(full).pipe(res);
  return true;
}

function hostMem() {
  try {
    // dentro do container: cgroup v2
    let limit = null, usage = null;
    try { limit = parseInt(fs.readFileSync('/sys/fs/cgroup/memory.max', 'utf8'), 10); } catch (_) {}
    try { usage = parseInt(fs.readFileSync('/sys/fs/cgroup/memory.current', 'utf8'), 10); } catch (_) {}
    return {
      totalMB: Math.round(os.totalmem() / 1048576),
      freeMB: Math.round(os.freemem() / 1048576),
      cgLimitMB: (limit && limit < 1e15) ? Math.round(limit / 1048576) : null,
      cgUsageMB: usage ? Math.round(usage / 1048576) : null,
    };
  } catch (_) { return null; }
}

function status() {
  const r = running();
  const configured = activeLoader();
  return {
    installed: fs.existsSync(activeLauncher()),
    mcVersion: CFG.mcVersion || null,
    build: CFG.build || null,
    eula: eulaAccepted(),
    running: r,
    ready: r && mc.doneAt > 0,
    pid: r ? mc.proc.pid : null,
    uptimeMs: r ? Date.now() - mc.startedAt : 0,
    stopping: mc.stopping,
    lastExit: mc.lastExit,
    players: mc.players,
    maxPlayers: mc.maxPlayers,
    ram: { xms: CFG.xms, xmx: CFG.xmx, javaFlags: CFG.javaFlags },
    autostart: CFG.autostart,
    loaderConfigured: configured,
    loaderDetected: mc.detectedLoader,
    loaderMismatch: !!(mc.detectedLoader && mc.detectedLoader !== configured),
    packageErrors: mc.packageErrors.slice(-8),
    activeProfile: activeProfile() ? { id: activeProfile().id, name: activeProfile().name } : null,
    profileSwitch: profileSwitchState,
    mem: hostMem(),
    load: os.loadavg ? os.loadavg().map((x) => Math.round(x * 100) / 100) : null,
  };
}

// --------------------------------------------------------------------------
// router
// --------------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const u = url.parse(req.url, true);
  const p = u.pathname.replace(/\/+$/, '') || '/';
  try {
    if (req.method === 'GET' && !p.startsWith('/api/') && serveStatic(p, res)) return;
    if (p === '/health') { res.writeHead(200); return res.end('ok'); }
    if (!p.startsWith('/api/')) { res.writeHead(404); return res.end('not found'); }

    // ---- status / console ----
    if (p === '/api/status' && req.method === 'GET') return sendJSON(res, 200, status());
    if (p === '/api/loaders' && req.method === 'GET') return sendJSON(res, 200, {
      ok: true,
      active: activeLoader(),
      detected: mc.detectedLoader,
      loaders: Object.entries(LOADERS).map(([id, item]) => ({ id, label: item.label, family: item.family, packages: item.packages, installed: loaderInstalled(id), active: id === activeLoader(), automaticInstall: ['paper'].includes(id) })),
    });
    if (p === '/api/loaders/select' && req.method === 'POST') {
      if (running()) return sendJSON(res, 400, { ok: false, error: 'pare o servidor antes de trocar o loader' });
      const id = String((await jbody(req)).loader || '').toLowerCase();
      if (!LOADERS[id]) return sendJSON(res, 400, { ok: false, error: 'loader invalido' });
      if (!loaderInstalled(id)) return sendJSON(res, 400, { ok: false, error: `${LOADERS[id].label} ainda nao esta instalado` });
      CFG.loader = id; saveCfg();
      return sendJSON(res, 200, { ok: true, active: id });
    }
    if (p === '/api/profiles' && req.method === 'GET') return sendJSON(res, 200, {
      ok: true, activeProfileId: PROFILE_STATE.activeProfileId, profiles: profilesView(), switching: profileSwitchState,
    });
    if (p === '/api/profiles' && req.method === 'POST') {
      try { return sendJSON(res, 200, { ok: true, profile: createProfile(await jbody(req)), profiles: profilesView() }); }
      catch (e) { return sendJSON(res, 400, { ok: false, error: e.message }); }
    }
    if (p === '/api/profiles/library' && req.method === 'GET') {
      const profile = PROFILE_STATE.profiles.find((item) => item.id === String(u.query.profileId || '')) || activeProfile();
      return sendJSON(res, 200, { ok: true, profileId: profile?.id || null, selected: profile ? [...(profile.mods || []), ...(profile.plugins || [])] : [], library: libraryView(profile?.loader || activeLoader()) });
    }
    if (p === '/api/profiles/packages' && req.method === 'POST') {
      const b = await jbody(req);
      try { const profile = setProfilePackages(String(b.profileId || ''), b.packageKeys); return sendJSON(res, 200, { ok: true, profile: { id: profile.id, name: profile.name } }); }
      catch (e) { return sendJSON(res, 400, { ok: false, error: e.message }); }
    }
    if (p === '/api/profiles/switch' && req.method === 'POST') {
      const b = await jbody(req);
      try { return sendJSON(res, 200, await switchProfile(String(b.profileId || ''))); }
      catch (e) { return sendJSON(res, 400, { ok: false, error: e.message, rolledBack: !!e.rolledBack, rollbackReady: !!e.rollbackReady }); }
    }
    if (p === '/api/profiles/delete' && req.method === 'POST') {
      const b = await jbody(req);
      try { return sendJSON(res, 200, { ok: true, trashed: trashProfile(String(b.profileId || '')) }); }
      catch (e) { return sendJSON(res, 400, { ok: false, error: e.message }); }
    }

    if (p === '/api/console/stream' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write(': ok\n\n');
      for (const e of mc.buf) res.write(`data: ${JSON.stringify(e)}\n\n`);
      mc.sse.add(res);
      const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch (_) {} }, 20000);
      req.on('close', () => { clearInterval(ping); mc.sse.delete(res); });
      return;
    }
    if (p === '/api/console' && req.method === 'POST') return sendJSON(res, 200, sendCmd(String((await jbody(req)).command || '')));

    // ---- endereco pra conectar ----
    if (p === '/api/connect-info' && req.method === 'GET') {
      const ip = await publicIp();
      return sendJSON(res, 200, {
        ok: true,
        port: GAME_PORT,
        publicIp: ip || null,
        hostname: CFG.connectHostname || '',
        lanHint: CFG.lanHint || 'umbrel.local',
      });
    }

    // ---- power ----
    if (p === '/api/power/start' && req.method === 'POST') return sendJSON(res, 200, startServer());
    if (p === '/api/power/stop' && req.method === 'POST') return sendJSON(res, 200, await stopServer(false));
    if (p === '/api/power/kill' && req.method === 'POST') return sendJSON(res, 200, await stopServer(true));
    if (p === '/api/power/restart' && req.method === 'POST') {
      if (running()) await stopServer(false);
      await new Promise((r) => setTimeout(r, 1200));
      return sendJSON(res, 200, startServer());
    }

    // ---- versions / install server ----
    if (p === '/api/versions' && req.method === 'GET') {
      try { return sendJSON(res, 200, { ok: true, versions: await paperVersions() }); }
      catch (e) { return sendJSON(res, 502, { ok: false, error: e.message }); }
    }
    if (p === '/api/install-server' && req.method === 'POST') {
      if (running()) return sendJSON(res, 400, { ok: false, error: 'pare o servidor antes de trocar de versao' });
      const b = await jbody(req);
      const ver = String(b.mcVersion || '').trim();
      if (!/^[\w.\-]+$/.test(ver)) return sendJSON(res, 400, { ok: false, error: 'versao invalida' });
      try {
        const { url: dl, build } = await paperDownloadUrl(ver);
        emit(`>>> baixando Paper ${ver} (build ${build})...`);
        const r = await downloadToFile(dl, JAR_PATH);
        CFG.mcVersion = ver; CFG.build = build; CFG.installedAt = Date.now(); CFG.loader = 'paper'; saveCfg();
        emit(`>>> Paper ${ver} instalado (${(r.bytes / 1048576).toFixed(1)} MB)`);
        return sendJSON(res, 200, { ok: true, mcVersion: ver, build, bytes: r.bytes });
      } catch (e) { return sendJSON(res, 502, { ok: false, error: e.message }); }
    }

    // ---- eula ----
    if (p === '/api/eula' && req.method === 'POST') { setEula(!!(await jbody(req)).accept); return sendJSON(res, 200, { ok: true, eula: eulaAccepted() }); }

    // ---- settings (ram etc) ----
    const settingsView = () => ({ xms: CFG.xms, xmx: CFG.xmx, javaFlags: CFG.javaFlags, autostart: CFG.autostart, connectHostname: CFG.connectHostname || '', lanHint: CFG.lanHint || 'umbrel.local' });
    if (p === '/api/settings' && req.method === 'GET') return sendJSON(res, 200, { ok: true, settings: settingsView() });
    if (p === '/api/settings' && req.method === 'POST') {
      const b = await jbody(req);
      const memRe = /^\d{2,5}[MG]$/;
      if (b.xms && memRe.test(String(b.xms))) CFG.xms = String(b.xms);
      if (b.xmx && memRe.test(String(b.xmx))) CFG.xmx = String(b.xmx);
      if ('javaFlags' in b) CFG.javaFlags = Array.isArray(b.javaFlags) ? b.javaFlags : String(b.javaFlags).split(/\s+/).filter(Boolean);
      if ('autostart' in b) CFG.autostart = !!b.autostart;
      if ('connectHostname' in b) CFG.connectHostname = String(b.connectHostname || '').trim().replace(/[^\w.\-]/g, '').slice(0, 120);
      if ('lanHint' in b) CFG.lanHint = String(b.lanHint || '').trim().replace(/[^\w.\-]/g, '').slice(0, 120) || 'umbrel.local';
      saveCfg();
      return sendJSON(res, 200, { ok: true, settings: settingsView(), note: running() ? 'vale no proximo restart' : undefined });
    }

    // ---- properties ----
    if (p === '/api/properties' && req.method === 'GET') return sendJSON(res, 200, { ok: true, props: readProps() });
    if (p === '/api/properties' && req.method === 'POST') {
      const b = await jbody(req);
      if (!b || typeof b.props !== 'object') return sendJSON(res, 400, { ok: false, error: 'payload invalido' });
      const patch = {};
      for (const [k, v] of Object.entries(b.props)) if (/^[A-Za-z0-9._-]+$/.test(k)) patch[k] = String(v).replace(/[\r\n]/g, '');
      writeProps(patch);
      return sendJSON(res, 200, { ok: true, applied: Object.keys(patch), note: running() ? 'reinicie pra aplicar' : undefined });
    }

    // ---- plugins ----
    if (p === '/api/plugins' && req.method === 'GET') return sendJSON(res, 200, { ok: true, plugins: listPlugins(), activeLoader: activeLoader(), supported: LOADERS[activeLoader()].packages === 'plugins' });
    if (p === '/api/plugins/toggle' && req.method === 'POST') { const b = await jbody(req); return sendJSON(res, 200, togglePlugin(b.name, !!b.enabled)); }
    if (p === '/api/plugins/delete' && req.method === 'POST') { const b = await jbody(req); return sendJSON(res, 200, deletePlugin(b.name)); }
    if (p === '/api/plugins/install-url' && req.method === 'POST') {
      const b = await jbody(req);
      let fn = safeJar(b.filename || '');
      if (!fn) { try { fn = safeJar(path.basename(new URL(b.url).pathname)); } catch (_) {} }
      if (!fn) return sendJSON(res, 400, { ok: false, error: 'informe um nome .jar' });
      fs.mkdirSync(PLUGINS, { recursive: true });
      const dest = path.join(PLUGINS, fn);
      try {
        const r = await downloadToFile(String(b.url), dest);
        const fd = fs.openSync(dest, 'r'); const head = Buffer.alloc(4);
        fs.readSync(fd, head, 0, 4, 0); fs.closeSync(fd);
        if (!isZip(head)) { fs.unlinkSync(dest); return sendJSON(res, 400, { ok: false, error: 'o arquivo baixado nao e um .jar valido (link nao e download direto?)' }); }
        return sendJSON(res, 200, { ok: true, name: fn, bytes: r.bytes });
      } catch (e) { try { fs.unlinkSync(dest); } catch (_) {} return sendJSON(res, 400, { ok: false, error: e.message }); }
    }
    if (p === '/api/plugins/upload' && req.method === 'PUT') {
      const fn = safeJar(u.query.name || '');
      if (!fn) return sendJSON(res, 400, { ok: false, error: 'nome .jar invalido' });
      const buf = await body(req, 128 * 1024 * 1024);
      if (!isZip(buf)) return sendJSON(res, 400, { ok: false, error: 'nao parece um .jar' });
      fs.mkdirSync(PLUGINS, { recursive: true });
      fs.writeFileSync(path.join(PLUGINS, fn), buf);
      return sendJSON(res, 200, { ok: true, name: fn, bytes: buf.length });
    }

    // ---- modrinth ----
    if (p === '/api/modrinth/search' && req.method === 'GET') {
      try { return sendJSON(res, 200, { ok: true, hits: await modrinthSearch(u.query.q || '', u.query.gameVersion || CFG.mcVersion || '', u.query.kind || 'plugin', u.query.loader || '') }); }
      catch (e) { return sendJSON(res, 502, { ok: false, error: e.message }); }
    }
    if (p === '/api/modrinth/install' && req.method === 'POST') {
      const b = await jbody(req);
      if (!b.slug) return sendJSON(res, 400, { ok: false, error: 'slug faltando' });
      try { return sendJSON(res, 200, { ok: true, ...(await modrinthInstall(String(b.slug), String(b.gameVersion || CFG.mcVersion || ''), String(b.kind || 'plugin'), String(b.loader || ''))) }); }
      catch (e) { return sendJSON(res, 400, { ok: false, error: e.message }); }
    }

    // ---- mods ----
    if (p === '/api/mods' && req.method === 'GET') return sendJSON(res, 200, {
      ok: true,
      mods: listMods(),
      activeLoader: activeLoader(),
      supported: LOADERS[activeLoader()].packages === 'mods',
      note: LOADERS[activeLoader()].packages === 'mods' ? `O servidor usa ${LOADERS[activeLoader()].label} e carrega mods em /data/mods.` : `O servidor usa ${LOADERS[activeLoader()].label}; mods ficam guardados, mas nao sao carregados por este loader.`,
    });
    if (p === '/api/packages/confirm' && req.method === 'POST') {
      const b = await jbody(req); const name = safeJar(b.name || '');
      if (!name) return sendJSON(res, 400, { ok: false, error: 'pacote invalido' });
      CFG.packageConfirmations = CFG.packageConfirmations || {};
      if (b.confirmed === false) delete CFG.packageConfirmations[name];
      else CFG.packageConfirmations[name] = { at: Date.now(), note: String(b.note || 'Teste manual confirmado').slice(0, 240) };
      saveCfg(); return sendJSON(res, 200, { ok: true });
    }
    if (p === '/api/mods/toggle' && req.method === 'POST') { const b = await jbody(req); return sendJSON(res, 200, toggleMod(b.name, !!b.enabled)); }
    if (p === '/api/mods/delete' && req.method === 'POST') { const b = await jbody(req); return sendJSON(res, 200, deleteMod(b.name)); }
    if (p === '/api/mods/install-url' && req.method === 'POST') {
      const b = await jbody(req);
      let fn = safeJar(b.filename || '');
      if (!fn) { try { fn = safeJar(path.basename(new URL(b.url).pathname)); } catch (_) {} }
      if (!fn) return sendJSON(res, 400, { ok: false, error: 'informe um nome .jar' });
      fs.mkdirSync(MODS, { recursive: true });
      const dest = path.join(MODS, fn);
      try {
        const r = await downloadToFile(String(b.url), dest);
        const fd = fs.openSync(dest, 'r'); const head = Buffer.alloc(4);
        fs.readSync(fd, head, 0, 4, 0); fs.closeSync(fd);
        if (!isZip(head)) { fs.unlinkSync(dest); return sendJSON(res, 400, { ok: false, error: 'o arquivo baixado nao e um .jar valido (link nao e download direto?)' }); }
        return sendJSON(res, 200, { ok: true, name: fn, bytes: r.bytes });
      } catch (e) { try { fs.unlinkSync(dest); } catch (_) {} return sendJSON(res, 400, { ok: false, error: e.message }); }
    }
    if (p === '/api/mods/upload' && req.method === 'PUT') {
      const fn = safeJar(u.query.name || '');
      if (!fn) return sendJSON(res, 400, { ok: false, error: 'nome .jar invalido' });
      const buf = await body(req, 128 * 1024 * 1024);
      if (!isZip(buf)) return sendJSON(res, 400, { ok: false, error: 'nao parece um .jar' });
      fs.mkdirSync(MODS, { recursive: true });
      fs.writeFileSync(path.join(MODS, fn), buf);
      return sendJSON(res, 200, { ok: true, name: fn, bytes: buf.length });
    }

    // ---- worlds ----
    if (p === '/api/worlds' && req.method === 'GET') return sendJSON(res, 200, { ok: true, worlds: listWorlds(), active: readProps()['level-name'] || 'world' });
    if (p === '/api/worlds/activate' && req.method === 'POST') {
      const b = await jbody(req); const n = safeWorldName(b.name);
      if (!n || !isWorldDir(path.join(DATA, n))) return sendJSON(res, 400, { ok: false, error: 'mundo invalido' });
      writeProps({ 'level-name': n });
      return sendJSON(res, 200, { ok: true, note: running() ? 'reinicie pra carregar o mundo' : undefined });
    }
    if (p === '/api/worlds/delete' && req.method === 'POST') {
      const b = await jbody(req); const n = safeWorldName(b.name);
      if (!n) return sendJSON(res, 400, { ok: false, error: 'nome invalido' });
      if ((readProps()['level-name'] || 'world') === n && running()) return sendJSON(res, 400, { ok: false, error: 'mundo ativo e servidor rodando' });
      for (const suffix of ['', '_nether', '_the_end']) { try { fs.rmSync(path.join(DATA, n + suffix), { recursive: true, force: true }); } catch (_) {} }
      return sendJSON(res, 200, { ok: true });
    }
    if (p === '/api/worlds/upload' && req.method === 'PUT') {
      const n = safeWorldName(u.query.name || '');
      if (!n) return sendJSON(res, 400, { ok: false, error: 'nome invalido' });
      if (fs.existsSync(path.join(DATA, n))) return sendJSON(res, 400, { ok: false, error: 'ja existe um mundo com esse nome' });
      const buf = await body(req, 2 * 1024 * 1024 * 1024);
      if (!isZip(buf)) return sendJSON(res, 400, { ok: false, error: 'envie um arquivo .zip' });
      const tmpZip = path.join(DATA, `.upload-${Date.now()}.zip`);
      const tmpDir = path.join(DATA, `.extract-${Date.now()}`);
      try {
        fs.writeFileSync(tmpZip, buf);
        extractZip(tmpZip, tmpDir);
        // acha a pasta do mundo dentro do zip
        let src = tmpDir;
        if (!isWorldDir(tmpDir)) {
          const subs = fs.readdirSync(tmpDir, { withFileTypes: true }).filter((d) => d.isDirectory());
          const withLevel = subs.map((d) => path.join(tmpDir, d.name)).find(isWorldDir);
          if (!withLevel) return sendJSON(res, 400, { ok: false, error: 'nao achei level.dat no zip' });
          src = withLevel;
        }
        fs.renameSync(src, path.join(DATA, n));
        return sendJSON(res, 200, { ok: true, name: n });
      } catch (e) { return sendJSON(res, 400, { ok: false, error: e.message }); }
      finally { try { fs.rmSync(tmpZip, { force: true }); } catch (_) {} try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {} }
    }
    if (p === '/api/worlds/download' && req.method === 'GET') {
      const n = safeWorldName(u.query.name || '');
      if (!n || !isWorldDir(path.join(DATA, n))) { res.writeHead(404); return res.end('nao encontrado'); }
      res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${n}.zip"` });
      const z = spawn('zip', ['-r', '-', n], { cwd: DATA });
      z.stdout.pipe(res);
      z.stderr.on('data', () => {});
      z.on('error', () => { try { res.destroy(); } catch (_) {} });
      req.on('close', () => { try { z.kill(); } catch (_) {} });
      return;
    }

    // ---- jogadores / backups ----
    if (p === '/api/players' && req.method === 'GET') return sendJSON(res, 200, { ok: true, online: mc.players, max: mc.maxPlayers, running: running() });
    if (p === '/api/players/action' && req.method === 'POST') {
      const b = await jbody(req); const player = String(b.player || ''); const action = String(b.action || '');
      if (!/^[A-Za-z0-9_]{2,16}$/.test(player)) return sendJSON(res, 400, { ok: false, error: 'jogador invalido' });
      const commands = { kick: `kick ${player}`, op: `op ${player}`, deop: `deop ${player}`, ban: `ban ${player}`, pardon: `pardon ${player}`, whitelist: `whitelist add ${player}`, unwhitelist: `whitelist remove ${player}` };
      if (!commands[action]) return sendJSON(res, 400, { ok: false, error: 'acao invalida' });
      return sendJSON(res, 200, sendCmd(commands[action]));
    }
    if (p === '/api/backups' && req.method === 'GET') return sendJSON(res, 200, { ok: true, backups: listBackups() });
    if (p === '/api/backups' && req.method === 'POST') {
      try { return sendJSON(res, 200, { ok: true, backup: await createBackup((await jbody(req)).label) }); }
      catch (e) { return sendJSON(res, 400, { ok: false, error: e.message }); }
    }

    res.writeHead(404); res.end('not found');
  } catch (e) {
    log('erro ' + p + ': ' + (e && e.stack || e));
    try { sendJSON(res, 500, { ok: false, error: String(e && e.message || e) }); } catch (_) {}
  }
});

initializeProfiles();
server.listen(PORT, '0.0.0.0', () => {
  log(`painel ouvindo em :${PORT}  data=${DATA} loader=${activeLoader()}`);
  if (!fs.existsSync(activeLauncher())) log(`launcher de ${LOADERS[activeLoader()].label} ainda nao instalado`);
  if (CFG.autostart && fs.existsSync(activeLauncher()) && eulaAccepted()) {
    log('autostart ligado — subindo o servidor');
    const r = startServer(); if (!r.ok) log('autostart falhou: ' + r.error);
  }
});
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
async function shutdown() {
  log('encerrando painel...');
  if (running()) { log('parando o Minecraft...'); await stopServer(false); }
  process.exit(0);
}

// --------------------------------------------------------------------------
// front-end — tema umbrelOS
// --------------------------------------------------------------------------
const PAGE = /* html */ `<!doctype html><html lang="pt-br"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Minecraft Server</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  :root{
    --bg:#0b0d10; --bg2:#111418;
    --card:rgba(255,255,255,.05); --card-brd:rgba(255,255,255,.08);
    --card-hi:rgba(255,255,255,.08);
    --txt:#fff; --txt2:rgba(255,255,255,.65); --txt3:rgba(255,255,255,.4);
    --accent:#0091ff; --accent-press:#0077d6;
    --green:#3ad07f; --red:#ff5a52; --amber:#ffb020;
    --radius:22px; --radius-sm:13px;
  }
  *{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
  html,body{margin:0;padding:0}
  body{
    background:
      radial-gradient(1100px 700px at 12% -10%, rgba(0,145,255,.18), transparent 60%),
      radial-gradient(900px 600px at 100% 0%, rgba(120,80,255,.14), transparent 55%),
      var(--bg);
    color:var(--txt); font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
    font-size:14px; line-height:1.5; min-height:100vh; padding:22px 16px 60px;
  }
  .container{max-width:940px;margin:0 auto;display:flex;flex-direction:column;gap:16px}
  .topbar{display:flex;align-items:center;gap:13px;padding:2px 4px 6px}
  .logo{width:42px;height:42px;border-radius:12px;display:grid;place-items:center;font-size:22px;
    background:linear-gradient(160deg,#4a8f3c,#2f6d3a);box-shadow:0 6px 20px rgba(0,0,0,.4)}
  .topbar h1{font-size:19px;font-weight:600;margin:0;letter-spacing:-.01em}
  .topbar .sub{color:var(--txt2);font-size:12.5px}
  .statuschip{margin-left:auto;display:flex;align-items:center;gap:8px;font-size:13px;font-weight:500;
    padding:7px 13px;border-radius:999px;background:var(--card);border:1px solid var(--card-brd)}
  .sd{width:9px;height:9px;border-radius:50%;background:var(--txt3);flex:none}
  .sd.on{background:var(--green);box-shadow:0 0 10px var(--green)}
  .sd.off{background:var(--red)} .sd.wait{background:var(--amber);box-shadow:0 0 10px var(--amber)}
  .card{background:var(--card);border:1px solid var(--card-brd);border-radius:var(--radius);
    padding:18px 18px;backdrop-filter:blur(30px);-webkit-backdrop-filter:blur(30px)}
  .card h2{margin:0 0 14px;font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--txt2)}
  .card h2 .r{float:right;text-transform:none;letter-spacing:0;color:var(--txt3);font-weight:500}
  .btn{appearance:none;border:1px solid var(--card-brd);background:var(--card-hi);color:var(--txt);
    font:inherit;font-weight:500;padding:10px 18px;border-radius:999px;cursor:pointer;transition:.15s;white-space:nowrap}
  .btn:hover{background:rgba(255,255,255,.13)}
  .btn:active{transform:scale(.97)}
  .btn:disabled{opacity:.4;cursor:not-allowed}
  .btn.primary{background:var(--accent);border-color:transparent;font-weight:600}
  .btn.primary:hover{background:var(--accent-press)}
  .btn.danger{background:rgba(255,90,82,.16);border-color:rgba(255,90,82,.3);color:#ff9b95}
  .btn.danger:hover{background:rgba(255,90,82,.26)}
  .btn.sm{padding:7px 13px;font-size:12.5px}
  .row{display:flex;gap:9px;flex-wrap:wrap;align-items:center}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px}
  .stat .k{color:var(--txt3);font-size:11.5px;text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px}
  .stat .v{font-size:15px;font-weight:600}
  input[type=text],input[type=number],input:not([type]),select,textarea{
    width:100%;background:rgba(0,0,0,.28);border:1px solid var(--card-brd);color:var(--txt);
    border-radius:var(--radius-sm);padding:10px 12px;font:inherit;outline:none;transition:.15s}
  input:focus,select:focus,textarea:focus{border-color:var(--accent);background:rgba(0,0,0,.4)}
  label{display:block;font-size:12px;color:var(--txt2);margin-bottom:5px}
  .console{background:#05070a;border:1px solid var(--card-brd);border-radius:var(--radius-sm);
    height:320px;overflow:auto;padding:12px 13px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
    font-size:12px;line-height:1.5;white-space:pre-wrap;word-break:break-word}
  .console .l{display:block}
  .muted{color:var(--txt2)} .dim{color:var(--txt3)}
  table{width:100%;border-collapse:collapse}
  td,th{text-align:left;padding:9px 8px;border-bottom:1px solid rgba(255,255,255,.06);font-size:13px;vertical-align:middle}
  th{color:var(--txt3);font-weight:500;font-size:11px;text-transform:uppercase;letter-spacing:.05em}
  tr:last-child td{border-bottom:none}
  .pill{display:inline-block;padding:2px 10px;border-radius:999px;font-size:11px;font-weight:500;border:1px solid var(--card-brd)}
  .pill.on{color:var(--green);border-color:rgba(58,208,127,.4);background:rgba(58,208,127,.1)}
  .pill.off{color:var(--txt3)}
  .toggle{position:relative;width:44px;height:26px;flex:none;border-radius:999px;background:rgba(255,255,255,.14);cursor:pointer;transition:.2s;border:none}
  .toggle::after{content:"";position:absolute;top:3px;left:3px;width:20px;height:20px;border-radius:50%;background:#fff;transition:.2s}
  .toggle.on{background:var(--accent)} .toggle.on::after{transform:translateX(18px)}
  .slider-wrap{display:flex;align-items:center;gap:14px}
  input[type=range]{flex:1;accent-color:var(--accent)}
  .tag{font-size:15px;font-weight:700}
  .tabs{display:flex;gap:4px;background:rgba(0,0,0,.25);padding:4px;border-radius:999px;overflow-x:auto}
  .tabs button{flex:none;border:none;background:transparent;color:var(--txt2);font:inherit;font-weight:500;
    padding:8px 15px;border-radius:999px;cursor:pointer;transition:.15s}
  .tabs button.active{background:var(--card-hi);color:var(--txt)}
  .hidden{display:none!important}
  .toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%) translateY(20px);opacity:0;
    background:#1c2126;border:1px solid var(--card-brd);padding:11px 18px;border-radius:14px;
    transition:.25s;pointer-events:none;z-index:99;box-shadow:0 10px 40px rgba(0,0,0,.5);max-width:90vw}
  .toast.show{opacity:1;transform:translateX(-50%) translateY(0)}
  .empty{color:var(--txt3);padding:16px 4px;text-align:center;font-size:13px}
  .flex1{flex:1}
  a{color:var(--accent)}
  .warn{background:rgba(255,176,32,.12);border:1px solid rgba(255,176,32,.3);color:#ffd488;
    padding:11px 14px;border-radius:var(--radius-sm);font-size:12.5px}
  .addr{display:flex;align-items:center;gap:12px;justify-content:space-between;padding:11px 0;border-bottom:1px solid rgba(255,255,255,.06)}
  .addr:last-child{border-bottom:none}
  .addr-k{font-size:11px;color:var(--txt3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px}
  .addr-v{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:16px;font-weight:600;word-break:break-all}
</style></head><body>
<div class="container">

  <div class="topbar">
    <div class="logo">&#9935;</div>
    <div>
      <h1>Minecraft Server</h1>
      <div class="sub" id="subline">Paper &middot; painel</div>
    </div>
    <div class="statuschip"><span class="sd" id="sd"></span><span id="statustext">...</span></div>
  </div>

  <!-- setup / instalar servidor -->
  <div class="card hidden" id="setupCard">
    <h2>Instalar servidor</h2>
    <p class="muted" id="setupMsg">Escolha a versao do Minecraft. O painel baixa o Paper e prepara tudo.</p>
    <div class="row" style="margin:12px 0">
      <select id="verSelect" class="flex1"><option>carregando versoes...</option></select>
      <button class="btn primary" id="btnInstall">Baixar &amp; instalar</button>
    </div>
    <div class="row" style="gap:9px">
      <button class="toggle" id="eulaToggle" aria-label="EULA"></button>
      <span class="muted">Aceito a <a href="https://aka.ms/MinecraftEULA" target="_blank" rel="noopener">EULA da Mojang</a></span>
    </div>
  </div>

  <!-- servidor -->
  <div class="card" id="mainCard">
    <h2>Servidor <span class="r" id="verLabel"></span></h2>
    <div class="grid" style="margin-bottom:16px">
      <div class="stat"><div class="k">Estado</div><div class="v" id="s_state">--</div></div>
      <div class="stat"><div class="k">Jogadores</div><div class="v" id="s_players">--</div></div>
      <div class="stat"><div class="k">Uptime</div><div class="v" id="s_uptime">--</div></div>
      <div class="stat"><div class="k">RAM do server</div><div class="v" id="s_ram">--</div></div>
      <div class="stat"><div class="k">RAM da caixa</div><div class="v" id="s_hostram">--</div></div>
      <div class="stat"><div class="k">Load</div><div class="v" id="s_load">--</div></div>
    </div>
    <div class="row">
      <button class="btn primary" id="b_start">Iniciar</button>
      <button class="btn" id="b_stop">Parar</button>
      <button class="btn" id="b_restart">Reiniciar</button>
      <button class="btn danger" id="b_kill">Forcar kill</button>
    </div>
  </div>

  <!-- endereco pra conectar -->
  <div class="card" id="connectCard">
    <h2>Endereco pra entrar <span class="r" id="cc_port">porta 25565</span></h2>
    <div id="cc_list"></div>
    <div class="row" style="margin-top:13px;gap:8px">
      <input type="text" id="cc_host" class="flex1" placeholder="dominio proprio (ex.: discord-caseiro.duckdns.org)">
      <button class="btn sm" id="cc_savehost">Salvar</button>
    </div>
    <p class="dim" id="cc_note" style="margin-top:9px"></p>
  </div>

  <div class="tabs" id="tabs">
    <button data-t="console" class="active">Console</button>
    <button data-t="plugins">Plugins</button>
    <button data-t="mods">Mods</button>
    <button data-t="worlds">Mundos</button>
    <button data-t="props">Configuracoes</button>
    <button data-t="ram">RAM &amp; versao</button>
  </div>

  <!-- console -->
  <div class="card tabpane" data-t="console">
    <h2>Console</h2>
    <div class="console" id="console"></div>
    <div class="row" style="margin-top:10px">
      <input type="text" id="cmd" class="flex1" placeholder="comando (say oi, op nick, whitelist add nick, time set day...)" autocomplete="off">
      <button class="btn" id="b_send">Enviar</button>
    </div>
  </div>

  <!-- plugins -->
  <div class="card tabpane hidden" data-t="plugins">
    <h2>Plugins <span class="r">.jar em /data/plugins</span></h2>
    <table id="plugTbl"><tbody></tbody></table>
    <div style="height:16px"></div>
    <h2>Buscar no Modrinth</h2>
    <div class="row"><input type="text" id="mrq" class="flex1" placeholder="ex.: EssentialsX, LuckPerms, WorldEdit"><button class="btn" id="b_mrsearch">Buscar</button></div>
    <div id="mrResults"></div>
    <div style="height:16px"></div>
    <h2>Instalar por link / arquivo</h2>
    <div class="row">
      <input type="text" id="plUrl" class="flex1" placeholder="https://.../plugin.jar (link direto)">
      <input type="text" id="plName" placeholder="Nome.jar" style="max-width:170px">
      <button class="btn" id="b_plurl">Baixar</button>
    </div>
    <div class="row" style="margin-top:9px">
      <label class="btn sm" style="cursor:pointer;margin:0">enviar .jar do PC<input type="file" id="plFile" accept=".jar" class="hidden"></label>
      <span class="dim">reinicie o servidor pra aplicar mudancas</span>
    </div>
  </div>

  <!-- mods -->
  <div class="card tabpane hidden" data-t="mods">
    <h2>Mods <span class="r">.jar em /data/mods</span></h2>
    <div class="warn" style="margin-bottom:14px">
      Este servidor esta rodando Paper. Mods Fabric, Forge, NeoForge e Quilt precisam que o servidor seja trocado para o mesmo loader, e normalmente todos os jogadores tambem precisam instalar os mesmos mods.
    </div>
    <table id="modTbl"><tbody></tbody></table>
    <div style="height:16px"></div>
    <h2>Buscar mods no Modrinth</h2>
    <div class="row">
      <input type="text" id="modMrq" class="flex1" placeholder="ex.: Sodium, Xaero, Create, Voice Chat">
      <select id="modLoader" style="max-width:150px">
        <option value="fabric">Fabric</option>
        <option value="forge">Forge</option>
        <option value="neoforge">NeoForge</option>
        <option value="quilt">Quilt</option>
        <option value="">Todos</option>
      </select>
      <button class="btn" id="b_modsearch">Buscar</button>
    </div>
    <div id="modResults"></div>
    <div style="height:16px"></div>
    <h2>Instalar por link / arquivo</h2>
    <div class="row">
      <input type="text" id="modUrl" class="flex1" placeholder="https://.../mod.jar (link direto)">
      <input type="text" id="modName" placeholder="Nome.jar" style="max-width:170px">
      <button class="btn" id="b_modurl">Baixar</button>
    </div>
    <div class="row" style="margin-top:9px">
      <label class="btn sm" style="cursor:pointer;margin:0">enviar .jar do PC<input type="file" id="modFile" accept=".jar" class="hidden"></label>
      <span class="dim">reinicie o servidor depois de mexer nos mods</span>
    </div>
  </div>

  <!-- worlds -->
  <div class="card tabpane hidden" data-t="worlds">
    <h2>Mundos / mapas</h2>
    <table id="worldTbl"><tbody></tbody></table>
    <div style="height:14px"></div>
    <h2>Subir um mapa (.zip)</h2>
    <div class="row">
      <input type="text" id="wName" class="flex1" placeholder="nome do mundo (ex.: skyblock)">
      <label class="btn sm" style="cursor:pointer;margin:0">escolher .zip<input type="file" id="wFile" accept=".zip" class="hidden"></label>
      <button class="btn" id="b_wupload" disabled>Enviar</button>
    </div>
    <p class="dim" style="margin:8px 0 0">o .zip deve conter a pasta do mundo (com level.dat). nether/end usam o nome + <span class="muted">_nether</span> / <span class="muted">_the_end</span>.</p>
  </div>

  <!-- props -->
  <div class="card tabpane hidden" data-t="props">
    <h2>server.properties</h2>
    <div id="propsBox" class="grid"></div>
    <div class="row" style="margin-top:14px">
      <button class="btn primary" id="b_saveprops">Salvar</button>
      <span class="dim">reinicie pra aplicar</span>
    </div>
  </div>

  <!-- ram -->
  <div class="card tabpane hidden" data-t="ram">
    <h2>Memoria do servidor</h2>
    <div class="warn" id="ramWarn" style="margin-bottom:14px"></div>
    <label>Xmx (maximo) — <span class="tag" id="xmxLbl">--</span></label>
    <div class="slider-wrap"><input type="range" id="xmxRange" min="512" max="3072" step="128"><span class="muted" id="xmxMB"></span></div>
    <label style="margin-top:14px">Xms (inicial) — <span class="tag" id="xmsLbl">--</span></label>
    <div class="slider-wrap"><input type="range" id="xmsRange" min="512" max="3072" step="128"><span class="muted" id="xmsMB"></span></div>
    <label style="margin-top:14px">Flags extras da JVM</label>
    <input type="text" id="jflags" placeholder="(opcional) ex.: -XX:+UseG1GC -XX:MaxGCPauseMillis=200">
    <div class="row" style="gap:9px;margin-top:14px">
      <button class="toggle" id="autoToggle"></button><span class="muted">iniciar o servidor junto com o app</span>
    </div>
    <div class="row" style="margin-top:16px"><button class="btn primary" id="b_savuram">Salvar</button><span class="dim">vale no proximo start/restart</span></div>
    <div style="height:20px"></div>
    <h2>Trocar versao do Paper</h2>
    <div class="row"><select id="verSelect2" class="flex1"></select><button class="btn" id="b_reinstall">Instalar essa versao</button></div>
    <p class="dim" style="margin-top:8px">pare o servidor antes de trocar. o mundo e os plugins continuam.</p>
  </div>

</div>
<div class="toast" id="toast"></div>

<script>
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
let ES=null, statusTimer=null;
function toast(m){const t=$('#toast');t.textContent=m;t.classList.add('show');clearTimeout(t._h);t._h=setTimeout(()=>t.classList.remove('show'),2800);}
async function api(path,opts){
  const o=Object.assign({headers:{}},opts||{});
  if(o.body && typeof o.body!=='string' && !(o.body instanceof Blob)){o.body=JSON.stringify(o.body);o.headers['Content-Type']='application/json';}
  const r=await fetch(path,o); let d=null; try{d=await r.json();}catch(_){}
  return {status:r.status,data:d};
}
function fmtDur(ms){if(!ms)return '--';const s=Math.floor(ms/1000),h=Math.floor(s/3600),m=Math.floor(s%3600/60);return (h?h+'h ':'')+m+'m';}
function fmtSize(b){if(b==null)return '--';if(b<1024)return b+' B';if(b<1048576)return (b/1024).toFixed(0)+' KB';if(b<1073741824)return (b/1048576).toFixed(1)+' MB';return (b/1073741824).toFixed(2)+' GB';}
function memToMB(s){const m=/^(\\d+)([MG])$/.exec(s||'');if(!m)return 1024;return m[2]==='G'?+m[1]*1024:+m[1];}
function mbToMem(mb){return mb%1024===0?(mb/1024)+'G':mb+'M';}
function copyText(t){
  if(navigator.clipboard && navigator.clipboard.writeText){navigator.clipboard.writeText(t).then(()=>toast('copiado: '+t)).catch(()=>fallbackCopy(t));}
  else fallbackCopy(t);
}
function fallbackCopy(t){
  const ta=document.createElement('textarea');ta.value=t;ta.style.position='fixed';ta.style.opacity='0';
  document.body.appendChild(ta);ta.select();try{document.execCommand('copy');toast('copiado: '+t);}catch(_){toast(t);}
  document.body.removeChild(ta);
}

// ---- endereco pra conectar ----
async function loadConnect(){
  const {data}=await api('/api/connect-info'); if(!data||!data.ok)return;
  const port=data.port;
  $('#cc_port').textContent='porta '+port;
  const rows=[];
  if(data.hostname) rows.push(['Pela internet (dominio)', data.hostname+':'+port]);
  if(data.publicIp) rows.push(['Pela internet (IP)', data.publicIp+':'+port]);
  if(!data.hostname && !data.publicIp) rows.push(['Pela internet', 'nao consegui detectar o IP publico agora']);
  rows.push(['Na mesma rede / Wi-Fi', (data.lanHint||'umbrel.local')+':'+port]);
  const box=$('#cc_list'); box.innerHTML='';
  for(const [k,v] of rows){
    const d=document.createElement('div'); d.className='addr';
    d.innerHTML='<div><div class="addr-k">'+k+'</div><div class="addr-v">'+v+'</div></div>';
    const b=document.createElement('button'); b.className='btn sm'; b.textContent='copiar';
    b.onclick=()=>copyText(v);
    d.appendChild(b); box.appendChild(d);
  }
  if($('#cc_host')!==document.activeElement) $('#cc_host').value=data.hostname||'';
  $('#cc_note').textContent='Os amigos de fora precisam da porta '+port+'/TCP liberada no roteador apontando pro Umbrel. O IP publico da Vivo muda de vez em quando — um dominio dinamico (DuckDNS) evita reavisar todo mundo.';
}
$('#cc_savehost').onclick=async()=>{
  const {data}=await api('/api/settings',{method:'POST',body:{connectHostname:$('#cc_host').value.trim()}});
  toast(data&&data.ok?'salvo':'erro'); loadConnect();
};

// ---- tabs ----
$('#tabs').addEventListener('click',e=>{
  const b=e.target.closest('button'); if(!b)return;
  $$('#tabs button').forEach(x=>x.classList.toggle('active',x===b));
  $$('.tabpane').forEach(p=>p.classList.toggle('hidden',p.dataset.t!==b.dataset.t));
  if(b.dataset.t==='plugins')loadPlugins();
  if(b.dataset.t==='mods')loadMods();
  if(b.dataset.t==='worlds')loadWorlds();
  if(b.dataset.t==='props')loadProps();
  if(b.dataset.t==='ram')loadRam();
});

// ---- status ----
async function refresh(){
  const {data}=await api('/api/status'); if(!data)return;
  window._st=data;
  const setup=!data.installed;
  $('#setupCard').classList.toggle('hidden',!setup);
  $('#mainCard').classList.toggle('hidden',setup);
  $('#connectCard').classList.toggle('hidden',setup);
  $('#tabs').classList.toggle('hidden',setup);
  $$('.tabpane').forEach(p=>{ if(setup) p.classList.add('hidden'); });
  $('#subline').textContent = 'Paper'+(data.mcVersion?(' '+data.mcVersion):'')+(data.build?(' &middot; build '+data.build):'');
  $('#verLabel').textContent = data.mcVersion? (data.mcVersion+(data.build?(' / '+data.build):'')) : '';

  const sd=$('#sd'), sx=$('#statustext');
  if(data.running && data.ready){sd.className='sd on';sx.textContent='rodando';}
  else if(data.running){sd.className='sd wait';sx.textContent='iniciando...';}
  else if(data.stopping){sd.className='sd wait';sx.textContent='parando...';}
  else {sd.className='sd off';sx.textContent='parado';}

  $('#s_state').textContent = data.running?(data.ready?'online':'iniciando'):'offline';
  $('#s_players').textContent = data.running? (data.players.length + (data.maxPlayers?(' / '+data.maxPlayers):'')) : '--';
  $('#s_uptime').textContent = fmtDur(data.uptimeMs);
  $('#s_ram').textContent = data.ram.xms+' / '+data.ram.xmx;
  const m=data.mem;
  $('#s_hostram').textContent = m? ((m.freeMB)+' livre / '+m.totalMB+' MB') : '--';
  $('#s_load').textContent = data.load? data.load.join('  ') : '--';

  $('#b_start').disabled = data.running;
  $('#b_stop').disabled = !data.running;
  $('#b_restart').disabled = !data.installed;
  $('#b_kill').disabled = !data.running;

  // eula toggle no setup
  $('#eulaToggle').classList.toggle('on',!!data.eula);
}
$('#eulaToggle').addEventListener('click',async()=>{
  const cur=$('#eulaToggle').classList.contains('on');
  const {data}=await api('/api/eula',{method:'POST',body:{accept:!cur}});
  if(data)$('#eulaToggle').classList.toggle('on',data.eula);
});

// ---- console ----
function connectConsole(){
  if(ES)ES.close();
  const box=$('#console');
  ES=new EventSource('/api/console/stream');
  ES.onmessage=ev=>{
    try{
      const e=JSON.parse(ev.data);
      const near=box.scrollTop+box.clientHeight>box.scrollHeight-40;
      const d=document.createElement('span');d.className='l';d.textContent=e.line;box.appendChild(d);
      while(box.children.length>1500)box.removeChild(box.firstChild);
      if(near)box.scrollTop=box.scrollHeight;
    }catch(_){}
  };
}
async function sendCmd(){
  const v=$('#cmd').value.trim(); if(!v)return; $('#cmd').value='';
  const {data}=await api('/api/console',{method:'POST',body:{command:v}});
  if(data&&!data.ok)toast(data.error||'erro');
}
$('#b_send').onclick=sendCmd;
$('#cmd').addEventListener('keydown',e=>{if(e.key==='Enter')sendCmd();});

// ---- power ----
function wire(id,action){$('#'+id).onclick=async()=>{
  $('#'+id).disabled=true; toast(action+'...');
  const {data}=await api('/api/power/'+action,{method:'POST'});
  toast(data&&data.ok?(data.note||action+' ok'):((data&&data.error)||'falhou'));
  setTimeout(refresh,700);
};}
wire('b_start','start');wire('b_stop','stop');wire('b_restart','restart');wire('b_kill','kill');

// ---- setup / versions ----
async function loadVersions(){
  const {data}=await api('/api/versions');
  const opts = (data&&data.ok&&data.versions.length)? data.versions.map(v=>'<option>'+v+'</option>').join('') : '<option>erro ao listar</option>';
  $('#verSelect').innerHTML=opts; $('#verSelect2').innerHTML=opts;
}
$('#btnInstall').onclick=async()=>{
  if(!$('#eulaToggle').classList.contains('on'))return toast('aceite a EULA primeiro');
  const v=$('#verSelect').value; $('#btnInstall').disabled=true; $('#setupMsg').textContent='baixando Paper '+v+'... (pode levar 1-2 min)';
  const {data}=await api('/api/install-server',{method:'POST',body:{mcVersion:v}});
  $('#btnInstall').disabled=false;
  if(data&&data.ok){toast('instalado!');refresh();}
  else{$('#setupMsg').textContent=(data&&data.error)||'falhou';toast('falhou');}
};
$('#b_reinstall').onclick=async()=>{
  const v=$('#verSelect2').value; if(window._st&&window._st.running)return toast('pare o servidor antes');
  $('#b_reinstall').disabled=true; toast('baixando '+v+'...');
  const {data}=await api('/api/install-server',{method:'POST',body:{mcVersion:v}});
  $('#b_reinstall').disabled=false;
  toast(data&&data.ok?'instalado '+v:((data&&data.error)||'falhou')); refresh();
};

// ---- plugins ----
async function loadJarTable(endpoint, tbodySelector, emptyText){
  const {data}=await api(endpoint); const tb=$(tbodySelector); tb.innerHTML='';
  const list=(data&&data.plugins)||(data&&data.mods)||[];
  if(!list.length){tb.innerHTML='<tr><td class="empty">'+emptyText+'</td></tr>';return data;}
  for(const p of list){
    const tr=document.createElement('tr');
    tr.innerHTML='<td><b>'+p.name+'</b></td><td><span class="pill '+(p.enabled?'on':'off')+'">'+(p.enabled?'ativo':'off')+'</span></td><td class="dim">'+fmtSize(p.size)+'</td><td style="text-align:right;white-space:nowrap"></td>';
    const cell=tr.lastChild;
    const t=document.createElement('button');t.className='btn sm';t.textContent=p.enabled?'desativar':'ativar';
    t.onclick=async()=>{await api(endpoint+'/toggle',{method:'POST',body:{name:p.name,enabled:!p.enabled}}); endpoint==='/api/plugins'?loadPlugins():loadMods();};
    const d=document.createElement('button');d.className='btn sm danger';d.textContent='excluir';d.style.marginLeft='6px';
    d.onclick=async()=>{if(!confirm('Excluir '+p.name+'?'))return;await api(endpoint+'/delete',{method:'POST',body:{name:p.name}}); endpoint==='/api/plugins'?loadPlugins():loadMods();};
    cell.append(t,d); tb.appendChild(tr);
  }
  return data;
}
async function loadPlugins(){
  await loadJarTable('/api/plugins','#plugTbl tbody','nenhum plugin ainda');
}
async function searchModrinthInto({querySelector, resultSelector, kind, loaderSelector, onDone}){
  const q=$(querySelector).value.trim(); const box=$(resultSelector); box.innerHTML='<p class="dim">buscando...</p>';
  const loader = loaderSelector ? $(loaderSelector).value : '';
  const qs = new URLSearchParams({ q, kind });
  if(loader) qs.set('loader', loader);
  const {data}=await api('/api/modrinth/search?'+qs.toString());
  if(!data||!data.ok){box.innerHTML='<p class="dim">'+((data&&data.error)||'erro')+'</p>';return;}
  if(!data.hits.length){box.innerHTML='<p class="dim">nada encontrado</p>';return;}
  box.innerHTML='';
  for(const h of data.hits){
    const row=document.createElement('div');row.className='row';row.style.cssText='padding:9px 0;border-bottom:1px solid rgba(255,255,255,.06)';
    row.innerHTML='<div class="flex1"><b>'+h.title+'</b> <span class="dim">'+(h.downloads||0).toLocaleString('pt-BR')+' downloads</span><br><span class="muted" style="font-size:12px">'+(h.description||'').slice(0,120)+'</span></div>';
    const b=document.createElement('button');b.className='btn sm';b.textContent='instalar';
    b.onclick=async()=>{b.disabled=true;b.textContent='...';const{data:r}=await api('/api/modrinth/install',{method:'POST',body:{slug:h.slug,kind,loader}});toast(r&&r.ok?('instalado '+r.name):((r&&r.error)||'falhou'));b.disabled=false;b.textContent='instalar';onDone&&onDone();};
    row.appendChild(b); box.appendChild(row);
  }
}
$('#b_mrsearch').onclick=async()=>{
  await searchModrinthInto({querySelector:'#mrq',resultSelector:'#mrResults',kind:'plugin',onDone:loadPlugins});
};
$('#b_plurl').onclick=async()=>{
  const url=$('#plUrl').value.trim(); if(!url)return toast('cole o link');
  toast('baixando...');
  const {data}=await api('/api/plugins/install-url',{method:'POST',body:{url,filename:$('#plName').value.trim()}});
  if(data&&data.ok){toast('ok: '+data.name);$('#plUrl').value='';$('#plName').value='';loadPlugins();}
  else toast((data&&data.error)||'falhou');
};
$('#plFile').addEventListener('change',async e=>{
  const f=e.target.files[0]; if(!f)return; toast('enviando '+f.name+'...');
  const r=await fetch('/api/plugins/upload?name='+encodeURIComponent(f.name),{method:'PUT',body:f});
  const d=await r.json().catch(()=>null);
  toast(d&&d.ok?('ok: '+d.name):((d&&d.error)||'falhou')); e.target.value=''; loadPlugins();
});

// ---- mods ----
async function loadMods(){
  await loadJarTable('/api/mods','#modTbl tbody','nenhum mod ainda');
}
$('#b_modsearch').onclick=async()=>{
  await searchModrinthInto({querySelector:'#modMrq',resultSelector:'#modResults',kind:'mod',loaderSelector:'#modLoader',onDone:loadMods});
};
$('#b_modurl').onclick=async()=>{
  const url=$('#modUrl').value.trim(); if(!url)return toast('cole o link');
  toast('baixando...');
  const {data}=await api('/api/mods/install-url',{method:'POST',body:{url,filename:$('#modName').value.trim()}});
  if(data&&data.ok){toast('ok: '+data.name);$('#modUrl').value='';$('#modName').value='';loadMods();}
  else toast((data&&data.error)||'falhou');
};
$('#modFile').addEventListener('change',async e=>{
  const f=e.target.files[0]; if(!f)return; toast('enviando '+f.name+'...');
  const r=await fetch('/api/mods/upload?name='+encodeURIComponent(f.name),{method:'PUT',body:f});
  const d=await r.json().catch(()=>null);
  toast(d&&d.ok?('ok: '+d.name):((d&&d.error)||'falhou')); e.target.value=''; loadMods();
});

// ---- worlds ----
async function loadWorlds(){
  const {data}=await api('/api/worlds'); const tb=$('#worldTbl tbody'); tb.innerHTML='';
  if(!data||!data.worlds||!data.worlds.length){tb.innerHTML='<tr><td class="empty">nenhum mundo (crie um iniciando o servidor)</td></tr>';return;}
  for(const w of data.worlds){
    const tr=document.createElement('tr');
    tr.innerHTML='<td><b>'+w.name+'</b> '+(w.active?'<span class="pill on">ativo</span>':'')+'</td><td class="dim">'+fmtSize(w.size)+'</td><td class="dim">'+(w.hasNether?'nether ':'')+(w.hasEnd?'end':'')+'</td><td style="text-align:right;white-space:nowrap"></td>';
    const cell=tr.lastChild;
    if(!w.active){const a=document.createElement('button');a.className='btn sm';a.textContent='ativar';
      a.onclick=async()=>{const{data:r}=await api('/api/worlds/activate',{method:'POST',body:{name:w.name}});toast(r&&r.ok?(r.note||'ativo'):((r&&r.error)||'falhou'));loadWorlds();};cell.appendChild(a);}
    const dl=document.createElement('a');dl.className='btn sm';dl.textContent='baixar';dl.href='/api/worlds/download?name='+encodeURIComponent(w.name);dl.style.marginLeft='6px';cell.appendChild(dl);
    const del=document.createElement('button');del.className='btn sm danger';del.textContent='excluir';del.style.marginLeft='6px';
    del.onclick=async()=>{if(!confirm('Excluir o mundo '+w.name+'? (inclui nether/end)'))return;const{data:r}=await api('/api/worlds/delete',{method:'POST',body:{name:w.name}});toast(r&&r.ok?'excluido':((r&&r.error)||'falhou'));loadWorlds();};
    cell.appendChild(del);
    tb.appendChild(tr);
  }
}
let wFile=null;
$('#wFile').addEventListener('change',e=>{wFile=e.target.files[0]||null;$('#b_wupload').disabled=!wFile||!$('#wName').value.trim();if(wFile&&!$('#wName').value.trim())$('#wName').value=wFile.name.replace(/\\.zip$/i,'');$('#b_wupload').disabled=!wFile||!$('#wName').value.trim();});
$('#wName').addEventListener('input',()=>{$('#b_wupload').disabled=!wFile||!$('#wName').value.trim();});
$('#b_wupload').onclick=async()=>{
  if(!wFile)return; const n=$('#wName').value.trim();
  $('#b_wupload').disabled=true; toast('enviando mapa... (pode demorar)');
  const r=await fetch('/api/worlds/upload?name='+encodeURIComponent(n),{method:'PUT',body:wFile});
  const d=await r.json().catch(()=>null);
  toast(d&&d.ok?('mundo "'+d.name+'" adicionado'):((d&&d.error)||'falhou'));
  wFile=null;$('#wFile').value='';$('#wName').value='';loadWorlds();
};

// ---- props ----
const PROP_KEYS=['motd','difficulty','gamemode','hardcore','pvp','max-players','level-name','level-type','level-seed','online-mode','white-list','enforce-whitelist','spawn-protection','view-distance','simulation-distance','allow-nether','allow-flight','enable-command-block','spawn-monsters','spawn-animals','player-idle-timeout','resource-pack','server-port'];
async function loadProps(){
  const {data}=await api('/api/properties'); const box=$('#propsBox'); box.innerHTML='';
  if(!data||!data.props)return;
  const props=data.props;
  const keys=PROP_KEYS.filter(k=>k in props).concat(Object.keys(props).filter(k=>!PROP_KEYS.includes(k)));
  for(const k of keys){
    const w=document.createElement('div');
    w.innerHTML='<label>'+k+'</label>';
    let inp;
    if(/^(true|false)$/i.test(props[k])){inp=document.createElement('select');inp.innerHTML='<option>true</option><option>false</option>';inp.value=props[k].toLowerCase();}
    else{inp=document.createElement('input');inp.type='text';inp.value=props[k];}
    inp.dataset.k=k; w.appendChild(inp); box.appendChild(w);
  }
}
$('#b_saveprops').onclick=async()=>{
  const props={}; $$('#propsBox [data-k]').forEach(i=>props[i.dataset.k]=i.value);
  const {data}=await api('/api/properties',{method:'POST',body:{props}});
  toast(data&&data.ok?'salvo'+(data.note?(' — '+data.note):''):'erro');
};

// ---- ram ----
function syncRam(){
  const xmx=+$('#xmxRange').value, xms=+$('#xmsRange').value;
  $('#xmxLbl').textContent=mbToMem(xmx);$('#xmxMB').textContent=xmx+' MB';
  $('#xmsLbl').textContent=mbToMem(xms);$('#xmsMB').textContent=xms+' MB';
}
function loadRam(){
  const st=window._st; if(!st)return;
  const total=st.mem?st.mem.totalMB:3072;
  const max=Math.max(1024,Math.floor(total*0.9/128)*128);
  $('#xmxRange').max=max; $('#xmsRange').max=max;
  $('#xmxRange').value=Math.min(max,memToMB(st.ram.xmx));
  $('#xmsRange').value=Math.min(max,memToMB(st.ram.xms));
  $('#jflags').value=(st.ram.javaFlags||[]).join(' ');
  $('#autoToggle').classList.toggle('on',!!st.autostart);
  $('#ramWarn').textContent='A caixa tem '+total+' MB no total. Deixe folga pro sistema e outros apps do Umbrel — passar de ~'+max+' MB pode travar tudo.';
  syncRam();
}
$('#xmxRange').addEventListener('input',()=>{if(+$('#xmsRange').value>+$('#xmxRange').value)$('#xmsRange').value=$('#xmxRange').value;syncRam();});
$('#xmsRange').addEventListener('input',()=>{if(+$('#xmsRange').value>+$('#xmxRange').value)$('#xmxRange').value=$('#xmsRange').value;syncRam();});
$('#autoToggle').addEventListener('click',()=>$('#autoToggle').classList.toggle('on'));
$('#b_savuram').onclick=async()=>{
  const body={xmx:mbToMem(+$('#xmxRange').value),xms:mbToMem(+$('#xmsRange').value),javaFlags:$('#jflags').value.trim(),autostart:$('#autoToggle').classList.contains('on')};
  const {data}=await api('/api/settings',{method:'POST',body});
  toast(data&&data.ok?('salvo'+(data.note?(' — '+data.note):'')):'erro'); refresh();
};

// ---- boot ----
connectConsole(); refresh(); loadVersions(); loadConnect();
statusTimer=setInterval(refresh,4000);
setInterval(loadConnect,120000);
</script>
</body></html>`;
