import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { linkify } from '../lib/linkify.js';

/** Cache simples em memória: mesma URL não busca de novo ao rolar o chat. */
const cache = new Map();

/**
 * Preview de link igual o Discord: pega o primeiro link de verdade da
 * mensagem (não conta menção/spoiler) e busca título/descrição/imagem no
 * servidor (que lê as tags og: da página - ver server/src/routes/embed.js).
 * Se a página não tiver nada disso, ou a busca falhar, some sem erro - nem
 * toda mensagem com link precisa de cartão embaixo.
 */
export default function LinkPreview({ texto }) {
  const primeiroLink = linkify(texto ?? '').find((p) => typeof p === 'object' && p.href)?.href;
  const [embed, setEmbed] = useState(() => (primeiroLink ? cache.get(primeiroLink) : undefined));

  useEffect(() => {
    if (!primeiroLink || cache.has(primeiroLink)) return;
    let vivo = true;
    api.getEmbed(primeiroLink)
      .then(({ embed: dado }) => { cache.set(primeiroLink, dado); if (vivo) setEmbed(dado); })
      .catch(() => { cache.set(primeiroLink, null); if (vivo) setEmbed(null); });
    return () => { vivo = false; };
  }, [primeiroLink]);

  if (!primeiroLink || !embed) return null;

  return (
    <a className="link-preview" href={embed.url} target="_blank" rel="noreferrer noopener">
      <span className="link-preview-site">{embed.site}</span>
      {embed.titulo && <strong className="link-preview-titulo">{embed.titulo}</strong>}
      {embed.descricao && <p className="link-preview-descricao">{embed.descricao}</p>}
      {embed.imagem && <img className="link-preview-imagem" src={embed.imagem} alt="" loading="lazy" />}
    </a>
  );
}
