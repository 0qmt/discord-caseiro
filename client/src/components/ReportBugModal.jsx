import { useState } from 'react';
import { api } from '../api.js';
import Modal from './Modal.jsx';

const MAX_IMAGENS = 5;

/**
 * Reportar um bug: vira ao mesmo tempo uma DM de verdade pro dono do
 * servidor e um arquivo salvo no servidor (pra quem for mexer no código
 * depois já ter o relato certinho, sem precisar reconstruir do zero pelo
 * que a pessoa lembra de ter acontecido).
 */
export default function ReportBugModal({ onClose }) {
  const [title, setTitle] = useState('');
  const [whatHappens, setWhatHappens] = useState('');
  const [whatStopsWorking, setWhatStopsWorking] = useState('');
  const [howToFix, setHowToFix] = useState('');
  const [images, setImages] = useState([]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [enviado, setEnviado] = useState(false);

  function escolherImagens(e) {
    const novas = [...e.target.files].slice(0, MAX_IMAGENS - images.length);
    setImages((prev) => [...prev, ...novas].slice(0, MAX_IMAGENS));
  }

  async function enviar(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.reportarBug({
        title: title.trim(), whatHappens: whatHappens.trim(),
        whatStopsWorking: whatStopsWorking.trim(), howToFix: howToFix.trim(), images,
      });
      setEnviado(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (enviado) {
    return (
      <Modal title="Reportar um problema" onClose={onClose}>
        <p className="hint">Reportado! Chegou na DM de quem administra o servidor.</p>
        <button className="primary" onClick={onClose}>Fechar</button>
      </Modal>
    );
  }

  return (
    <Modal title="Reportar um problema" onClose={onClose}>
      <form onSubmit={enviar}>
        <label>
          Nome do problema
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={120}
            placeholder="Ex.: som corta na chamada"
            required
            autoFocus
          />
        </label>

        <label>
          O que está acontecendo
          <textarea
            value={whatHappens}
            onChange={(e) => setWhatHappens(e.target.value)}
            rows={3}
            placeholder="Descreva o que você vê de errado"
            required
          />
        </label>

        <label>
          O que deveria acontecer (ou o que parou de funcionar)
          <textarea
            value={whatStopsWorking}
            onChange={(e) => setWhatStopsWorking(e.target.value)}
            rows={3}
            placeholder="O que era pra ter acontecido no lugar"
            required
          />
        </label>

        <label>
          Como pode ser resolvido <span className="hint small">(opcional)</span>
          <textarea
            value={howToFix}
            onChange={(e) => setHowToFix(e.target.value)}
            rows={2}
            placeholder="Se você já tiver uma ideia"
          />
        </label>

        <label>
          Prints <span className="hint small">(até {MAX_IMAGENS})</span>
          <input type="file" accept="image/*" multiple onChange={escolherImagens} />
        </label>
        {images.length > 0 && (
          <p className="hint small">{images.length} imagem(ns) selecionada(s)</p>
        )}

        {error && <div className="auth-error">{error}</div>}

        <button className="primary" type="submit" disabled={busy}>
          {busy ? 'Enviando...' : 'Enviar report'}
        </button>
      </form>
    </Modal>
  );
}
