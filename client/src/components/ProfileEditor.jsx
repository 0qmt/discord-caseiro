import { useState } from 'react';
import { api } from '../api.js';
import { cropStyle } from '../lib/cropStyle.js';
import Avatar from './Avatar.jsx';
import ImageCropModal from './ImageCropModal.jsx';
import Modal from './Modal.jsx';

const MAX_BIO = 300;

export default function ProfileEditor({ me, onClose, onSaved }) {
  const [username, setUsername] = useState(me.username);
  const [handle, setHandle] = useState(me.handle ?? '');
  const [bio, setBio] = useState(me.bio ?? '');
  const [cropping, setCropping] = useState(null);   // 'avatar' | 'banner'
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const mudou = username.trim() !== me.username
    || handle.trim().toLowerCase() !== (me.handle ?? '')
    || bio.trim() !== (me.bio ?? '');

  async function salvar(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { user } = await api.updateProfile({
        username: username.trim(), handle: handle.trim(), bio: bio.trim(),
      });
      onSaved(user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  /** Avatar e banner salvam na hora, sem esperar o botao do formulario. */
  const enviarImagem = (tipo) => async (file, crop) => {
    const { user } = tipo === 'avatar'
      ? await api.uploadAvatar(file, crop)
      : await api.uploadBanner(file, crop);
    onSaved(user, { manterAberto: true });
    setCropping(null);
  };

  const removerImagem = (tipo) => async () => {
    const { user } = tipo === 'avatar' ? await api.deleteAvatar() : await api.deleteBanner();
    onSaved(user, { manterAberto: true });
    setCropping(null);
  };

  if (cropping) {
    const ehAvatar = cropping === 'avatar';
    return (
      <ImageCropModal
        title={ehAvatar ? 'Foto de perfil' : 'Banner do perfil'}
        aspect={ehAvatar ? 1 : 5 / 2}
        cropShape={ehAvatar ? 'round' : 'rect'}
        output={ehAvatar ? { width: 256, height: 256 } : { width: 600, height: 240 }}
        hasCurrent={Boolean(ehAvatar ? me.avatarUrl : me.bannerUrl)}
        currentPreview={ehAvatar
          ? <Avatar user={me} size={96} />
          : (
            <div className="profile-banner preview">
              {me.bannerUrl && <img src={me.bannerUrl} alt="" style={cropStyle(me.bannerCrop)} />}
            </div>
          )}
        onUpload={enviarImagem(cropping)}
        onRemove={removerImagem(cropping)}
        onClose={() => setCropping(null)}
      />
    );
  }

  return (
    <Modal title="Editar perfil" onClose={onClose}>
      <form onSubmit={salvar}>
        <div className="profile-banner editavel" onClick={() => setCropping('banner')}>
          {me.bannerUrl && <img src={me.bannerUrl} alt="" style={cropStyle(me.bannerCrop)} />}
          <span className="trocar">Trocar banner</span>
        </div>

        <div className="profile-avatar">
          <Avatar user={me} size={80} onClick={() => setCropping('avatar')} title="Trocar foto" />
        </div>

        <div className="profile-body">
          <label>
            Nome de usuario
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              minLength={2}
              maxLength={32}
              required
            />
          </label>

          <label>
            @usuario <span className="hint small">(diferente do nome de exibição, único)</span>
            <input
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              placeholder="seu_usuario"
              maxLength={32}
            />
          </label>

          <label>
            Descrição
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              maxLength={MAX_BIO}
              rows={3}
              placeholder="Fala alguma coisa sobre você"
            />
          </label>
          <p className="hint small contador">{bio.length}/{MAX_BIO}</p>

          {error && <div className="auth-error">{error}</div>}

          <button className="primary" type="submit" disabled={busy || !mudou}>
            {busy ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
