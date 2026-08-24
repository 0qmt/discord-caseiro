const ALIAS_TODOS = ['everyone', 'all', 'todos'];

/**
 * Troca @nome (do jeito que a pessoa digitou, legível) por <@id> - só quando
 * bate com um membro de verdade do servidor, senão deixa o texto como
 * digitado. @all/@everyone/@todos viram o mesmo token, "marcar todo mundo".
 * É essa forma codificada que fica salva e é ela que a gente confere pra
 * saber quem foi marcado (não dá pra confiar em "parece um @nome").
 */
export function codificarMencoes(texto, membros) {
  return texto.replace(/@([\p{L}\p{N}_]+)/gu, (bruto, nome) => {
    if (ALIAS_TODOS.includes(nome.toLowerCase())) return '<@everyone>';
    const membro = membros?.find((m) => m.username.toLowerCase() === nome.toLowerCase());
    return membro ? `<@${membro.id}>` : bruto;
  });
}

/** true se essa mensagem te marcou (direto ou por @everyone). */
export function mensagemMenciona(content, meuId) {
  if (!content) return false;
  return content.includes('<@everyone>') || content.includes(`<@${meuId}>`);
}

/** Volta <@id>/<@everyone> pra @nome legível - pra notificação, que só mostra texto puro. */
export function textoLegivel(content, membros) {
  if (!content) return content;
  return content
    .replace(/<@everyone>/g, '@everyone')
    .replace(/<@([a-zA-Z0-9]+)>/g, (_, id) => `@${membros?.find((m) => m.id === id)?.username ?? 'alguém'}`);
}
