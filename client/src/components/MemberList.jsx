import { corDoMembro, nomeExibido, PERM, podeAgirSobre, temPermissao } from '../lib/cargos.js';
import Avatar from './Avatar.jsx';
import StatusDot from './StatusDot.jsx';

const ROLE_LABEL = { owner: 'dono', admin: 'admin', member: null };

/** Duração dos castigos oferecidos no submenu, igual ao Discord. */
export const DURACOES_DE_CASTIGO = [
  { label: '60 segundos', minutos: 1 },
  { label: '5 minutos', minutos: 5 },
  { label: '10 minutos', minutos: 10 },
  { label: '1 hora', minutos: 60 },
  { label: '1 dia', minutos: 60 * 24 },
  { label: '1 semana', minutos: 60 * 24 * 7 },
];

function MemberRow({
  member, presenca, cor, canManage, isMe, onPromote, onKick, onOpen,
  podeChamarParaCall, onChamarParaCall, onMenu,
}) {
  const online = presenca?.online ?? false;
  const atividade = presenca?.activity ?? null;

  return (
    <li
      className={`member ${online ? '' : 'offline'}`}
      onContextMenu={onMenu}
    >
      <Avatar
        user={member}
        size={32}
        className="small"
        onClick={() => onOpen(member)}
        title="Ver perfil"
      >
        <StatusDot status={presenca?.status} online={online} />
      </Avatar>

      <div className="member-linhas">
        <button
          className={`member-name ${cor ? 'colorido' : ''}`}
          style={cor ? { color: cor } : undefined}
          onClick={() => onOpen(member)}
        >
          {nomeExibido(member)}{isMe && ' (voce)'}
        </button>
        {atividade && <span className="member-atividade" title={atividade}>{atividade}</span>}
      </div>

      {ROLE_LABEL[member.role] && <span className={`role ${member.role}`}>{ROLE_LABEL[member.role]}</span>}

      <span className="member-actions">
        {podeChamarParaCall && !isMe && (
          <button
            className="icon-btn faint"
            title="Chamar pra sua chamada"
            onClick={() => onChamarParaCall(member)}
          >
            📞
          </button>
        )}
        {canManage && member.role !== 'owner' && !isMe && (
          <>
            <button
              className="icon-btn faint"
              title={member.role === 'admin' ? 'Rebaixar para membro' : 'Promover a admin'}
              onClick={() => onPromote(member, member.role === 'admin' ? 'member' : 'admin')}
            >
              {member.role === 'admin' ? '↓' : '↑'}
            </button>
            <button className="icon-btn faint" title="Expulsar" onClick={() => onKick(member)}>x</button>
          </>
        )}
      </span>
    </li>
  );
}

export default function MemberList({
  guild, presencas, meId, onPromote, onKick, onOpenProfile,
  podeChamarParaCall = false, onChamarParaCall, onMenuDoMembro, visivel = true,
}) {
  if (!guild || !visivel) return null;

  const canManage = guild.role === 'owner';
  const euMembro = guild.members.find((m) => m.id === meId);
  const estaOnline = (m) => presencas?.[m.id]?.online ?? false;

  const online = guild.members.filter(estaOnline);
  const offline = guild.members.filter((m) => !estaOnline(m));

  const render = (member) => (
    <MemberRow
      key={member.id}
      member={member}
      presenca={presencas?.[member.id]}
      cor={corDoMembro(member, guild.roles)}
      canManage={canManage}
      isMe={member.id === meId}
      onPromote={onPromote}
      onKick={onKick}
      onOpen={onOpenProfile}
      podeChamarParaCall={podeChamarParaCall}
      onChamarParaCall={onChamarParaCall}
      onMenu={onMenuDoMembro?.(member, { euMembro, guild })}
    />
  );

  return (
    <aside className="member-list">
      <div className="group-head"><span>Online &mdash; {online.length}</span></div>
      <ul>{online.map(render)}</ul>

      {offline.length > 0 && (
        <>
          <div className="group-head"><span>Offline &mdash; {offline.length}</span></div>
          <ul>{offline.map(render)}</ul>
        </>
      )}
    </aside>
  );
}

