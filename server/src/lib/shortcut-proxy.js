import http from 'node:http';

const UPSTREAM_HOST = process.env.SHORTCUT_UPSTREAM_HOST || 'pepo-telegram-downloads_server_1';
const UPSTREAM_PORT = Number(process.env.SHORTCUT_UPSTREAM_PORT || 8080);
const ALLOWED_POST_PATHS = new Set(['/api/shortcut/download', '/api/shortcut/inspect', '/api/shortcut/auto']);
const FILE_PREFIX = '/api/shortcut/files/';
const TIMEOUT_MS = 13 * 60 * 1000;

const responseHeaders = new Set([
  'content-type',
  'content-length',
  'content-disposition',
  'cache-control',
  'x-content-type-options',
  'x-pepo-media-count',
  'x-pepo-media-index',
  'x-pepo-expires-in',
  'server-timing',
]);

function jsonError(res, status, error, message) {
  if (res.headersSent) return res.destroy();
  res.status(status).json({ error, message });
}

export function shortcutDownloadProxy(req, res) {
  const pathname = new URL(req.originalUrl || req.url, 'http://localhost').pathname;
  const isFile = pathname.startsWith(FILE_PREFIX);
  const method = isFile ? 'GET' : 'POST';
  if (req.method !== method) {
    res.set('Allow', method);
    return jsonError(res, 405, 'method_not_allowed', `Use ${method}.`);
  }
  const upstreamPath = ALLOWED_POST_PATHS.has(pathname) || isFile ? pathname : null;
  if (!upstreamPath) return jsonError(res, 404, 'not_found', 'Não encontrado.');

  const headers = {
    authorization: req.headers.authorization || '',
    'content-type': req.headers['content-type'] || '',
    'content-length': req.headers['content-length'] || '',
    'x-forwarded-for': req.ip,
    'x-forwarded-host': req.get('host') || '',
    'x-forwarded-proto': req.protocol,
  };
  for (const [name, value] of Object.entries(headers)) {
    if (!value) delete headers[name];
  }

  const upstream = http.request({
    hostname: UPSTREAM_HOST,
    port: UPSTREAM_PORT,
    path: upstreamPath,
    method,
    headers,
    timeout: TIMEOUT_MS,
  }, (upstreamResponse) => {
    res.status(upstreamResponse.statusCode || 502);
    for (const [name, value] of Object.entries(upstreamResponse.headers)) {
      if (responseHeaders.has(name) && value !== undefined) res.set(name, value);
    }
    upstreamResponse.on('error', (error) => {
      console.error('[shortcut-proxy] resposta interrompida:', error.message);
      if (!res.writableEnded) res.destroy();
    });
    upstreamResponse.pipe(res);
  });

  upstream.on('timeout', () => upstream.destroy(new Error('timeout')));
  upstream.on('error', (error) => {
    console.error('[shortcut-proxy] falha ao acessar PepoDownload:', error.message);
    jsonError(res, error.message === 'timeout' ? 504 : 502, 'upstream_unavailable', 'O serviço de download está temporariamente indisponível.');
  });
  req.on('aborted', () => upstream.destroy());
  req.pipe(upstream);
}
