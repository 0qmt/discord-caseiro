import { useState } from 'react';
import Avatar from './Avatar.jsx';
import UserPanel from './UserPanel.jsx';
import VoicePanel from './VoicePanel.jsx';

/**
 * Agrupa canais por categoria, mantendo a ordem: primeiro os soltos (sem
 * categoria), depois cada categoria na sua posição.
 */
function agrupar(canais, categorias) {
  const soltos = canais.filter((c) => !c.categoryId);
  const grupos = (categorias ?? [])
    .map((cat) => ({ cat, canais: canais.filter((c) => c.categoryId === cat.id) }))
    // Categoria vazia continua aparecendo: é onde a pessoa arrasta canal pra
    // dentro, e some-la deixaria a tela "quebrada" logo depois de criar uma.
    .sort((a, b) => a.cat.position - b.cat.position);
  return { soltos, grupos };
}

function LinhaDeVoz({ participantes, falando, meId, onMenuDoParticipante }) {
  if (participantes.length === 0) return null;
  return (
    <ul className="voice-members">
      {participantes.map((p) => (
        <li
          key={p.socketId}
          className={`${falando.get(p.socketId) ? 'falando' : ''} ${p.state.screen ? 'compartilhando' : ''}`}
          onContextMenu={onMenuDoParticipante?.(p)}
        >
          <Avatar user={p.user} size={22} className="small" />
          <span className="voice-nome">{p.user.username}{p.user.id === meId && ' (voce)'}</span>
          {p.state.screen && (
            <span className="compartilhando-badge" title="compartilhando a tela">🖥 ao vivo</span>
          )}
          {p.state.camera && <span title="câmera ligada">🎥</span>}
          {p.state.deafened && <span title="não está ouvindo ninguém">🔇👂</span>}
          {!p.state.hasMic && <span title="entrou só pra ouvir, sem microfone">👂</span>}
          {p.state.hasMic && p.state.muted && <span title="mutado">🔇</span>}
        </li>
      ))}
    </ul>
  );
}

export default function ChannelSidebar({
  guild,
  activeChannelId,
  unreadByChannel,
  onSelectChannel,
  onCreateChannel,
  onOpenInvite,
  me,
  connected,
  onOpenSettings,
  onOpenProfile,
  voice,
  voiceRooms,
  voiceActions,
  voiceChannelName,
  callMaximizada,
  onToggleVoiceChannel,
  // menus de contexto e presença (montados pelo App)
  onMenuDoCanal,
  onMenuDaGuild,
  onMenuDaCategoria,
  onMenuDoParticipanteDeVoz,
  onAbrirMenuDeStatus,
  meuStatus,
  minhaAtividade,
}) {
  const [colapsadas, setColapsadas] = useState(() => new Set());
  const canManage = guild?.role === 'owner' || guild?.role === 'admin';
  const textChannels = guild?.channels.filter((c) => c.type === 'text') ?? [];
  const voiceChannels = guild?.channels.filter((c) => c.type === 'voice') ?? [];

  /** Quem está falando, por socket, pra pintar a borda do avatar na lista. */
  const falando = new Map(voice.peers.map((p) => [p.socketId, p.speaking]));
  if (voice.socketId) falando.set(voice.socketId, voice.self.speaking);

  const alternarCategoria = (id) => setColapsadas((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const renderCanalDeTexto = (channel) => (
    <div
      key={channel.id}
      className={`channel-row ${channel.id === activeChannelId ? 'active' : ''}`}
      onContextMenu={onMenuDoCanal?.(channel)}
    >
      <button className="channel-btn" onClick={() => onSelectChannel(channel.id)}>
        <span className="hash">#</span>
        <span className="channel-label">{channel.name}</span>
        {unreadByChannel[channel.id] > 0 && channel.id !== activeChannelId && (
          <span className="badge small">{unreadByChannel[channel.id]}</span>
        )}
      </button>
    </div>
  );

  const renderCanalDeVoz = (channel) => {
    const participantes = voiceRooms[channel.id] ?? [];
    const estouAqui = voice.channelId === channel.id;

    return (
      <div key={channel.id} className="voice-channel">
        <div
          className={`channel-row ${estouAqui ? 'active' : ''} ${estouAqui && callMaximizada ? 'em-foco' : ''}`}
          onContextMenu={onMenuDoCanal?.(channel)}
        >
          <button
            className="channel-btn"
            onClick={() => onToggleVoiceChannel(channel.id)}
            title={!estouAqui ? 'Entrar na chamada'
              : callMaximizada ? 'Minimizar a chamada' : 'Ver a chamada'}
          >
            <span className="hash">🔊</span>
            <span className="channel-label">{channel.name}</span>
            {participantes.length > 0 && (
              <span className="badge small">{participantes.length}</span>
            )}
          </button>
        </div>

        <LinhaDeVoz
          participantes={participantes}
          falando={falando}
          meId={me.id}
          onMenuDoParticipante={onMenuDoParticipanteDeVoz}
        />
      </div>
    );
  };

  const { soltos: textoSoltos, grupos } = agrupar(textChannels, guild?.categories);

  return (
    <aside className="channel-sidebar">
      <header className="sidebar-head" onContextMenu={onMenuDaGuild}>
        <span className="guild-name">{guild?.name ?? 'Nenhum servidor'}</span>
        <button className="icon-btn" title="Opções do servidor" onClick={onMenuDaGuild}>⌄</button>
        {canManage && (
          <button className="icon-btn" title="Gerar convite" onClick={onOpenInvite}>+</button>
        )}
      </header>

      <div className="channel-scroll">
        <div className="channel-group">
          <div className="group-head">
            <span>Canais de texto</span>
            {canManage && (
              <button className="icon-btn" title="Novo canal de texto" onClick={() => onCreateChannel('text')}>+</button>
            )}
          </div>
          {textoSoltos.map(renderCanalDeTexto)}
        </div>

        {grupos.map(({ cat, canais }) => (
          <div className="channel-group" key={cat.id}>
            <div className="group-head" onContextMenu={onMenuDaCategoria?.(cat)}>
              <button className="group-toggle" onClick={() => alternarCategoria(cat.id)}>
                <span className={`group-seta ${colapsadas.has(cat.id) ? 'fechada' : ''}`}>⌄</span>
                {cat.name}
              </button>
              {canManage && (
                <button
                  className="icon-btn faint"
                  title="Novo canal aqui"
                  onClick={() => onCreateChannel('text', cat.id)}
                >
                  +
                </button>
              )}
            </div>
            {!colapsadas.has(cat.id) && canais.map(renderCanalDeTexto)}
          </div>
        ))}

        <div className="channel-group">
          <div className="group-head">
            <span>Canais de voz</span>
            {canManage && (
              <button className="icon-btn" title="Novo canal de voz" onClick={() => onCreateChannel('voice')}>+</button>
            )}
          </div>
          {voiceChannels.map(renderCanalDeVoz)}
        </div>
      </div>

      <VoicePanel voice={voice} channelName={voiceChannelName} actions={voiceActions} />

      <UserPanel
        me={me}
        conectado={connected}
        status={meuStatus}
        atividade={minhaAtividade}
        onAbrirMenu={onAbrirMenuDeStatus}
        onAbrirPerfil={onOpenProfile}
        onAbrirConfiguracoes={onOpenSettings}
      />
    </aside>
  );
}
