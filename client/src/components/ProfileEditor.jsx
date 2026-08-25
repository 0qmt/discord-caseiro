import { useState } from 'react';
import { api } from '../api.js';
import { corValida, estiloGradiente, POSICAO_PADRAO, TEMAS_PRONTOS } from '../lib/cor.js';
import { cropStyle } from '../lib/cropStyle.js';
import Avatar from './Avatar.jsx';
import ColorPicker from './ColorPicker.jsx';
import ImageCropModal from './ImageCropModal.jsx';
import Modal from './Modal.jsx';

const MAX_BIO = 300;

export default function ProfileEditor({ me, onClose, onSaved }) {
  const [username, setUsername] = useState(me.username);
  const [handle, setHandle] = useState(me.handle ?? '');
  const [bio, setBio] = useState(me.bio ?? '');
  const [temaPrimaria, setTemaPrimaria] = useState(me.themePrimary ?? null);
  const [temaDestaque, setTemaDestaque] = useState(me.themeAccent ?? null);
  const [temaPosicao, setTemaPosicao] = useState(me.themePosition ?? POSICAO_PADRAO);
  const [cropping, setCropping] = useState(null);   // 'avatar' | 'banner'
  const [seletorAberto, setSeletorAberto] = useState(null); // 'primaria' | 'destaque' | null
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const mudou = username.trim() !== me.username
    || handle.trim().toLowerCase() !== (me.handle ?? '')
    || bio.trim() !== (me.bio ?? '')
    || temaPrimaria !== (me.themePrimary ?? null)
    || temaDestaque !== (me.themeAccent ?? null)
    || temaPosicao !== (me.themePosition ?? POSICAO_PADRAO);

  async function salvar(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { user } = await api.updateProfile({
        username: username.trim(), handle: handle.trim(), bio: bio.trim(),
        themePrimary: temaPrimaria, themeAccent: temaDestaque,
        themePosition: temaPrimaria ? temaPosicao : null,
      });
      onSaved(user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function escolherTemaPronto([primaria, destaque]) {
    setTemaPrimaria(primaria);
    setTemaDestaque(destaque);
    setTemaPosicao(POSICAO_PADRAO);
  }

  const temTema = corValida(temaPrimaria) && corValida(temaDestaque);

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

  const previewTema = temTema ? estiloGradiente(temaPrimaria, temaDestaque, temaPosicao) : null;

  return (
    <Modal title="Editar perfil" onClose={onClose}>
      {/* .profile aqui é a mesma classe/estrutura do cartão de perfil de
          verdade (ver ProfileCard.jsx) - o que aparece aqui embaixo é
          exatamente o que os outros vão ver, ao vivo, sem precisar salvar
          pra conferir. "com-tema" tira o fundo cinza opaco dos campos, que
          brigava com o degradê por baixo. */}
      <form className={`profile ${temTema ? 'com-tema' : ''}`} onSubmit={salvar} style={previewTema ?? undefined}>
        <div
          className="profile-banner editavel"
          style={temTema ? { background: 'none' } : undefined}
          onClick={() => setCropping('banner')}
        >
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

          <span className="campo-rotulo">Tema do perfil</span>
          <div className="tema-cores">
            <div className="tema-cor-campo">
              <button
                type="button"
                className="tema-cor-botao"
                style={{ background: temaPrimaria ?? 'var(--bg-3)' }}
                onClick={() => setSeletorAberto(seletorAberto === 'primaria' ? null : 'primaria')}
              />
              <span>Cor principal</span>
              {seletorAberto === 'primaria' && (
                <ColorPicker
                  valor={temaPrimaria ?? '#5865f2'}
                  onEscolher={setTemaPrimaria}
                  onFechar={() => setSeletorAberto(null)}
                />
              )}
            </div>

            <div className="tema-cor-campo">
              <button
                type="button"
                className="tema-cor-botao"
                style={{ background: temaDestaque ?? 'var(--bg-3)' }}
                onClick={() => setSeletorAberto(seletorAberto === 'destaque' ? null : 'destaque')}
              />
              <span>Cor de destaque</span>
              {seletorAberto === 'destaque' && (
                <ColorPicker
                  valor={temaDestaque ?? '#5865f2'}
                  onEscolher={setTemaDestaque}
                  onFechar={() => setSeletorAberto(null)}
                />
              )}
            </div>

            {temTema && (
              <button
                type="button"
                className="tema-remover"
                onClick={() => { setTemaPrimaria(null); setTemaDestaque(null); setTemaPosicao(POSICAO_PADRAO); }}
              >
                Remover tema
              </button>
            )}
          </div>
          {seletorAberto && <div className="click-fora" onClick={() => setSeletorAberto(null)} />}

          {temTema && (
            <label className="tema-posicao">
              Onde a cor de destaque começa a dominar
              <input
                type="range"
                min={30}
                max={95}
                value={temaPosicao}
                onChange={(e) => setTemaPosicao(Number(e.target.value))}
              />
            </label>
          )}

          <div className="tema-galeria">
            {TEMAS_PRONTOS.map(([primaria, destaque]) => (
              <button
                key={primaria + destaque}
                type="button"
                className={`tema-galeria-item ${temaPrimaria === primaria && temaDestaque === destaque ? 'ativo' : ''}`}
                style={{ background: `linear-gradient(135deg, ${primaria}, ${destaque})` }}
                title={`${primaria} → ${destaque}`}
                onClick={() => escolherTemaPronto([primaria, destaque])}
              />
            ))}
          </div>

          {error && <div className="auth-error">{error}</div>}

          <button className="primary" type="submit" disabled={busy || !mudou}>
            {busy ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
