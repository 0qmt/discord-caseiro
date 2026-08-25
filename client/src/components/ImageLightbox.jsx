import { useCallback, useEffect, useRef, useState } from 'react';
import { copiarImagem } from '../lib/imagem.js';
import { itensDeImagem } from '../lib/menuDeImagem.jsx';
import ContextMenu, { useContextMenu } from './ContextMenu.jsx';
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
  // Mesmo esquema do Modal.jsx: marca `.saindo`, espera a animação de saída
  // (150ms em animacoes.css) e só então desmonta.
  const [saindo, setSaindo] = useState(false);
  const menu = useContextMenu();
  const timer = useRef(null);

  const fechar = useCallback(() => {
    setSaindo((jaSaindo) => {
      if (jaSaindo) return true;
      timer.current = setTimeout(onClose, 150);
      return true;
    });
  }, [onClose]);

  useEffect(() => () => clearTimeout(timer.current), []);

  useEffect(() => {
    const aoTeclar = (e) => { if (e.key === 'Escape') fechar(); };
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [fechar]);

  const aplicarZoom = (delta) => setZoom((z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z + delta)));

  async function copiar() {
    if (await copiarImagem(src)) {
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1500);
    }
  }

  return (
    <div
      className={`lightbox-fundo ${saindo ? 'saindo' : ''}`}
      onClick={fechar}
      onWheel={(e) => aplicarZoom(e.deltaY < 0 ? 0.2 : -0.2)}
    >
      <div className="lightbox-acoes" onClick={(e) => e.stopPropagation()}>
        <button title="Diminuir" onClick={() => aplicarZoom(-0.4)}>−</button>
        <span className="lightbox-zoom-nivel">{Math.round(zoom * 100)}%</span>
        <button title="Aumentar" onClick={() => aplicarZoom(0.4)}>+</button>
        <span className="lightbox-separador" />
        <button title={copiado ? 'Copiado!' : 'Copiar imagem'} onClick={copiar}>
          <Icon name="copy" size={16} />
        </button>
        <a title="Baixar" href={src} download={nome || undefined}>
          <Icon name="arrow-right" size={16} style={{ transform: 'rotate(90deg)' }} />
        </a>
        <a title="Abrir em outra aba" href={src} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
          <Icon name="expand" size={16} />
        </a>
        <button title="Fechar (Esc)" onClick={fechar}><Icon name="x" size={16} /></button>
      </div>
      <img
        className="lightbox-imagem"
        src={src}
        alt={nome ?? ''}
        style={{ transform: `scale(${zoom})` }}
        onClick={(e) => e.stopPropagation()}
        onContextMenu={menu.abrirCom(itensDeImagem({ src, nome }))}
        draggable={false}
      />
      {/* O clique no menu não pode borbulhar: o fundo do visualizador fecha
          no clique, e "Copiar imagem" fecharia a foto junto. */}
      <div className="lightbox-menu" onClick={(e) => e.stopPropagation()}>
        <ContextMenu estado={menu.estado} onFechar={menu.fechar} />
      </div>
    </div>
  );
}
