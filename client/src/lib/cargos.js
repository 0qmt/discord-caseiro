/**
 * Regras de exibição de cargo. Ficam aqui (e não em cada componente) porque
 * a lista de membros, o chat e o cartão de perfil precisam responder
 * exatamente as mesmas perguntas sobre a mesma pessoa.
 */

/** Bits de permissão - espelha PERM do servidor (server/src/lib/permissions.js). */
export const PERM = {
  VER_CANAL: 1 << 0,
  ENVIAR_MENSAGEM: 1 << 1,
  GERENCIAR_MENSAGENS: 1 << 2,
  ANEXAR_ARQUIVOS: 1 << 3,
  MENCIONAR_TODOS: 1 << 4,
  FALAR: 1 << 5,
  OUVIR: 1 << 6,
  TRANSMITIR: 1 << 7,
  SILENCIAR_MEMBROS: 1 << 8,
  ENSURDECER_MEMBROS: 1 << 9,
  MOVER_MEMBROS: 1 << 10,
  GERENCIAR_CANAIS: 1 << 11,
  GERENCIAR_CARGOS: 1 << 12,
  GERENCIAR_SERVIDOR: 1 << 13,
  EXPULSAR: 1 << 14,
  BANIR: 1 << 15,
  CRIAR_CONVITE: 1 << 16,
  GERENCIAR_APELIDOS: 1 << 17,
  ADMINISTRADOR: 1 << 18,
};

/** Nome legível de cada permissão, pra tela de cargos. */
export const NOMES_DE_PERMISSAO = [
  [PERM.VER_CANAL, 'Ver canais'],
  [PERM.ENVIAR_MENSAGEM, 'Enviar mensagens'],
  [PERM.ANEXAR_ARQUIVOS, 'Anexar arquivos'],
  [PERM.GERENCIAR_MENSAGENS, 'Gerenciar mensagens'],
  [PERM.MENCIONAR_TODOS, 'Mencionar @everyone'],
  [PERM.FALAR, 'Falar em call'],
  [PERM.OUVIR, 'Ouvir em call'],
  [PERM.TRANSMITIR, 'Transmitir vídeo e tela'],
  [PERM.SILENCIAR_MEMBROS, 'Silenciar membros'],
  [PERM.ENSURDECER_MEMBROS, 'Ensurdecer membros'],
  [PERM.MOVER_MEMBROS, 'Mover membros de call'],
  [PERM.GERENCIAR_CANAIS, 'Gerenciar canais'],
  [PERM.GERENCIAR_CARGOS, 'Gerenciar cargos'],
  [PERM.GERENCIAR_APELIDOS, 'Gerenciar apelidos'],
  [PERM.EXPULSAR, 'Expulsar membros'],
  [PERM.BANIR, 'Banir membros'],
  [PERM.CRIAR_CONVITE, 'Criar convite'],
  [PERM.GERENCIAR_SERVIDOR, 'Gerenciar servidor'],
  [PERM.ADMINISTRADOR, 'Administrador (libera tudo)'],
];

/** Como a pessoa deve ser chamada neste servidor: apelido ganha do nome. */
export const nomeExibido = (membro) => membro?.nickname || membro?.username || 'alguém';

/**
 * A cor do nome vem do cargo colorido mais alto na hierarquia - cargo sem cor
 * é ignorado, e não "apaga" a cor de um cargo mais baixo (é assim no Discord).
 */
export function corDoMembro(membro, roles) {
  if (!membro?.roles?.length || !roles?.length) return null;
  const meus = roles.filter((r) => membro.roles.includes(r.id) && r.color);
  if (meus.length === 0) return null;
  return meus.reduce((alto, r) => (r.position > alto.position ? r : alto)).color;
}

/** Cargos da pessoa, do mais alto pro mais baixo (pro cartão de perfil). */
export function cargosDoMembro(membro, roles) {
  if (!membro?.roles?.length || !roles?.length) return [];
  return roles
    .filter((r) => membro.roles.includes(r.id) && !r.isDefault)
    .sort((a, b) => b.position - a.position);
}

/**
 * Permissões que a pessoa tem no servidor. É uma cópia da conta do servidor,
 * usada só pra decidir o que MOSTRAR - quem manda de verdade continua sendo o
 * backend, que refaz a checagem em toda ação.
 */
export function permissoesDoMembro(membro, guild) {
  if (!membro || !guild) return 0;
  if (membro.role === 'owner') return ~0;

  const everyone = guild.roles?.find((r) => r.isDefault);
  let bits = everyone?.permissions ?? 0;
  for (const r of guild.roles ?? []) {
    if (membro.roles?.includes(r.id)) bits |= r.permissions;
  }
  if (membro.role === 'admin') bits |= PERM.ADMINISTRADOR;
  return (bits & PERM.ADMINISTRADOR) ? ~0 : bits;
}

export const temPermissao = (membro, guild, bit) => (permissoesDoMembro(membro, guild) & bit) !== 0;

/**
 * Posição mais alta que a pessoa alcança - é o que decide quem pode moderar
 * quem. Espelha highestPosition() do servidor.
 */
export function posicaoDoMembro(membro, guild) {
  if (!membro) return -1;
  if (membro.role === 'owner') return Number.MAX_SAFE_INTEGER;
  const meus = (guild?.roles ?? []).filter((r) => membro.roles?.includes(r.id));
  const maior = meus.reduce((max, r) => Math.max(max, r.position), 0);
  return membro.role === 'admin' ? Math.max(maior, 1) : maior;
}

/** Só dá pra moderar quem está estritamente abaixo de você. */
export function podeAgirSobre(euMembro, alvoMembro, guild) {
  if (!euMembro || !alvoMembro || euMembro.id === alvoMembro.id) return false;
  if (alvoMembro.role === 'owner') return false;
  if (euMembro.role === 'owner') return true;
  return posicaoDoMembro(euMembro, guild) > posicaoDoMembro(alvoMembro, guild);
}
