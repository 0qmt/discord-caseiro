import { useEffect, useState } from 'react';
import { cropStyle } from '../lib/cropStyle.js';
import { serverAsset } from '../platform/server.js';

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
  const src = serverAsset(avatarUrl);
  const [falhou, setFalhou] = useState(false);
  const Tag = onClick ? 'button' : 'div';

  useEffect(() => {
    setFalhou(false);
  }, [src]);

  return (
    <Tag
      className={`avatar ${className}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}
      onClick={onClick}
      title={title}
      type={onClick ? 'button' : undefined}
    >
      <span className="avatar-inner">
        {/* `key` na URL: sem ela o React reaproveita o mesmo <img> ao trocar
            de foto, e a animação de entrada (animacoes.css) rodaria só na
            primeira vez - justamente na troca, que é quando ela serve. */}
        {src && !falhou
          ? <img key={src} src={src} alt="" style={cropStyle(avatarCrop)} onError={() => setFalhou(true)} />
          : username[0]?.toUpperCase()}
      </span>
      {children}
    </Tag>
  );
}
