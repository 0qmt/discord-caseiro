const VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export const REMOTE_UPDATE_STORAGE_KEY = 'discordia:atualizacao-remota';
export const REMOTE_UPDATE_TTL_MS = 10 * 60 * 1000;
export const REMOTE_UPDATE_MAX_RESTARTS = 1;

function parseVersion(value) {
  const match = VERSION_PATTERN.exec(String(value ?? '').trim());
  if (!match) return null;
  return {
    numbers: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4]?.split('.') ?? [],
  };
}

function comparePrerelease(left, right) {
  if (!left.length && !right.length) return 0;
  if (!left.length) return 1;
  if (!right.length) return -1;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    if (left[index] === undefined) return -1;
    if (right[index] === undefined) return 1;
    const leftNumber = /^\d+$/.test(left[index]) ? Number(left[index]) : null;
    const rightNumber = /^\d+$/.test(right[index]) ? Number(right[index]) : null;
    if (leftNumber !== null && rightNumber !== null && leftNumber !== rightNumber) {
      return leftNumber < rightNumber ? -1 : 1;
    }
    if (leftNumber !== null && rightNumber === null) return -1;
    if (leftNumber === null && rightNumber !== null) return 1;
    if (left[index] !== right[index]) return left[index] < right[index] ? -1 : 1;
  }
  return 0;
}

export function compareSemanticVersions(leftValue, rightValue) {
  const left = parseVersion(leftValue);
  const right = parseVersion(rightValue);
  if (!left || !right) return null;
  for (let index = 0; index < left.numbers.length; index += 1) {
    if (left.numbers[index] !== right.numbers[index]) {
      return left.numbers[index] < right.numbers[index] ? -1 : 1;
    }
  }
  return comparePrerelease(left.prerelease, right.prerelease);
}

export function isVersionOutdated(version, currentVersion) {
  return compareSemanticVersions(version, currentVersion) === -1;
}

const PLATFORM_LABEL = { desktop: 'Desktop', android: 'Android', web: 'Web' };
const PLATFORM_ICON = { desktop: '🖥️', android: '📱', web: '🌐' };

export function remoteUpdateMenuItems(sessions, currentVersion, onForceUpdate) {
  const list = Array.isArray(sessions) ? sessions : [];
  if (list.length === 0) {
    return [{ label: 'Versão indisponível', icone: 'ℹ️', desabilitado: true }];
  }

  return list.map((session, index) => {
    if (!session?.platform || !session.version) {
      return {
        key: session?.socketId ?? `unknown-${index}`,
        label: 'Versão indisponível',
        icone: 'ℹ️',
        desabilitado: true,
      };
    }

    const platformLabel = PLATFORM_LABEL[session.platform] ?? 'Cliente';
    const base = `${platformLabel} ${session.version}`;
    const versionComparison = compareSemanticVersions(session.version, currentVersion);
    const outdated = versionComparison === -1;
    const actionable = session.platform === 'desktop'
      && outdated
      && session.automaticUpdate
      && session.updateBridge
      && !session.portable;

    let suffix = '';
    if (session.platform === 'desktop' && session.portable) suffix = ' — Portable';
    else if (actionable) suffix = ' — Reiniciar para atualizar';
    else if (versionComparison === null) suffix = ' — status desconhecido';
    else if (session.platform === 'desktop') suffix = outdated ? ' — Desatualizada' : ' — Atualizada';
    else if (session.platform === 'web') suffix = outdated ? ' — bundle antigo' : ' — versão atual';

    return {
      key: session.socketId ?? `${session.platform}-${index}`,
      label: `${base}${suffix}`,
      icone: PLATFORM_ICON[session.platform] ?? 'ℹ️',
      desabilitado: !actionable,
      onClick: actionable ? () => onForceUpdate([session.socketId]) : undefined,
    };
  });
}

export function createRemoteUpdateIntent(targetVersion, now = Date.now()) {
  if (!parseVersion(targetVersion)) return null;
  return {
    targetVersion: String(targetVersion).replace(/^v/, ''),
    createdAt: now,
    expiresAt: now + REMOTE_UPDATE_TTL_MS,
    restarts: 0,
  };
}

export function readRemoteUpdateIntent(storage = globalThis.localStorage, now = Date.now()) {
  try {
    const parsed = JSON.parse(storage?.getItem(REMOTE_UPDATE_STORAGE_KEY));
    if (!parsed || !parseVersion(parsed.targetVersion)) return null;
    if (!Number.isFinite(parsed.expiresAt) || parsed.expiresAt <= now) return null;
    return {
      targetVersion: String(parsed.targetVersion),
      createdAt: Number(parsed.createdAt) || now,
      expiresAt: Number(parsed.expiresAt),
      restarts: Math.max(0, Number(parsed.restarts) || 0),
    };
  } catch {
    return null;
  }
}

export function saveRemoteUpdateIntent(intent, storage = globalThis.localStorage) {
  try {
    if (!intent) storage?.removeItem(REMOTE_UPDATE_STORAGE_KEY);
    else storage?.setItem(REMOTE_UPDATE_STORAGE_KEY, JSON.stringify(intent));
    return true;
  } catch {
    return false;
  }
}

export function nextRemoteUpdateAction(intent, updaterState, now = Date.now()) {
  if (!intent || intent.expiresAt <= now) return { action: 'stop', reason: 'expired' };
  const currentVersion = updaterState?.currentVersion;
  const comparison = compareSemanticVersions(currentVersion, intent.targetVersion);
  if (comparison !== null && comparison >= 0) return { action: 'stop', reason: 'updated' };

  if (updaterState?.status === 'ready' && updaterState.downloaded) {
    return { action: 'install' };
  }
  if (['checking', 'available', 'downloading', 'installing'].includes(updaterState?.status)) {
    return { action: 'wait' };
  }
  if (updaterState?.status === 'idle') {
    if (intent.restarts >= REMOTE_UPDATE_MAX_RESTARTS) {
      return { action: 'stop', reason: 'restart-limit' };
    }
    return { action: 'restart', intent: { ...intent, restarts: intent.restarts + 1 } };
  }
  if (updaterState?.status === 'failed') return { action: 'stop', reason: 'failed' };
  return { action: 'wait' };
}
