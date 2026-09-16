'use strict';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const state = { status: null, worlds: [], mods: [], plugins: [], backups: [], loaders: [], packageTab: 'mods', log: [] };
const esc = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
const formatBytes = (n) => n == null ? '—' : n > 1073741824 ? `${(n / 1073741824).toFixed(1)} GB` : n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`;
const formatDuration = (ms) => { if (!ms) return '—'; const h = Math.floor(ms / 3600000); const m = Math.floor((ms % 3600000) / 60000); return h ? `${h}h ${m}min` : `${m}min`; };
const titleCase = (s) => String(s || '—').replace(/^./, (c) => c.toUpperCase());

async function api(endpoint, options = {}) {
  const init = { method: options.method || 'GET', headers: {} };
  if (options.body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(options.body); }
  try {
    const response = await fetch(endpoint, init);
    const data = await response.json();
    if (!response.ok || data.ok === false) throw new Error(data.error || `HTTP ${response.status}`);
    return data;
  } catch (error) {
    toast(error.message || 'Não foi possível concluir a operação.', true);
    throw error;
  }
}

let toastTimer;
function toast(message, error = false) {
  const el = $('#toast'); el.textContent = message; el.classList.toggle('error', error); el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 3500);
}

function showView(name) {
  $$('.view').forEach((view) => view.classList.toggle('active', view.id === `view-${name}`));
  $$('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.view === name));
  location.hash = name;
  $('#sidebar').classList.remove('open'); $('#scrim').classList.remove('open');
  if (name === 'worlds') loadWorlds();
  if (name === 'packages') loadPackages();
  if (name === 'players') renderPlayers();
  if (name === 'backups') loadBackups();
  if (name === 'settings') loadSettings();
}

function renderStatus() {
  const s = state.status; if (!s) return;
  const online = s.running && s.ready;
  $('#connectionDot').className = `connection-dot ${online ? 'online' : 'offline'}`;
  $('#topStatus').textContent = online ? 'Servidor online' : s.running ? 'Servidor iniciando' : 'Servidor parado';
  $('#topVersion').textContent = `${titleCase(s.loaderDetected || s.loaderConfigured)} · ${s.mcVersion || 'versão desconhecida'}`;
  $('#serverChip').className = `status-chip ${online ? 'online' : s.running ? '' : 'offline'}`;
  $('#serverChip').textContent = online ? 'ONLINE' : s.running ? 'INICIANDO' : 'PARADO';
  $('#factLoader').textContent = titleCase(s.loaderDetected || s.loaderConfigured);
  $('#factVersion').textContent = s.mcVersion || '—';
  $('#factPlayers').textContent = `${s.players.length} / ${s.maxPlayers || '—'}`;
  $('#factUptime').textContent = s.running ? formatDuration(s.uptimeMs) : '—';
  $('#playerCount').textContent = s.players.length;
  $('#startButton').disabled = s.running || !s.installed || !s.eula;
  $('#restartButton').disabled = !s.running;
  $('#stopButton').disabled = !s.running;
  const mismatch = s.loaderMismatch;
  $('#loaderWarning').classList.toggle('hidden', !mismatch && !(s.packageErrors || []).length);
  $('#loaderWarning').textContent = mismatch ? `Atenção: o painel está configurado para ${s.loaderConfigured}, mas o log identificou ${s.loaderDetected}.` : (s.packageErrors || []).slice(-1)[0]?.line || '';
  const mem = s.mem || {}; const used = mem.cgUsageMB || (mem.totalMB - mem.freeMB); const total = mem.cgLimitMB || mem.totalMB;
  const pct = total ? Math.min(100, Math.round(used / total * 100)) : 0;
  $('#memoryValue').textContent = total ? `${used} / ${total} MB` : '—'; $('#memoryMeter').style.width = `${pct}%`;
  const load = s.load?.[0] || 0; $('#loadValue').textContent = s.load ? s.load.join(' · ') : '—'; $('#loadMeter').style.width = `${Math.min(100, load / 4 * 100)}%`;
  $('#hostMemory').textContent = total ? `Memória: ${used} / ${total} MB` : 'Memória: —';
  $('#healthNote').textContent = pct > 85 ? 'Memória sob pressão. Evite iniciar outro servidor neste host.' : pct > 70 ? 'Uso de memória elevado, mas ainda dentro da margem configurada.' : 'Recursos dentro da faixa segura para o servidor atual.';
  $('#lastUpdate').textContent = `Atualizado às ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
  renderPlayers();
}

