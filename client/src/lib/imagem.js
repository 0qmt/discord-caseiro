/**
 * Copiar e baixar imagem.
 *
 * Mora aqui, e não dentro do visualizador, porque o menu de botão direito da
 * foto no chat oferece as mesmas ações - duas cópias da conversão pra PNG
 * seria o tipo de coisa que conserta num lugar só e continua quebrada no
 * outro.
 */

/**
 * O clipboard de imagem do navegador só aceita PNG. A maioria das imagens do
 * chat já é PNG, mas GIF e JPG precisam passar por um canvas antes - e no
 * caso do GIF isso significa copiar só o primeiro quadro, que é o melhor que
 * a API permite.
 */
function converterParaPng(blob) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext('2d').drawImage(img, 0, 0);
      canvas.toBlob((png) => (png ? resolve(png) : reject(new Error('canvas vazio'))), 'image/png');
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(blob);
  });
}

/** Copia a imagem pro clipboard. Devolve se deu certo, sem estourar erro. */
export async function copiarImagem(src) {
  try {
    const blob = await (await fetch(src)).blob();
    const png = blob.type === 'image/png' ? blob : await converterParaPng(blob);
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
    return true;
  } catch {
    // Navegador sem suporte, sem permissão, ou imagem de outra origem.
    return false;
  }
}

/**
 * Baixa a imagem.
 *
 * Passa por blob em vez de só apontar o <a download> pra URL: com a imagem
 * vindo de outra origem (o servidor de uploads), o atributo `download` é
 * ignorado e o navegador abre numa aba em vez de salvar.
 */
export async function baixarImagem(src, nome) {
  try {
    const blob = await (await fetch(src)).blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nome || src.split('/').pop() || 'imagem';
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Sem revogar, o blob fica na memória até a aba fechar.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  } catch {
    return false;
  }
}

/** URL absoluta da imagem, pra copiar ou abrir em outra aba. */
export const urlAbsoluta = (src) => new URL(src, window.location.origin).href;
