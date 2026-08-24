const TITULOS = {
  online: 'online',
  idle: 'ausente',
  dnd: 'não perturbe',
  offline: 'offline',
};

/**
 * A bolinha de presença no canto do avatar.
 *
 * `online` vem separado de `status` de propósito: quem está com "não
 * perturbe" e fecha o app continua com status 'dnd' guardado, mas tem que
 * aparecer cinza pros outros.
 */
export default function StatusDot({ status, online = true, className = '' }) {
  const efetivo = !online || !status || status === 'offline' ? 'offline' : status;
  return (
    <span
      className={`status-dot ${efetivo} ${className}`}
      title={TITULOS[efetivo] ?? efetivo}
    />
  );
}
