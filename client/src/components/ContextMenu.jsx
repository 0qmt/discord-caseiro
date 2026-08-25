import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';

/**
 * Menu de botão direito genérico.
 *
 * Quem usa monta uma lista de itens declarativa e não se preocupa com posição,
 * fechamento nem teclado:
 *
 *   const menu = useContextMenu();
 *   <li onContextMenu={menu.abrirCom(itensDoMembro(membro))}>...</li>
 *   <ContextMenu estado={menu.estado} onFechar={menu.fechar} />
 *
 * Cada item é `{ label, icone, onClick }`; além disso existem
 * `{ tipo: 'sep' }`, `{ tipo: 'titulo', label }`, `{ tipo: 'slider', ... }` e
 * `{ tipo: 'sub', label, itens: [...] }`.
 */

const MARGEM = 8;

export function useContextMenu() {
  const [estado, setEstado] = useState(null);

  /**
   * Devolve um handler de onContextMenu. Aceita uma lista pronta ou uma
   * função que monta a lista na hora do clique - útil quando os itens
   * dependem de algo que muda (ex.: quem está na call agora).
   */
  const abrirCom = (itens) => (evento) => {
    evento.preventDefault();
    evento.stopPropagation();
    const lista = typeof itens === 'function' ? itens() : itens;
    if (!lista?.length) return;
    setEstado({ x: evento.clientX, y: evento.clientY, itens: lista });
  };

  return { estado, abrirCom, fechar: () => setEstado(null) };
}

/** Mantém o menu inteiro dentro da janela, mesmo aberto perto de uma borda. */
function usePosicaoSegura(estado) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: estado?.x ?? 0, top: estado?.y ?? 0 });

  useLayoutEffect(() => {
    if (!estado || !ref.current) return;
    const caixa = ref.current.getBoundingClientRect();
    const maxX = window.innerWidth - caixa.width - MARGEM;
    const maxY = window.innerHeight - caixa.height - MARGEM;
    setPos({
      left: Math.max(MARGEM, Math.min(estado.x, maxX)),
      top: Math.max(MARGEM, Math.min(estado.y, maxY)),
    });
  }, [estado]);

  return [ref, pos];
}

function Item({ item, onFechar }) {
  if (item.tipo === 'sep') return <div className="ctx-sep" />;
  if (item.tipo === 'titulo') return <div className="ctx-titulo">{item.label}</div>;
  if (item.tipo === 'slider') return <Slider item={item} />;
  if (item.tipo === 'sub') return <Submenu item={item} onFechar={onFechar} />;
  if (item.tipo === 'custom') return item.render();

  return (
    <button
      className={`ctx-item ${item.perigo ? 'perigo' : ''}`}
      disabled={item.desabilitado}
      onClick={() => {
        item.onClick?.();
        // Item que abre outra coisa (um modal, por exemplo) fecha o menu
        // junto; só quem marca `manterAberto` continua.
        if (!item.manterAberto) onFechar();
      }}
    >
      {item.icone && <span className="ctx-icone">{item.icone}</span>}
      <span>{item.label}</span>
      {item.marcado && <Icon name="check" size={13} className="ctx-marca" />}
      {item.atalho && <span className="ctx-atalho">{item.atalho}</span>}
    </button>
  );
}

/**
 * Volume por pessoa. O valor vive fora (no componente que abriu o menu), mas
 * o arrasto é local pra não re-renderizar a árvore inteira a cada pixel.
 */
function Slider({ item }) {
  const [valor, setValor] = useState(item.valor);
  return (
    <div className="ctx-slider">
      <div className="ctx-slider-topo">
        <span>{item.label}</span>
        <span>{valor}%</span>
      </div>
      <input
        type="range"
        min={item.min ?? 0}
        max={item.max ?? 200}
        value={valor}
        onChange={(e) => {
          const novo = Number(e.target.value);
          setValor(novo);
          item.onChange?.(novo);
        }}
      />
    </div>
  );
}

function Submenu({ item, onFechar }) {
  const [aberto, setAberto] = useState(false);
  const [paraEsquerda, setParaEsquerda] = useState(false);
  const ref = useRef(null);

  useLayoutEffect(() => {
    if (!aberto || !ref.current) return;
    const caixa = ref.current.getBoundingClientRect();
    setParaEsquerda(caixa.right > window.innerWidth - MARGEM);
  }, [aberto]);

  return (
    <div className="ctx-sub" onMouseEnter={() => setAberto(true)} onMouseLeave={() => setAberto(false)}>
      <button className="ctx-item" onClick={() => setAberto((v) => !v)}>
        {item.icone && <span className="ctx-icone">{item.icone}</span>}
        <span>{item.label}</span>
        <span className="ctx-seta">›</span>
      </button>
      {aberto && (
        <div ref={ref} className={`ctx-sub-painel ${paraEsquerda ? 'esquerda' : ''}`}>
          {item.itens.map((sub, i) => (
            <Item key={sub.key ?? `${sub.label}-${i}`} item={sub} onFechar={onFechar} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function ContextMenu({ estado, onFechar }) {
  const [ref, pos] = usePosicaoSegura(estado);

  // Esc fecha, e rolar a página também - senão o menu ficaria flutuando
  // solto longe do que foi clicado.
  useEffect(() => {
    if (!estado) return undefined;
    const aoTeclar = (e) => { if (e.key === 'Escape') onFechar(); };
    window.addEventListener('keydown', aoTeclar);
    window.addEventListener('wheel', onFechar, { passive: true });
    window.addEventListener('resize', onFechar);
    return () => {
      window.removeEventListener('keydown', aoTeclar);
      window.removeEventListener('wheel', onFechar);
      window.removeEventListener('resize', onFechar);
    };
  }, [estado, onFechar]);

  if (!estado) return null;

  return (
    <>
      <div className="ctx-backdrop" onClick={onFechar} onContextMenu={(e) => { e.preventDefault(); onFechar(); }} />
      <div ref={ref} className="ctx-menu" style={{ left: pos.left, top: pos.top }} role="menu">
        {estado.itens.map((item, i) => (
          <Item key={item.key ?? `${item.label ?? item.tipo}-${i}`} item={item} onFechar={onFechar} />
        ))}
      </div>
    </>
  );
}
