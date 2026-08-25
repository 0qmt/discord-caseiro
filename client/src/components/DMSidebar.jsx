import Avatar from './Avatar.jsx';
import Icon from './Icon.jsx';

const RÓTULO_ANEXO = { image: '📷 imagem', gif: '🎬 GIF', video: '🎬 vídeo', audio: '🎵 áudio', file: '📎 arquivo' };

function previaDe(lastMessage) {
  if (!lastMessage) return null;
  if (lastMessage.content) return lastMessage.content;
  if (lastMessage.attachment) return RÓTULO_ANEXO[lastMessage.attachment.type] ?? '📎 anexo';
  return null;
}

export default function DMSidebar({
  conversations,
  activeDmId,
  unreadByDm,
  onlineIds,
  onSelectDm,
  onNovaConversa,
  me,
  connected,
  onOpenSettings,
  onOpenProfile,
}) {
  return (
    <aside className="channel-sidebar">
      <header className="sidebar-head">
        <span className="guild-name">Mensagens diretas</span>
        <button className="icon-btn" title="Nova conversa" onClick={onNovaConversa}><Icon name="plus" /></button>
      </header>

      <div className="channel-scroll">
        <div className="channel-group">
          {conversations.length === 0 && (
            <p className="hint dm-vazio">
              Nenhuma conversa ainda. Clica no + pra chamar alguem no privado.
            </p>
          )}

          {conversations.map((c) => (
            <button
              key={c.id}
              className={`dm-row ${c.id === activeDmId ? 'active' : ''}`}
              onClick={() => onSelectDm(c.id)}
            >
              <Avatar user={c.otherUser} size={32}>
                <span className={`dot ${onlineIds.has(c.otherUser.id) ? 'on' : 'off'}`} />
              </Avatar>
              <div className="dm-info">
                <span className="dm-nome">{c.otherUser.username}</span>
                {previaDe(c.lastMessage) && <span className="dm-preview">{previaDe(c.lastMessage)}</span>}
              </div>
              {unreadByDm[c.id] > 0 && c.id !== activeDmId && (
                <span className="badge small">{unreadByDm[c.id]}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      <footer className="user-panel">
        <Avatar user={me} size={38} onClick={onOpenProfile} title="Ver seu perfil" />
        <div className="user-info">
          <span className="user-name">{me.username}</span>
          <span className={`conn ${connected ? 'on' : 'off'}`}>
            {connected ? 'conectado' : 'reconectando...'}
          </span>
        </div>
        <button className="icon-btn" title="Configurações" onClick={onOpenSettings}><Icon name="settings" /></button>
      </footer>
    </aside>
  );
}
