/**
 * Cor "tema" de uma imagem (capa de jogo, ícone de música) - usada pra
 * pintar o cartão de atividade com uma cor que combina com o próprio jogo,
 * em vez de um cinza igual pra todo mundo.
 *
 * Não é média simples de todos os pixels (isso quase sempre dá um cinza
 * lavado, já que ícone/capsule tem bastante fundo branco ou preto) - pixel
 * quase branco, quase preto ou muito transparente é ignorado, sobrando só
 * as cores que a pessoa realmente reconheceria como "a cor do jogo".
 */

const cache = new Map();

function corDaImagem(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const lado = 24; // pequeno de propósito - só a cor importa, não o detalhe
        const tela = document.createElement('canvas');
        tela.width = lado;
        tela.height = lado;
        const ctx = tela.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, lado, lado);
        const { data } = ctx.getImageData(0, 0, lado, lado);

        let r = 0; let g = 0; let b = 0; let n = 0;
        for (let i = 0; i < data.length; i += 4) {
          const [pr, pg, pb, pa] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
          if (pa < 128) continue; // transparente
          const claro = pr > 235 && pg > 235 && pb > 235;
          const escuro = pr < 20 && pg < 20 && pb < 20;
          if (claro || escuro) continue;
          r += pr; g += pg; b += pb; n += 1;
        }

        // Ícone quase todo branco/preto (raro, mas existe) - usa a média de
        // tudo mesmo, sem filtro, em vez de sobrar sem nenhuma cor.
        if (n === 0) {
          for (let i = 0; i < data.length; i += 4) {
            if (data[i + 3] < 128) continue;
            r += data[i]; g += data[i + 1]; b += data[i + 2]; n += 1;
          }
        }
        if (n === 0) return resolve(null);

        resolve(`rgb(${Math.round(r / n)}, ${Math.round(g / n)}, ${Math.round(b / n)})`);
      } catch {
        resolve(null); // getImageData pode recusar em navegador com canvas bloqueado
      }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/** Mesma imagem nunca muda de cor - cacheia pra não reprocessar toda hora. */
export function corTemaDaImagem(src) {
  if (!src) return Promise.resolve(null);
  if (cache.has(src)) return Promise.resolve(cache.get(src));
  return corDaImagem(src).then((cor) => {
    cache.set(src, cor);
    return cor;
  });
}
