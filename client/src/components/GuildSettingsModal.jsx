import { useState } from 'react';
import { api } from '../api.js';
import { cropStyle } from '../lib/cropStyle.js';
import ImageCropModal from './ImageCropModal.jsx';
import Modal from './Modal.jsx';

const MAX_DESCRICAO = 300;

/** Renomear, trocar ícone e descrição do servidor - exige Gerenciar servidor. */
export default function GuildSettingsModal({ guild, onClose, onSaved }) {
  const [name, setName] = useState(guild.name);
  const [description, setDescription] = useState(guild.description ?? '');
  const [cropping, setCropping] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const mudou = name.trim() !== guild.name || description.trim() !== (guild.description ?? '');

  async function salvar(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { guild: atualizado } = await api.updateGuild(guild.id, {
        name: name.trim(),
        description: description.trim(),
      });
      onSaved(atualizado);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const enviarIcone = async (file, crop) => {
    const { guild: atualizado } = await api.uploadGuildIcon(guild.id, file, crop);
    onSaved(atualizado, { manterAberto: true });
    setCropping(false);
  };

  const removerIcone = async () => {
    const { guild: atualizado } = await api.deleteGuildIcon(guild.id);
    onSaved(atualizado, { manterAberto: true });
    setCropping(false);
  };

  if (cropping) {
    return (
      <ImageCropModal
        title="Ícone do servidor"
        aspect={1}
        cropShape="round"
        output={{ width: 256, height: 256 }}
        hasCurrent={Boolean(guild.iconUrl)}
        currentPreview={
          <div className="guild-icone-preview">
            {guild.iconUrl && <img src={guild.iconUrl} alt="" style={cropStyle(guild.iconCrop)} />}
          </div>
        }
        onUpload={enviarIcone}
        onRemove={removerIcone}
        onClose={() => setCropping(false)}
      />
    );
  }

  return (
    <Modal title="Configurações do servidor" onClose={onClose}>
      <form onSubmit={salvar}>
        <div className="guild-icone-campo">
          <button type="button" className="guild-icone-botao" onClick={() => setCropping(true)} title="Trocar ícone">
            {guild.iconUrl
              ? <img src={guild.iconUrl} alt="" style={cropStyle(guild.iconCrop)} />
              : <span>{name.trim()[0]?.toUpperCase() ?? '?'}</span>}
            <span className="trocar">Trocar</span>
          </button>
        </div>

        <label>
          Nome do servidor
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            minLength={2}
            maxLength={64}
            required
          />
        </label>

        <label>
          Descrição
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={MAX_DESCRICAO}
            rows={3}
            placeholder="Do que se trata esse servidor"
          />
        </label>
        <p className="hint small contador">{description.length}/{MAX_DESCRICAO}</p>

        {error && <div className="auth-error">{error}</div>}

        <button className="primary" type="submit" disabled={busy || !mudou}>
          {busy ? 'Salvando...' : 'Salvar'}
        </button>
      </form>
    </Modal>
  );
}
