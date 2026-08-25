import { useEffect, useRef, useState } from 'react';
import { coresRecentes, corValida, guardarCorRecente, hexParaHsv, hsvParaHex } from '../lib/cor.js';
import Icon from './Icon.jsx';

/**
 * Seletor de cor no molde do Discord: quadrado de saturação/brilho, barra de
 * matiz, campo hex e as últimas cores usadas. Chama `onEscolher` a cada
 * mudança (o botão que abriu isto já mostra a cor mudando ao vivo, sem
 * precisar de um botão "aplicar" separado).
 */
export default function ColorPicker({ valor, onEscolher, onFechar }) {
  const [hsv, setHsv] = useState(() => hexParaHsv(valor));
  const [hexDigitado, setHexDigitado] = useState(valor ?? '#000000');
  const svRef = useRef(null);
  const hueRef = useRef(null);
  const arrastando = useRef(null); // 'sv' | 'hue' | null

  useEffect(() => { setHexDigitado(hsvParaHex(hsv)); }, [hsv]);

  function aplicar(novoHsv) {
    setHsv(novoHsv);
    onEscolher(hsvParaHex(novoHsv));
  }

  function moverSv(clientX, clientY) {
    const el = svRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const s = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    const v = Math.min(1, Math.max(0, 1 - (clientY - r.top) / r.height));
    aplicar({ ...hsv, s, v });
  }

  function moverHue(clientX) {
    const el = hueRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const h = Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * 360;
    aplicar({ ...hsv, h });
  }

  useEffect(() => {
    function aoMover(e) {
      if (!arrastando.current) return;
      const p = e.touches?.[0] ?? e;
      if (arrastando.current === 'sv') moverSv(p.clientX, p.clientY);
      else moverHue(p.clientX);
    }
    function aoSoltar() { arrastando.current = null; }
    window.addEventListener('mousemove', aoMover);
    window.addEventListener('mouseup', aoSoltar);
    window.addEventListener('touchmove', aoMover);
    window.addEventListener('touchend', aoSoltar);
    return () => {
      window.removeEventListener('mousemove', aoMover);
      window.removeEventListener('mouseup', aoSoltar);
      window.removeEventListener('touchmove', aoMover);
      window.removeEventListener('touchend', aoSoltar);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hsv]);

  function confirmarHex(texto) {
    setHexDigitado(texto);
    const normalizado = texto.startsWith('#') ? texto : `#${texto}`;
    if (corValida(normalizado)) aplicar(hexParaHsv(normalizado));
  }

  function fechar() {
    guardarCorRecente(hsvParaHex(hsv));
    onFechar();
  }

  const corPura = hsvParaHex({ h: hsv.h, s: 1, v: 1 });
  const recentes = coresRecentes();

  return (
    <div className="color-picker" onMouseDown={(e) => e.stopPropagation()}>
      <div
        ref={svRef}
        className="color-picker-sv"
        style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${corPura})` }}
        onMouseDown={(e) => { arrastando.current = 'sv'; moverSv(e.clientX, e.clientY); }}
        onTouchStart={(e) => { arrastando.current = 'sv'; moverSv(e.touches[0].clientX, e.touches[0].clientY); }}
      >
        <div
          className="color-picker-alca"
          style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: hsvParaHex(hsv) }}
        />
      </div>

      <div
        ref={hueRef}
        className="color-picker-hue"
        onMouseDown={(e) => { arrastando.current = 'hue'; moverHue(e.clientX); }}
        onTouchStart={(e) => { arrastando.current = 'hue'; moverHue(e.touches[0].clientX); }}
      >
        <div className="color-picker-alca-hue" style={{ left: `${(hsv.h / 360) * 100}%` }} />
      </div>

      <div className="color-picker-hex">
        <span>#</span>
        <input
          value={hexDigitado.replace(/^#/, '')}
          onChange={(e) => confirmarHex(e.target.value)}
          maxLength={6}
          spellCheck={false}
        />
        <label className="color-picker-conta-gotas" title="Escolher da tela">
          <input
            type="color"
            value={hsvParaHex(hsv)}
            onChange={(e) => aplicar(hexParaHsv(e.target.value))}
          />
          <Icon name="palette" size={15} />
        </label>
      </div>

      {recentes.length > 0 && (
        <div className="color-picker-recentes">
          {recentes.map((c) => (
            <button
              key={c}
              type="button"
              className="color-picker-swatch"
              style={{ background: c }}
              title={c}
              onClick={() => aplicar(hexParaHsv(c))}
            />
          ))}
        </div>
      )}

      <button type="button" className="color-picker-ok primary" onClick={fechar}>Pronto</button>
    </div>
  );
}
