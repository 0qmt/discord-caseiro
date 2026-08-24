/**
 * Decide se uma mensagem vira notificação na tela.
 *
 * Junta três coisas que o usuário controla em lugares diferentes:
 *  - o status dele ("não perturbe" cala tudo);
 *  - o nível do canal, que ganha do nível do servidor;
 *  - o silêncio temporário ("silenciar por 1h").
 *
 * Fica separado do App porque a regra é chata o suficiente pra merecer teste
 * próprio, e porque canal e DM fazem a mesma pergunta de jeitos diferentes.
 */

export const NIVEIS = [
  { id: 'all', label: 'Tudo' },
  { id: 'mentions', label: 'Só menções' },
  { id: 'none', label: 'Nada' },
];

export const DURACOES_DE_SILENCIO = [
  { label: '15 minutos', ms: 15 * 60 * 1000 },
  { label: '1 hora', ms: 60 * 60 * 1000 },
  { label: '8 horas', ms: 8 * 60 * 60 * 1000 },
  { label: '24 horas', ms: 24 * 60 * 60 * 1000 },
  { label: 'Até eu reativar', ms: null },
];

/** Silêncio "até eu reativar" é guardado como uma data absurdamente longe. */
export const PARA_SEMPRE = 8640000000000000;

export const chaveDe = (scopeType, scopeId) => `${scopeType}:${scopeId}`;

/** Configuração efetiva de um escopo, com o padrão quando não há nenhuma. */
export const configDe = (settings, scopeType, scopeId) =>
  settings[chaveDe(scopeType, scopeId)] ?? { level: 'all', mutedUntil: null };

const estaSilenciado = (config) => Boolean(config.mutedUntil && config.mutedUntil > Date.now());

/**
 * `status` é o status escolhido pela pessoa; `ehMencao` diz se ela foi marcada
 * de verdade (@nome ou @everyone), que é o que fura o nível "só menções".
 */
export function deveNotificar({ settings, status, guildId, channelId, dmChannelId, ehMencao }) {
  // "Não perturbe" é o mais forte de todos - nem menção passa.
  if (status === 'dnd') return false;

  if (dmChannelId) {
    const config = configDe(settings, 'dm', dmChannelId);
    if (estaSilenciado(config)) return false;
    if (config.level === 'none') return false;
    if (config.level === 'mentions') return Boolean(ehMencao);
    return true;
  }

  const doServidor = configDe(settings, 'guild', guildId);
  const doCanal = configDe(settings, 'channel', channelId);

  // Silêncio de qualquer um dos dois níveis já basta pra calar.
  if (estaSilenciado(doServidor) || estaSilenciado(doCanal)) return false;

  // O canal manda quando tem configuração própria; senão herda o servidor.
  const temConfigDeCanal = Boolean(settings[chaveDe('channel', channelId)]);
  const nivel = temConfigDeCanal ? doCanal.level : doServidor.level;

  if (nivel === 'none') return false;
  if (nivel === 'mentions') return Boolean(ehMencao);
  return true;
}
