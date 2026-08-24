import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

const ATRASO_BUSCA_MS = 350;

/** Popover de busca de GIF (Giphy) — fecha sozinho ao clicar fora. */
export default function GifPicker({ onEscolher, onFechar }) {
  const [termo, setTermo] = useState('');
  const [gifs, setGifs] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(null);
  const popoverRef = useRef(null);

  useEffect(() => {
    const aoClicarFora = (e) => {
      if (!popoverRef.current?.contains(e.target)) onFechar();
    };
    document.addEventListener('mousedown', aoClicarFora);
    return () => document.removeEventListener('mousedown', aoClicarFora);
  }, [onFechar]);

  useEffect(() => {
    setCarregando(true);
    setErro(null);
    let cancelado = false;

    const timer = setTimeout(() => {
      const busca = termo.trim() ? api.gifsBuscar(termo.trim()) : api.gifsTrending();
      busca
        .then(({ gifs: lista }) => { if (!cancelado) setGifs(lista); })
        .catch((e) => { if (!cancelado) setErro(e.message); })
        .finally(() => { if (!cancelado) setCarregando(false); });
    }, termo.trim() ? ATRASO_BUSCA_MS : 0);

    return () => { cancelado = true; clearTimeout(timer); };
  }, [termo]);

  return (
    <div className="gif-picker" ref={popoverRef}>
      <input
        className="gif-picker-busca"
        placeholder="Buscar GIF..."
        value={termo}
        onChange={(e) => setTermo(e.target.value)}
        autoFocus
      />

      {erro && <p className="hint">Busca de GIF indisponível agora.</p>}
      {!erro && carregando && <p className="hint">Carregando...</p>}
      {!erro && !carregando && gifs.length === 0 && <p className="hint">Nada encontrado.</p>}

      <div className="gif-picker-grade">
        {gifs.map((g) => (
          <button key={g.id} className="gif-picker-item" onClick={() => onEscolher(g)} title="Enviar">
            <img src={g.previewUrl} alt="" loading="lazy" />
          </button>
        ))}
      </div>
    </div>
  );
}
