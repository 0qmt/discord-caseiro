/**
 * Transforma um recorte em porcentagem (o que o react-easy-crop entrega) em
 * estilo CSS que enquadra a imagem dentro de um contêiner de tamanho fixo.
 *
 * É assim que GIF e WebP animado continuam animando: a imagem original é
 * escalada e deslocada com CSS em vez de ser cortada num canvas, que só
 * copiaria o primeiro quadro.
 *
 * Confira com o caso trivial: recorte de 100% em (0,0) devolve 100% de largura
 * e deslocamento zero, ou seja, a imagem inteira.
 */
export function cropStyle(crop) {
  if (!crop) return undefined;
  return {
    position: 'absolute',
    maxWidth: 'none',
    width: `${10000 / crop.width}%`,
    height: `${10000 / crop.height}%`,
    left: `${(-crop.x * 100) / crop.width}%`,
    top: `${(-crop.y * 100) / crop.height}%`,
  };
}
