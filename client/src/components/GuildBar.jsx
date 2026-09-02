import { cropStyle } from '../lib/cropStyle.js';
import Icon from './Icon.jsx';

const initials = (name) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase();

export default function GuildBar({
  guilds, activeGuildId, dmMode, unreadDmTotal, onSelect, onOpenDms, onCreate, onJoin, unreadByGuild,
  mentionByGuild = {}, onReportarBug, onOpenCinema,
}) {
  return (
    <nav className="guild-bar">
      <button
        className={`guild-pill dm-home ${dmMode ? 'active' : ''}`}
        title="Mensagens diretas"
        onClick={onOpenDms}
      >
        <Icon name="message-circle" size={22} />
        {unreadDmTotal > 0 && !dmMode && <span className="badge">{unreadDmTotal}</span>}
      </button>
      <div className="guild-bar-divisor" />

      {guilds.map((guild) => (
        <button
          key={guild.id}
          className={`guild-pill ${guild.id === activeGuildId && !dmMode ? 'active' : ''}`}
          title={guild.name}
          onClick={() => onSelect(guild.id)}
        >
          {guild.iconUrl ? (
            <span className="guild-pill-icone">
              <img key={guild.iconUrl} src={guild.iconUrl} alt="" style={cropStyle(guild.iconCrop)} />
            </span>
          ) : initials(guild.name)}
          {mentionByGuild[guild.id] > 0 ? (
            <span className="badge mention-badge" aria-label={`${mentionByGuild[guild.id]} menções`}>
              {mentionByGuild[guild.id]}
            </span>
          ) : unreadByGuild[guild.id] > 0 && guild.id !== activeGuildId && (
            <span className="badge">{unreadByGuild[guild.id]}</span>
          )}
        </button>
      ))}

      <button className="guild-pill ghost" title="Criar servidor" onClick={onCreate}><Icon name="plus" size={20} /></button>
      <button className="guild-pill ghost" title="Entrar com convite" onClick={onJoin}><Icon name="arrow-right" size={19} /></button>

      <div className="guild-bar-divisor" />
      <button className="guild-pill ghost cinema" title="Cinema" onClick={onOpenCinema}>
        <Icon name="film" size={19} />
      </button>
      <button className="guild-pill ghost reportar" title="Reportar um problema" onClick={onReportarBug}>
        <Icon name="alert-triangle" size={19} />
      </button>
    </nav>
  );
}
