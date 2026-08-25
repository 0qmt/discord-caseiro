import { useEffect, useState } from 'react';
import Icon from './Icon.jsx';

const ZOOM_MIN = 1;
const ZOOM_MAX = 4;

/**
 * Visualizador de imagem em tela cheia, tipo o do Discord: zoom na roda do
 * mouse, baixar, copiar e abrir em outra aba. Sem biblioteca nenhuma - é só
 * um <img> com scale, a imagem real controla o tamanho base.
 */
export default function ImageLightbox({ src, nome, onClose }) {
  const [zoom, setZoom] = useState(1);
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    const aoTeclar = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [onClose]);

  const aplicarZoom = (delta) => setZoom((z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z + delta)));

  async function copiarImagem() {
    try {
      const resposta = await fetch(src);
      const blob = await resposta.blob();
      // Clipboard de imagem só aceita png - a maioria das imagens do chat já
      // é isso, mas gif/jpg precisa passar por um canvas antes.
      const blobPng = blob.type === 'image/png' ? blob : await converterParaPng(blob);
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blobPng })]);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1500);
    } catch {
      // Navegador sem suporte ou permissão negada - sem erro visível, só não copia.
    }
  }

  function converterParaPng(blob) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        canvas.getContext('2d').drawImage(img, 0, 0);
        canvas.toBlob((png) => (png ? resolve(png) : reject()), 'image/png');
      };
      img.onerror = reject;
      img.src = URL.createObjectURL(blob);
    });
  }

  return (
    <div className="lightbox-fundo" onClick={onClose} onWheel={(e) => aplicarZoom(e.deltaY < 0 ? 0.2 : -0.2)}>
      <div className="lightbox-acoes" onClick={(e) => e.stopPropagation()}>
        <button title="Diminuir" onClick={() => aplicarZoom(-0.4)}>−</button>
        <span className="lightbox-zoom-nivel">{Math.round(zoom * 100)}%</span>
        <button title="Aumentar" onClick={() => aplicarZoom(0.4)}>+</button>
        <span className="lightbox-separador" />
        <button title={copiado ? 'Copiado!' : 'Copiar imagem'} onClick={copiarImagem}>
          <Icon name="copy" size={16} />
        </button>
        <a title="Baixar" href={src} download={nome || undefined}>
          <Icon name="arrow-right" size={16} style={{ transform: 'rotate(90deg)' }} />
        </a>
        <a title="Abrir em outra aba" href={src} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
          <Icon name="expand" size={16} />
        </a>
        <button title="Fechar (Esc)" onClick={onClose}><Icon name="x" size={16} /></button>
      </div>
      <img
        className="lightbox-imagem"
        src={src}
        alt={nome ?? ''}
        style={{ transform: `scale(${zoom})` }}
        onClick={(e) => e.stopPropagation()}
        draggable={false}
      />
    </div>
  );
}
