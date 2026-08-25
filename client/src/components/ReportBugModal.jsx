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
export default function ReportBugModal({ onClose, mensagemDenunciada = null }) {
  const denuncia = Boolean(mensagemDenunciada);
  const [title, setTitle] = useState(
    denuncia ? `Denúncia de mensagem de ${mensagemDenunciada.author.username}` : '',
  );
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
      // Numa denúncia o relato vai junto da mensagem original inteira: sem
      // isso quem recebe leria "fulano falou algo ruim" e teria que ir caçar
      // a mensagem no canal - que a essa altura pode já ter sido apagada.
      const contexto = denuncia
        ? `\n\n--- mensagem denunciada ---\nautor: ${mensagemDenunciada.author.username}`
          + `\nid: ${mensagemDenunciada.id}`
          + `\nquando: ${new Date(mensagemDenunciada.createdAt).toLocaleString('pt-BR')}`
          + `\nconteúdo: ${mensagemDenunciada.content || '(sem texto)'}`
          + (mensagemDenunciada.attachment ? `\nanexo: ${mensagemDenunciada.attachment.url}` : '')
        : '';

      await api.reportarBug({
        title: title.trim(),
        whatHappens: whatHappens.trim() + contexto,
        whatStopsWorking: whatStopsWorking.trim(), howToFix: howToFix.trim(), images,
      });
      setEnviado(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const titulo = denuncia ? 'Denunciar mensagem' : 'Reportar um problema';

  if (enviado) {
    return (
      <Modal title={titulo} onClose={onClose}>
        <p className="hint">Enviado! Chegou na DM de quem administra o servidor.</p>
        <button className="primary" onClick={onClose}>Fechar</button>
      </Modal>
    );
  }

  return (
    <Modal title={titulo} onClose={onClose}>
      <form onSubmit={enviar}>
        {denuncia && (
          <div className="denuncia-previa">
            <strong>{mensagemDenunciada.author.username}</strong>
            <p>{mensagemDenunciada.content || '(mensagem sem texto)'}</p>
          </div>
        )}
        <label>
          {denuncia ? 'Assunto' : 'Nome do problema'}
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
          {denuncia ? 'Por que está denunciando' : 'O que está acontecendo'}
          <textarea
            value={whatHappens}
            onChange={(e) => setWhatHappens(e.target.value)}
            rows={3}
            placeholder="Descreva o que você vê de errado"
            required
          />
        </label>

        <label>
          {denuncia
            ? <>Mais alguma coisa <span className="hint small">(opcional)</span></>
            : 'O que deveria acontecer (ou o que parou de funcionar)'}
          <textarea
            value={whatStopsWorking}
            onChange={(e) => setWhatStopsWorking(e.target.value)}
            rows={3}
            placeholder={denuncia ? 'Contexto que ajude a entender' : 'O que era pra ter acontecido no lugar'}
            required={!denuncia}
          />
        </label>

        {/* Numa denúncia não faz sentido pedir a solução: quem denuncia
            relata, quem modera decide o que fazer. */}
        {!denuncia && (
          <label>
            Como pode ser resolvido <span className="hint small">(opcional)</span>
            <textarea
              value={howToFix}
              onChange={(e) => setHowToFix(e.target.value)}
              rows={2}
              placeholder="Se você já tiver uma ideia"
            />
          </label>
        )}

        <label>
          Prints <span className="hint small">(até {MAX_IMAGENS})</span>
          <input type="file" accept="image/*" multiple onChange={escolherImagens} />
        </label>
        {images.length > 0 && (
          <p className="hint small">{images.length} imagem(ns) selecionada(s)</p>
        )}

        {error && <div className="auth-error">{error}</div>}

        <button className="primary" type="submit" disabled={busy}>
          {busy ? 'Enviando...' : denuncia ? 'Enviar denúncia' : 'Enviar report'}
        </button>
      </form>
    </Modal>
  );
}
