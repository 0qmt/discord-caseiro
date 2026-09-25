export const SERVER_CANDIDATES = Object.freeze([
  'http://192.168.0.56:3002',
  'https://discord-caseiro.duckdns.org:3001',
  'https://discordia.tail291b3e.ts.net',
]);

export async function findAvailableServer(
  candidates = SERVER_CANDIDATES,
  { fetchImpl = fetch, timeoutMs = 5000 } = {},
) {
  const routes = [...new Set(candidates.map((value) => new URL(value).origin))];
  if (routes.length === 0) return null;

  const controllers = new Set();
  return new Promise((resolve) => {
    let pending = routes.length;
    let finished = false;

    const settle = (route) => {
      if (finished) return;
      if (route) {
        finished = true;
        for (const controller of controllers) controller.abort();
        resolve(route);
        return;
      }
      pending -= 1;
      if (pending === 0) {
        finished = true;
        resolve(null);
      }
    };

    for (const route of routes) {
      const controller = new AbortController();
      controllers.add(controller);
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      Promise.resolve(fetchImpl(new URL('/api/health', `${route}/`), {
        signal: controller.signal,
        cache: 'no-store',
      }))
        .then(async (response) => {
          if (!response.ok) return false;
          const health = await response.json();
          return health?.ok === true;
        })
        .then((healthy) => settle(healthy ? route : null))
        .catch(() => settle(null))
        .finally(() => {
          clearTimeout(timeout);
          controllers.delete(controller);
        });
    }
  });
}
