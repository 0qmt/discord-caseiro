import { useEffect, useRef, useState } from 'react';

/** Quanto dura a animação de saída em animacoes.css (.modal-backdrop.saindo). */
const SAIDA_MS = 150;

/**
 * `bare` tira o cabeçalho (título + x): usado quando o conteúdo já deixa
 * óbvio o que é (o cartão de perfil, por exemplo) e uma barra cinza em cima
 * só brigaria com o fundo dele. Sem cabeçalho, clicar fora do modal
 * (no backdrop) vira a única forma de fechar.
 *
 * O fechar passa por aqui, e não direto pro `onClose` de quem chamou, pra
 * dar tempo da animação de saída rodar: marca `.saindo`, espera, e só então
 * desmonta. Como todo modal do app passa por este componente, isso dá saída
 * animada pra todos eles de uma vez - confirmar, perfil, recortar foto,
 * configurações do servidor, reportar bug, convite.
 */
export default function Modal({ title, onClose, children, wide = false, bare = false }) {
  const [saindo, setSaindo] = useState(false);
  const timer = useRef(null);

  useEffect(() => () => clearTimeout(timer.current), []);

  const fechar = () => {
    // Sem essa trava, clicar duas vezes no x agenda dois onClose.
    if (saindo) return;
    setSaindo(true);
    timer.current = setTimeout(onClose, SAIDA_MS);
  };

  return (
    <div
      className={`modal-backdrop ${saindo ? 'saindo' : ''}`}
      onMouseDown={(e) => e.target === e.currentTarget && fechar()}
    >
      <div className={`modal ${wide ? 'largo' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        {!bare && (
          <div className="modal-head">
            <h2>{title}</h2>
            <button className="icon-btn" onClick={fechar} aria-label="Fechar">x</button>
          </div>
        )}
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
