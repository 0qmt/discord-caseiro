import { cropStyle } from '../lib/cropStyle.js';

/**
 * Avatar de qualquer usuario.
 *
 * Imagem parada ja chega recortada do servidor. GIF chega inteiro, com o
 * recorte guardado em porcentagem, e o corte e aplicado aqui com CSS - se
 * passasse por canvas a animacao morreria.
 *
 * O clipe fica num elemento interno, senao o pontinho de presenca (children)
 * seria cortado junto.
 */

export default function Avatar({ user, size = 38, className = '', children, onClick, title }) {
  const { avatarUrl, avatarCrop, username = '?' } = user ?? {};
  const Tag = onClick ? 'button' : 'div';

  return (
    <Tag
      className={`avatar ${className}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}
      onClick={onClick}
      title={title}
      type={onClick ? 'button' : undefined}
    >
      <span className="avatar-inner">
        {avatarUrl
          ? <img src={avatarUrl} alt="" style={cropStyle(avatarCrop)} />
          : username[0]?.toUpperCase()}
      </span>
      {children}
    </Tag>
  );
}
