const PLATFORMS = new Set(['desktop', 'android', 'web']);
const VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export function parseSemanticVersion(value) {
  const match = VERSION_PATTERN.exec(String(value ?? '').trim());
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4]?.split('.') ?? [],
  };
}

function comparePrerelease(left, right) {
  if (left.length === 0 && right.length === 0) return 0;
  if (left.length === 0) return 1;
  if (right.length === 0) return -1;
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
  const left = parseSemanticVersion(leftValue);
  const right = parseSemanticVersion(rightValue);
  if (!left || !right) return null;
  for (const key of ['major', 'minor', 'patch']) {
    if (left[key] !== right[key]) return left[key] < right[key] ? -1 : 1;
  }
  return comparePrerelease(left.prerelease, right.prerelease);
}

export function sanitizeClientInfo(raw) {
  if (!raw || typeof raw !== 'object' || !PLATFORMS.has(raw.platform)) return null;
  const versionText = String(raw.version ?? '').trim().slice(0, 32);
  const version = parseSemanticVersion(versionText) ? versionText.replace(/^v/, '') : null;
  const desktop = raw.platform === 'desktop';
  const portable = desktop && Boolean(raw.portable);
  return {
    platform: raw.platform,
    version,
    portable,
    automaticUpdate: desktop && !portable && Boolean(raw.automaticUpdate),
    updateBridge: desktop && Boolean(raw.updateBridge),
  };
}

export function canManageRemoteUpdates(userId, configuredUserId) {
  return Boolean(configuredUserId) && String(userId) === String(configuredUserId);
}

export function sessionsForUser(socketIds, sessionsBySocket) {
  return [...socketIds].map((socketId) => {
    const stored = sessionsBySocket.get(socketId);
    return stored
      ? { socketId, ...stored.info }
      : {
        socketId,
        platform: null,
        version: null,
        portable: false,
        automaticUpdate: false,
        updateBridge: false,
      };
  });
}

export function selectRemoteUpdateTargets({
  targetUserId,
  selectedSocketIds,
  onlineSocketIds,
  sessionsBySocket,
  currentVersion,
}) {
  const selected = new Set(
    Array.isArray(selectedSocketIds)
      ? selectedSocketIds.map((value) => String(value)).slice(0, 20)
      : [],
  );
  if (selected.size === 0 || !parseSemanticVersion(currentVersion)) return [];

  return [...onlineSocketIds].filter((socketId) => {
    if (!selected.has(socketId)) return false;
    const stored = sessionsBySocket.get(socketId);
    if (!stored || stored.userId !== targetUserId) return false;
    const { info } = stored;
    return info.platform === 'desktop'
      && info.automaticUpdate
      && info.updateBridge
      && compareSemanticVersions(info.version, currentVersion) === -1;
  });
}
