/**
 * Regras de endereço do servidor. Sem nada do Electron aqui de propósito:
 * assim dá pra testar com node puro.
 */

/** Normaliza o que a pessoa digitou: "192.168.0.10:3001" vira uma URL válida. */
function normalizarEndereco(bruto) {
  const texto = String(bruto ?? '').trim();
  if (!texto) return null;

  const comEsquema = /^https?:\/\//i.test(texto) ? texto : `http://${texto}`;
  let url;
  try {
    url = new URL(comEsquema);
  } catch {
    return null;
  }
  // O parser de URL e permissivo demais: "ht!tp://??" viraria um endereco
  // bobo em vez de ser recusado. So aceitamos hostname plausivel.
  const hostSimples = /^[a-z0-9.-]+$/i.test(url.hostname);
  const hostIPv6 = /^\[[0-9a-f:]+\]$/i.test(url.hostname);
  if (!hostSimples && !hostIPv6) return null;
  // Sem porta explícita, assumimos a porta padrão do backend.
  if (!url.port && url.protocol === 'http:') url.port = '3001';
  // Guardamos só a origem: caminho e query não interessam aqui.
  return url.origin;
}

const LOCAIS = ['localhost', '127.0.0.1', '::1', '[::1]'];

/**
 * Endereços http que não são localhost não contam como "contexto seguro", e o
 * Chromium bloqueia microfone, câmera e captura de tela neles. Dentro do
 * Electron dá pra liberar a origem do servidor caseiro explicitamente - é o que
 * evita seus amigos terem que mexer em flag de navegador.
 */
function precisaLiberarOrigemInsegura(serverUrl) {
  if (!serverUrl) return false;
  try {
    const url = new URL(serverUrl);
    if (url.protocol !== 'http:') return false;
    return !LOCAIS.includes(url.hostname);
  } catch {
    return false;
  }
}

function mesmaOrigem(a, b) {
  if (!a || !b) return false;
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

module.exports = { normalizarEndereco, precisaLiberarOrigemInsegura, mesmaOrigem };
