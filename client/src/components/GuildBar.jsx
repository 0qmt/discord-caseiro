const initials = (name) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase();

export default function GuildBar({
  guilds, activeGuildId, dmMode, unreadDmTotal, onSelect, onOpenDms, onCreate, onJoin, unreadByGuild,
}) {
  return (
    <nav className="guild-bar">
      <button
        className={`guild-pill dm-home ${dmMode ? 'active' : ''}`}
        title="Mensagens diretas"
        onClick={onOpenDms}
      >
        💬
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
          {initials(guild.name)}
          {unreadByGuild[guild.id] > 0 && guild.id !== activeGuildId && (
            <span className="badge">{unreadByGuild[guild.id]}</span>
          )}
        </button>
      ))}

      <button className="guild-pill ghost" title="Criar servidor" onClick={onCreate}>+</button>
      <button className="guild-pill ghost" title="Entrar com convite" onClick={onJoin}>&#8594;</button>
    </nav>
  );
}