async function refreshStatus(silent = false) {
  try { state.status = await api('/api/status'); renderStatus(); }
  catch (_) { if (!silent) $('#topStatus').textContent = 'Painel indisponível'; }
}

async function power(action) {
  const messages = { start: 'Servidor iniciado.', stop: 'Servidor parado com segurança.', restart: 'Servidor reiniciado.' };
  try { await api(`/api/power/${action}`, { method: 'POST', body: {} }); toast(messages[action]); setTimeout(() => refreshStatus(true), 900); }
  catch (_) {}
}

async function loadWorlds() {
  try {
    const data = await api('/api/worlds'); state.worlds = data.worlds || [];
    $('#activeWorld').textContent = data.active || 'world'; $('#serverTitle').textContent = data.active || 'Mundo atual';
    $('#worldList').innerHTML = state.worlds.length ? state.worlds.map((w) => `<article class="list-card"><div><h3>${esc(w.name)} ${w.active ? '<span class="tag active">ATIVO</span>' : ''}</h3><p>${formatBytes(w.size)} · Nether ${w.hasNether ? 'presente' : 'não detectado'} · End ${w.hasEnd ? 'presente' : 'não detectado'}</p></div><div class="list-card-actions">${w.active ? '' : `<button class="mini-btn good" data-world-activate="${esc(w.name)}">Ativar</button>`}<a class="mini-btn" href="/api/worlds/download?name=${encodeURIComponent(w.name)}">Exportar</a></div></article>`).join('') : '<div class="notice">Nenhum mundo com level.dat foi encontrado.</div>';
  } catch (_) {}
}

function packageCard(p) {
  const pips = Array.from({ length: 5 }, (_, i) => `<i class="${i < (p.validationLevel || 0) ? 'on' : ''}"></i>`).join('');
  return `<article class="list-card"><div><h3>${esc(p.name)} ${p.enabled ? '<span class="tag active">ATIVO</span>' : '<span class="tag">DESATIVADO</span>'}</h3><p>${formatBytes(p.size)}${p.metadata ? ` · metadados ${esc(p.metadata)}` : ' · metadados não identificados'}</p><div class="validation-level"><span class="level-pips">${pips}</span><b>Nível ${p.validationLevel || 0}</b><span>${esc(p.validationLabel)}</span></div></div><div class="list-card-actions"><button class="mini-btn" data-package-toggle="${esc(p.name)}" data-enable="${!p.enabled}">${p.enabled ? 'Desativar' : 'Ativar'}</button>${p.validationLevel >= 4 && p.validationLevel < 5 ? `<button class="mini-btn good" data-package-confirm="${esc(p.name)}">Confirmar teste</button>` : ''}</div></article>`;
}

async function loadPackages() {
  try {
    const [mods, plugins] = await Promise.all([api('/api/mods'), api('/api/plugins')]);
    state.mods = mods.mods || []; state.plugins = plugins.plugins || [];
    const list = state[state.packageTab]; const data = state.packageTab === 'mods' ? mods : plugins;
    $('#packageCount').textContent = state.mods.length + state.plugins.length;
    $('#packageContext').innerHTML = `<b>Loader ativo: ${esc(titleCase(data.activeLoader))}</b><br>${data.supported ? `Este loader carrega ${state.packageTab === 'mods' ? 'mods' : 'plugins'} nesta inicialização.` : `Este loader não carrega ${state.packageTab === 'mods' ? 'mods' : 'plugins'}. Os arquivos permanecem guardados, sem efeito no mundo.`}`;
    $('#packageList').innerHTML = list.length ? list.map(packageCard).join('') : `<div class="notice">Nenhum ${state.packageTab === 'mods' ? 'mod' : 'plugin'} instalado.</div>`;
    const levels = state.mods.map((p) => p.validationLevel || 0); const best = levels.length ? Math.min(...levels) : 0;
    $('#validationSummary').innerHTML = `<div class="validation-bars">${Array.from({ length: 5 }, (_, i) => `<i class="${i < best ? 'active' : ''}"></i>`).join('')}</div><b>${state.mods.length} mods encontrados · evidência mínima nível ${best}</b><p>${best >= 4 ? 'O loader e o mundo iniciaram com esses pacotes.' : 'Abra a área de pacotes para ver o que ainda precisa de teste.'}</p>`;
  } catch (_) {}
}

