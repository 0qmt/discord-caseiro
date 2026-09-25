function primeiraRotaDisponivel(candidates, probe) {
  const routes = [...new Set(candidates)];
  if (routes.length === 0) return Promise.resolve(null);

  return new Promise((resolve) => {
    let pending = routes.length;
    let finished = false;

    const settle = (route) => {
      if (finished) return;
      if (route) {
        finished = true;
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
      Promise.resolve()
        .then(() => probe(route))
        .then((healthy) => settle(healthy ? route : null))
        .catch(() => settle(null));
    }
  });
}

module.exports = { primeiraRotaDisponivel };
