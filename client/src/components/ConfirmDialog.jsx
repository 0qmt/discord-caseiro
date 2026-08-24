import Modal from './Modal.jsx';

/** Confirmação genérica pra qualquer ação que vale a pena parar e perguntar. */
export default function ConfirmDialog({
  title, message, confirmLabel = 'Confirmar', perigo = true, onConfirm, onCancel,
}) {
  return (
    <Modal title={title} onClose={onCancel}>
      <p className="hint">{message}</p>
      <div className="modal-actions">
        <button onClick={onCancel}>Cancelar</button>
        <button className={`primary ${perigo ? 'perigo' : ''}`} onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