function renderPlayers() {
  const players = state.status?.players || [];
  $('#overviewPlayers').innerHTML = players.length ? players.map((p) => `<span class="player-token"><i class="player-head"></i>${esc(p)}</span>`).join('') : '<span class="empty-copy">Nenhum jogador online.</span>';
  $('#playerList').innerHTML = players.length ? players.map((p) => `<article class="list-card"><div><h3>${esc(p)} <span class="tag active">ONLINE</span></h3><p>Detectado pelo console do servidor.</p></div><button class="mini-btn" data-fill-player="${esc(p)}">Selecionar</button></article>`).join('') : '<div class="notice">Nenhum jogador online agora. Você ainda pode informar um nome acima para whitelist, OP ou ban.</div>';
}

async function loadBackups() {
  try { const data = await api('/api/backups'); state.backups = data.backups || []; $('#backupList').innerHTML = state.backups.length ? state.backups.map((b) => `<article class="list-card"><div><h3>${esc(b.name)}</h3><p>${formatBytes(b.size)} · ${new Date(b.createdAt).toLocaleString('pt-BR')}</p></div><span class="tag">LOCAL</span></article>`).join('') : '<div class="notice">Ainda não há backups criados pelo painel.</div>'; } catch (_) {}
}

async function loadSettings() {
  try {
    const [settings, loaders] = await Promise.all([api('/api/settings'), api('/api/loaders')]);
    const s = settings.settings; state.loaders = loaders.loaders || [];
    $('#xmsInput').value = s.xms || ''; $('#xmxInput').value = s.xmx || ''; $('#flagsInput').value = (s.javaFlags || []).join(' '); $('#hostnameInput').value = s.connectHostname || ''; $('#lanInput').value = s.lanHint || '';
    $('#autostartSwitch').setAttribute('aria-checked', String(!!s.autostart));
    $('#loaderGrid').innerHTML = state.loaders.map((loader) => `<button class="loader-option ${loader.active ? 'active' : ''}" data-loader="${esc(loader.id)}" ${loader.installed ? '' : 'disabled'}><b>${esc(loader.label)}</b><span class="loader-state"></span><small>${loader.active ? 'Em uso agora' : loader.installed ? 'Instalado e disponível' : loader.automaticInstall ? 'Instale escolhendo uma versão Paper' : 'Launcher ainda não instalado'}</small></button>`).join('');
  } catch (_) {}
}

function connectConsole() {
  const events = new EventSource('/api/console/stream');
  events.onmessage = (event) => {
    try { const item = JSON.parse(event.data); state.log.push(item.line); if (state.log.length > 600) state.log.splice(0, state.log.length - 600); const text = state.log.join('\n'); $('#fullLog').textContent = text; $('#overviewLog').textContent = state.log.slice(-6).join('\n'); $('#fullLog').scrollTop = $('#fullLog').scrollHeight; }
    catch (_) {}
  };
}

