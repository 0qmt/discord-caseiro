const DEFAULT_SERVER_URL = String(import.meta.env.VITE_SERVER_URL ?? '').trim();

let serverUrl = normalizeServerUrl(DEFAULT_SERVER_URL);

function normalizeServerUrl(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw.includes('://') ? raw : `http://${raw}`);
    return parsed.origin;
  } catch {
    return '';
  }
}

export function configureServerUrl(value) {
  serverUrl = normalizeServerUrl(value);
  return serverUrl;
}

export function getServerUrl() {
  return serverUrl;
}

export function serverPath(path) {
  if (!serverUrl) return path;
  return new URL(path, `${serverUrl}/`).toString();
}

export function serverAsset(value) {
  if (typeof value !== 'string' || !value) return value;
  if (value.startsWith('/')) return serverPath(value);
  const base = getServerUrl();
  if (!base) return value;
  try {
    const parsed = new URL(value);
    if (parsed.pathname.startsWith('/uploads/')) {
      return new URL(`${parsed.pathname}${parsed.search}${parsed.hash}`, `${base}/`).toString();
    }
  } catch {
    return value;
  }
  return value;
}

export function serverRelativeAsset(value) {
  if (typeof value !== 'string') return value;
  if (value.startsWith('/uploads/')) return value;
  const base = getServerUrl();
  if (!base) return value;
  try {
    const parsed = new URL(value);
    return parsed.origin === base && parsed.pathname.startsWith('/uploads/')
      ? `${parsed.pathname}${parsed.search}${parsed.hash}`
      : value;
  } catch {
    return value;
  }
}

export function attachmentForServer(attachment) {
  if (!attachment || typeof attachment !== 'object') return attachment;
  return {
    ...attachment,
    url: serverRelativeAsset(attachment.url),
  };
}

/**
 * URLs de upload chegam relativas porque no navegador o cliente e o servidor
 * compartilham a origem. No APK, convertemos somente recursos do servidor;
 * links escritos por usuarios e URLs externas permanecem intactos.
 */
export function normalizeServerData(value) {
  if (Array.isArray(value)) return value.map(normalizeServerData);
  if (!value || typeof value !== 'object') {
    return typeof value === 'string' && (value.startsWith('/uploads/') || value.includes('/uploads/'))
      ? serverAsset(value)
      : value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, normalizeServerData(item)]),
  );
}
