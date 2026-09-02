import { nomeExibido } from './cargos.js';

const ALIAS_TODOS = ['everyone', 'all', 'todos'];
const normalizar = (valor) => String(valor ?? '').trim().toLocaleLowerCase('pt-BR');

const nomesDoMembro = (membro) => [membro?.username, membro?.nickname, membro?.handle]
  .filter(Boolean)
  .map(normalizar);

/**
 * Compatibilidade com mensagens digitadas sem usar o seletor. Só converte
 * quando o nome identifica exatamente uma pessoa; nomes iguais ficam como
 * texto comum para nunca apontar silenciosamente para o ID errado.
 */
export function codificarMencoes(texto, membros) {
  return String(texto ?? '').replace(/(?<!<)@([\p{L}\p{N}_.-]+)/gu, (bruto, nome) => {
    if (ALIAS_TODOS.includes(normalizar(nome))) return '<@everyone>';
    const encontrados = (membros ?? []).filter((membro) => nomesDoMembro(membro).includes(normalizar(nome)));
    return encontrados.length === 1 ? `<@${encontrados[0].id}>` : bruto;
  });
}

/** Consulta de autocomplete imediatamente antes do cursor. */
export function encontrarConsultaMencao(texto, cursor = String(texto ?? '').length) {
  const antes = String(texto ?? '').slice(0, cursor);
  const match = antes.match(/(?:^|\s)@([\p{L}\p{N}_.-]*)$/u);
  if (!match) return null;
  const inicio = cursor - match[1].length - 1;
  return { inicio, fim: cursor, termo: match[1] };
}

/**
 * Reposiciona entidades depois de uma edição no textarea. Se a edição toca
 * no texto visível de uma menção, ela deixa de ser entidade e volta a ser
 * texto normal. Inserções antes/depois apenas deslocam seus índices.
 */
export function ajustarMencoesAposEdicao(anterior, proximo, entidades) {
  const antes = String(anterior ?? '');
  const depois = String(proximo ?? '');
  let prefixo = 0;
  while (prefixo < antes.length && prefixo < depois.length && antes[prefixo] === depois[prefixo]) prefixo += 1;

  let sufixo = 0;
  while (
    sufixo < antes.length - prefixo
    && sufixo < depois.length - prefixo
    && antes[antes.length - 1 - sufixo] === depois[depois.length - 1 - sufixo]
  ) sufixo += 1;

  const fimAntigo = antes.length - sufixo;
  const fimNovo = depois.length - sufixo;
  const delta = fimNovo - fimAntigo;

  return (entidades ?? []).flatMap((entidade) => {
    if (entidade.fim <= prefixo) return [entidade];
    if (entidade.inicio >= fimAntigo) {
      return [{ ...entidade, inicio: entidade.inicio + delta, fim: entidade.fim + delta }];
    }
    return [];
  });
}

/** Insere tokens pelos IDs escolhidos e usa o fallback único no texto restante. */
export function codificarMencoesComEntidades(texto, entidades, membros) {
  let resultado = String(texto ?? '');
  const validas = (entidades ?? [])
    .filter((entidade) => resultado.slice(entidade.inicio, entidade.fim) === entidade.rotulo)
    .sort((a, b) => b.inicio - a.inicio);

  for (const entidade of validas) {
    const token = entidade.userId === 'everyone' ? '<@everyone>' : `<@${entidade.userId}>`;
    resultado = `${resultado.slice(0, entidade.inicio)}${token}${resultado.slice(entidade.fim)}`;
  }
  return codificarMencoes(resultado, membros);
}

/** Remove espaços externos sem perder os offsets das entidades escolhidas. */
export function codificarRascunho(texto, entidades, membros) {
  const original = String(texto ?? '');
  const inicio = original.search(/\S/);
  if (inicio < 0) return '';
  const fim = original.search(/\s*$/);
  const recorte = original.slice(inicio, fim);
  const ajustadas = (entidades ?? [])
    .filter((entidade) => entidade.inicio >= inicio && entidade.fim <= fim)
    .map((entidade) => ({
      ...entidade,
      inicio: entidade.inicio - inicio,
      fim: entidade.fim - inicio,
    }));
  return codificarMencoesComEntidades(recorte, ajustadas, membros);
}

/** Abre uma mensagem codificada no editor mantendo cada ID associado ao texto. */
export function decodificarMencoesParaEdicao(content, membros) {
  const entidades = [];
  const texto = String(content ?? '').replace(/<@([a-zA-Z0-9]+|everyone)>/g, (token, userId, offset) => {
    const alvo = userId === 'everyone' ? null : (membros ?? []).find((m) => m.id === userId);
    const rotulo = `@${userId === 'everyone' ? 'everyone' : nomeExibido(alvo)}`;
    const deslocamento = entidades.reduce(
      (total, entidade) => total + entidade.rotulo.length - entidade.tokenLength,
      0,
    );
    const inicio = offset + deslocamento;
    entidades.push({ userId, rotulo, inicio, fim: inicio + rotulo.length, tokenLength: token.length });
    return rotulo;
  });
  return {
    texto,
    entidades: entidades.map(({ tokenLength, ...entidade }) => entidade),
  };
}

/** true se essa mensagem te marcou (direto ou por @everyone). */
export function mensagemMenciona(content, meuId) {
  if (!content) return false;
  return content.includes('<@everyone>') || content.includes(`<@${meuId}>`);
}

/** Volta <@id>/<@everyone> pra @nome legível em notificações do sistema. */
export function textoLegivel(content, membros) {
  if (!content) return content;
  return content
    .replace(/<@everyone>/g, '@everyone')
    .replace(/<@([a-zA-Z0-9]+)>/g, (_, id) => `@${nomeExibido(membros?.find((m) => m.id === id))}`);
}