document.addEventListener('click', async (event) => {
  const nav = event.target.closest('[data-view]'); if (nav) return showView(nav.dataset.view);
  const go = event.target.closest('[data-go]'); if (go) return showView(go.dataset.go);
  const world = event.target.closest('[data-world-activate]'); if (world) { try { await api('/api/worlds/activate', { method: 'POST', body: { name: world.dataset.worldActivate } }); toast('Mundo selecionado. Reinicie o servidor para carregar.'); loadWorlds(); } catch (_) {} return; }
  const toggle = event.target.closest('[data-package-toggle]'); if (toggle) { const kind = state.packageTab; try { await api(`/api/${kind}/toggle`, { method: 'POST', body: { name: toggle.dataset.packageToggle, enabled: toggle.dataset.enable === 'true' } }); toast('Estado do pacote atualizado. Reinicie para aplicar.'); loadPackages(); } catch (_) {} return; }
  const confirm = event.target.closest('[data-package-confirm]'); if (confirm) { try { await api('/api/packages/confirm', { method: 'POST', body: { name: confirm.dataset.packageConfirm, note: 'Função confirmada manualmente no mundo' } }); toast('Teste manual registrado como evidência nível 5.'); loadPackages(); } catch (_) {} return; }
  const fill = event.target.closest('[data-fill-player]'); if (fill) $('#playerName').value = fill.dataset.fillPlayer;
  const loader = event.target.closest('[data-loader]'); if (loader) { try { await api('/api/loaders/select', { method: 'POST', body: { loader: loader.dataset.loader } }); toast(`Loader alterado para ${loader.textContent.trim().split(/\s/)[0]}.`); await Promise.all([loadSettings(), refreshStatus(true), loadPackages()]); } catch (_) {} }
});

$$('.nav-item').forEach((button) => button.addEventListener('click', () => showView(button.dataset.view)));
$$('[data-package-tab]').forEach((button) => button.addEventListener('click', () => { state.packageTab = button.dataset.packageTab; $$('[data-package-tab]').forEach((b) => b.classList.toggle('active', b === button)); loadPackages(); }));
$('#menuButton').onclick = () => { $('#sidebar').classList.toggle('open'); $('#scrim').classList.toggle('open'); };
$('#scrim').onclick = () => { $('#sidebar').classList.remove('open'); $('#scrim').classList.remove('open'); };
$('#startButton').onclick = () => power('start'); $('#stopButton').onclick = () => power('stop'); $('#restartButton').onclick = () => power('restart');
$('#refreshWorlds').onclick = loadWorlds; $('#refreshPackages').onclick = loadPackages; $('#refreshPlayers').onclick = () => refreshStatus();
$('#clearConsole').onclick = () => { state.log = []; $('#fullLog').textContent = ''; $('#overviewLog').textContent = ''; };
$('#consoleForm').onsubmit = async (event) => { event.preventDefault(); const input = $('#consoleInput'); const command = input.value.trim(); if (!command) return; try { await api('/api/console', { method: 'POST', body: { command } }); input.value = ''; } catch (_) {} };
$('#playerActionButton').onclick = async () => { const player = $('#playerName').value.trim(); const action = $('#playerAction').value; try { await api('/api/players/action', { method: 'POST', body: { player, action } }); toast('Comando enviado ao servidor.'); } catch (_) {} };
$('#createBackup').onclick = async () => { const button = $('#createBackup'); button.disabled = true; button.textContent = 'Criando…'; try { await api('/api/backups', { method: 'POST', body: { label: 'manual' } }); toast('Backup concluído.'); loadBackups(); } catch (_) {} finally { button.disabled = false; button.textContent = 'Criar backup agora'; } };
$('#autostartSwitch').onclick = async () => { const button = $('#autostartSwitch'); const next = button.getAttribute('aria-checked') !== 'true'; try { await api('/api/settings', { method: 'POST', body: { autostart: next } }); button.setAttribute('aria-checked', String(next)); toast(next ? 'Inicialização automática ativada.' : 'Inicialização automática desativada.'); } catch (_) {} };
$('#saveRuntime').onclick = async () => { try { await api('/api/settings', { method: 'POST', body: { xms: $('#xmsInput').value.trim(), xmx: $('#xmxInput').value.trim(), javaFlags: $('#flagsInput').value.trim() } }); toast('Runtime salvo. Vale no próximo reinício.'); refreshStatus(true); } catch (_) {} };
$('#saveAddresses').onclick = async () => { try { await api('/api/settings', { method: 'POST', body: { connectHostname: $('#hostnameInput').value.trim(), lanHint: $('#lanInput').value.trim() } }); toast('Endereços salvos.'); } catch (_) {} };

async function boot() {
  const initial = location.hash.replace('#', '') || 'overview'; showView($(`#view-${initial}`) ? initial : 'overview');
  connectConsole();
  await Promise.all([refreshStatus(), loadWorlds(), loadPackages(), loadSettings()]);
  setInterval(() => refreshStatus(true), 4000);
}
boot();
