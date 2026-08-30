import { config } from '../config.js';

/**
 * TURN self-hosted, agora num container coturn ao lado do servidor (ver
 * docker-compose.yml), com porta 3478 encaminhada de verdade no roteador -
 * endereço fixo, UDP funcionando de verdade (não só TCP através de um
 * túnel, como era quando o coturn rodava dentro do Termux sem porta
 * própria). Sem `TURN_HOST` configurado (dev local, por exemplo), a chamada
 * cai pra STUN puro - funciona entre redes abertas, só não atravessa NAT
 * fechado dos dois lados.
 */
export function turnServers() {
  const { host, port, username, password } = config.turn;
  if (!host) return [];
  return [
    { urls: `turn:${host}:${port}?transport=udp`, username, credential: password },
    { urls: `turn:${host}:${port}?transport=tcp`, username, credential: password },
  ];
}
