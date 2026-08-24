// Casa http(s)://..., www.... e os tokens de menção (<@id> / <@everyone>) na
// mesma passada - assim um não atropela o outro por acidente.
const TOKEN_REGEX = /(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+|<@everyone>|<@[a-zA-Z0-9]+>)/g;

/**
 * Quebra um texto em pedaços string/link/menção, pra renderizar como React
 * sem dangerouslySetInnerHTML. Link vira { href, texto }; menção vira
 * { mencao: 'everyone' | idDoUsuario }.
 */
export function linkify(texto) {
  const partes = [];
  let ultimoIndice = 0;

  for (const encontro of texto.matchAll(TOKEN_REGEX)) {
    let bruto = encontro[0];
    const indice = encontro.index;

    if (bruto.startsWith('<@')) {
      if (indice > ultimoIndice) partes.push(texto.slice(ultimoIndice, indice));
      partes.push({ mencao: bruto === '<@everyone>' ? 'everyone' : bruto.slice(2, -1) });
      ultimoIndice = indice + bruto.length;
      continue;
    }

    // Pontuação comum de fim de frase não faz parte do link.
    const sobra = bruto.match(/[.,!?;:)\]]+$/)?.[0] ?? '';
    if (sobra) bruto = bruto.slice(0, -sobra.length);
    if (!bruto) continue;

    if (indice > ultimoIndice) partes.push(texto.slice(ultimoIndice, indice));
    partes.push({ href: bruto.startsWith('www.') ? `https://${bruto}` : bruto, texto: bruto });
    ultimoIndice = indice + bruto.length;
  }

  if (ultimoIndice < texto.length) partes.push(texto.slice(ultimoIndice));
  return partes;
}