/**
 * Itens do menu de botão direito de uma pessoa (seção 6 da spec).
 *
 * Fica exportado aqui, e não dentro do componente, porque o painel de voz
 * precisa do mesmo menu com alguns itens a mais - assim as duas telas nunca
 * saem de sincronia sobre o que se pode fazer com alguém.
 */
export function itensDoMembro({
  membro, euMembro, guild, souEu, acoes,
}) {
  const itens = [{ tipo: 'titulo', label: nomeExibido(membro) }];

  itens.push({ label: 'Ver perfil', icone: '👤', onClick: () => acoes.abrirPerfil(membro) });
  if (!souEu) {
    itens.push({ label: 'Mencionar', icone: '@', onClick: () => acoes.mencionar(membro) });
    itens.push({ label: 'Mensagem direta', icone: '💬', onClick: () => acoes.abrirDm(membro) });
    if (acoes.chamarParaCall) {
      itens.push({ label: 'Puxar pra call', icone: '📞', onClick: () => acoes.chamarParaCall(membro) });
    }
    itens.push({ label: 'Nota privada', icone: '📝', onClick: () => acoes.abrirNota(membro) });
  }

  // Trocar o próprio apelido é sempre permitido; o dos outros exige cargo.
  const podeMexerNoApelido = souEu
    || (temPermissao(euMembro, guild, PERM.GERENCIAR_APELIDOS) && podeAgirSobre(euMembro, membro, guild));
  if (podeMexerNoApelido) {
    itens.push({ tipo: 'sep' });
    itens.push({ label: 'Alterar apelido', icone: '✎', onClick: () => acoes.mudarApelido(membro) });
  }

  const mandaNele = podeAgirSobre(euMembro, membro, guild);
  const cargosAtribuiveis = (guild?.roles ?? []).filter((r) => !r.isDefault);

  if (mandaNele && temPermissao(euMembro, guild, PERM.GERENCIAR_CARGOS) && cargosAtribuiveis.length > 0) {
    itens.push({
      tipo: 'sub',
      label: 'Cargos',
      icone: '🏷',
      itens: cargosAtribuiveis.map((r) => ({
        key: r.id,
        label: r.name,
        marcado: membro.roles?.includes(r.id),
        manterAberto: true,
        onClick: () => acoes.alternarCargo(membro, r),
      })),
    });
  }

  if (mandaNele && temPermissao(euMembro, guild, PERM.SILENCIAR_MEMBROS)) {
    itens.push({
      tipo: 'sub',
      label: 'Castigo',
      icone: '⏳',
      itens: [
        ...DURACOES_DE_CASTIGO.map((d) => ({
          key: d.label, label: d.label, onClick: () => acoes.castigar(membro, d.minutos),
        })),
        { tipo: 'sep' },
        { label: 'Tirar castigo', onClick: () => acoes.castigar(membro, 0) },
      ],
    });
  }

  if (mandaNele && (temPermissao(euMembro, guild, PERM.EXPULSAR) || guild?.role === 'owner')) {
    itens.push({ tipo: 'sep' });
    itens.push({ label: 'Expulsar do servidor', icone: '🚪', perigo: true, onClick: () => acoes.expulsar(membro) });
  }
  if (mandaNele && temPermissao(euMembro, guild, PERM.BANIR)) {
    itens.push({ label: 'Banir', icone: '⛔', perigo: true, onClick: () => acoes.banir(membro) });
  }

  itens.push({ tipo: 'sep' });
  itens.push({
    label: 'Copiar ID',
    icone: '#',
    onClick: () => navigator.clipboard?.writeText(membro.id).catch(() => {}),
  });

  return itens;
}
