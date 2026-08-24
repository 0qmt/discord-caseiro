import Avatar from './Avatar.jsx';
import StatusDot from './StatusDot.jsx';

/** Os quatro status, com a explicação que aparece no menu. */
export const STATUS = [
  { id: 'online', label: 'Online' },
  { id: 'idle', label: 'Ausente', dica: 'Aparece como ausente, mas continua recebendo tudo.' },
  { id: 'dnd', label: 'Não perturbe', dica: 'Some com as notificações na tela.' },
  { id: 'invisible', label: 'Invisível', dica: 'Você aparece offline, mas usa o app normalmente.' },
];

const RESUMO = {
  online: 'online',
  idle: 'ausente',
  dnd: 'não perturbe',
  invisible: 'invisível',
};

/**
 * Itens do menu de status. Exportado porque quem monta o menu de contexto é o
 * App (ele é o dono do <ContextMenu />), e não este componente.
 */
export function itensDeStatus({ me, statusAtual, onTrocarStatus, onAbrirPerfil, onAbrirConfiguracoes }) {
  return [
    { tipo: 'titulo', label: me.username },
    {
      tipo: 'custom',
      key: 'picker',
      render: () => (
        <div className="status-picker" key="picker">
          {STATUS.map((s) => (
            <button key={s.id} className="ctx-item" onClick={() => onTrocarStatus(s.id)}>
              <StatusDot status={s.id} online className="status-amostra" />
              <span>
                {s.label}
                {s.dica && <small>{s.dica}</small>}
              </span>
              {statusAtual === s.id && <span className="ctx-marca">✓</span>}
            </button>
          ))}
        </div>
      ),
    },
    { tipo: 'sep' },
    { label: 'Ver meu perfil', icone: '👤', onClick: onAbrirPerfil },
    { label: 'Configurações', icone: '⚙', onClick: onAbrirConfiguracoes },
  ];
}

/**
 * Rodapé da barra lateral: quem você é, o que está fazendo e o atalho de
 * configurações. Clicar no avatar (ou botão direito em qualquer lugar do
 * painel) abre o seletor de status.
 */
export default function UserPanel({
  me, conectado, status, atividade, onAbrirMenu, onAbrirPerfil, onAbrirConfiguracoes,
}) {
  return (
    <footer className="user-panel" onContextMenu={onAbrirMenu}>
      <Avatar user={me} size={34} onClick={onAbrirMenu} title="Mudar status">
        <StatusDot status={status} online={conectado} />
      </Avatar>

      <div className="user-info">
        <button className="user-name" onClick={onAbrirPerfil} title="Ver seu perfil">
          {me.username}
        </button>
        <span className={`conn ${conectado ? 'on' : 'off'}`} title={atividade || undefined}>
          {conectado ? (atividade || RESUMO[status] || 'online') : 'reconectando...'}
        </span>
      </div>

      <button className="icon-btn" title="Configurações" onClick={onAbrirConfiguracoes}>⚙</button>
    </footer>
  );
}
