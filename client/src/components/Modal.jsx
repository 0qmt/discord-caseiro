/**
 * `bare` tira o cabeçalho (título + x): usado quando o conteúdo já deixa
 * óbvio o que é (o cartão de perfil, por exemplo) e uma barra cinza em cima
 * só brigaria com o fundo dele. Sem cabeçalho, clicar fora do modal
 * (no backdrop) vira a única forma de fechar.
 */
export default function Modal({ title, onClose, children, wide = false, bare = false }) {
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'largo' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        {!bare && (
          <div className="modal-head">
            <h2>{title}</h2>
            <button className="icon-btn" onClick={onClose} aria-label="Fechar">x</button>
          </div>
        )}
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
