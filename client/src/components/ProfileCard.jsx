import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { cargosDoMembro } from '../lib/cargos.js';
import { cropStyle } from '../lib/cropStyle.js';
import { estiloGradiente } from '../lib/cor.js';
import Avatar from './Avatar.jsx';
import Modal from './Modal.jsx';

/**
 * Nota privada sobre a pessoa, dentro do próprio cartão. Salva sozinha ao
 * sair do campo - é uma anotação de canto, não vale um botão "salvar".
 */
function NotaDoPerfil({ userId }) {
  const [texto, setTexto] = useState('');
  const [salvo, setSalvo] = useState('');

  useEffect(() => {
    let vivo = true;
    api.getNote(userId)
      .then(({ note }) => { if (vivo) { setTexto(note); setSalvo(note); } })
      .catch(() => {});
    return () => { vivo = false; };
  }, [userId]);

  const salvar = () => {
    if (texto === salvo) return;
    api.setNote(userId, texto).then(({ note }) => setSalvo(note)).catch(() => {});
  };

  return (
    <div className="profile-field">
      <span className="profile-label">Nota (só você vê)</span>
      <textarea
        className="profile-nota"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        onBlur={salvar}
        rows={2}
        maxLength={500}
        placeholder="anota algo sobre essa pessoa"
      />
    </div>
  );
}

const ROLE_LABEL = { owner: 'dono', admin: 'admin', member: 'membro' };

const dataLonga = (ts) =>
  new Date(ts).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });

export default function ProfileCard({ userId, guild, reloadToken, onClose, onEdit }) {
  const [profile, setProfile] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api.getProfile(userId)
      .then(({ profile: p }) => !cancelled && setProfile(p))
      .catch((err) => !cancelled && setError(err.message));
    return () => { cancelled = true; };
  }, [userId, reloadToken]);

  const membro = guild?.members?.find((m) => m.id === userId) ?? null;
  const cargo = membro?.role;
  const cargosColoridos = cargosDoMembro(membro, guild?.roles);

  const temTema = Boolean(profile?.themePrimary && profile?.themeAccent);
  const estiloTema = temTema
    ? estiloGradiente(profile.themePrimary, profile.themeAccent, profile.themePosition)
    : null;

  return (
    <Modal title="Perfil" onClose={onClose} bare>
      {error && <div className="auth-error">{error}</div>}
      {!profile && !error && <p className="hint">carregando...</p>}

      {profile && (
        <div className="profile" style={estiloTema ?? undefined}>
          {/* Sem banner próprio, a faixa é transparente e deixa o gradiente do
              .profile (o pai) aparecer; com banner, a foto cobre e o gradiente
              só some pra reaparecer mais embaixo, no corpo - como se
              continuasse por trás da foto. "topo" arredonda os cantos de
              cima porque, sem cabeçalho, a faixa agora encosta direto no
              topo do modal. */}
          <div className="profile-banner topo" style={temTema ? { background: 'none' } : undefined}>
            {profile.bannerUrl && (
              <img src={profile.bannerUrl} alt="" style={cropStyle(profile.bannerCrop)} />
            )}
          </div>

          <div className="profile-avatar">
            <Avatar user={profile} size={80} />
          </div>

          <div className="profile-body">
            <div className="profile-name">
              <h3>{membro?.nickname || profile.username}</h3>
              {cargo && <span className={`role ${cargo}`}>{ROLE_LABEL[cargo]}</span>}
            </div>
            {/* Com apelido no servidor, o nome real vira a linha de baixo. */}
            {membro?.nickname && <p className="profile-handle">{profile.username}</p>}
            {profile.handle && <p className="profile-handle">@{profile.handle}</p>}

            {cargosColoridos.length > 0 && (
              <div className="profile-field">
                <span className="profile-label">Cargos</span>
                <div className="profile-cargos">
                  {cargosColoridos.map((r) => (
                    <span key={r.id} className="profile-cargo">
                      <span className="cargos-bolinha" style={{ background: r.color ?? '#99aab5' }} />
                      {r.name}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {profile.bio
              ? <p className="profile-bio">{profile.bio}</p>
              : <p className="profile-bio vazia">Sem descrição ainda.</p>}

            <div className="profile-field">
              <span className="profile-label">Por aqui desde</span>
              <span>{dataLonga(profile.createdAt)}</span>
            </div>

            {profile.sharedGuilds?.length > 0 && (
              <div className="profile-field">
                <span className="profile-label">
                  {profile.isSelf ? 'Seus servidores' : 'Servidores em comum'}
                </span>
                <span>{profile.sharedGuilds.map((g) => g.name).join(', ')}</span>
              </div>
            )}

            {!profile.isSelf && <NotaDoPerfil userId={userId} />}

            {profile.isSelf && (
              <button className="primary" onClick={onEdit}>Editar perfil</button>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
