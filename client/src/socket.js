import { io } from 'socket.io-client';

/**
 * Abre a conexao de tempo real.
 *
 * Os handlers sao registrados ANTES de conectar de proposito: o servidor manda
 * presence:sync no instante em que o socket entra, e o socket.io nao guarda
 * eventos pra listeners que aparecem depois.
 */
export function createSocket(token, handlers = {}) {
  const socket = io({ auth: { token }, autoConnect: false });

  for (const [event, handler] of Object.entries(handlers)) {
    socket.on(event, handler);
  }

  socket.connect();
  return socket;
}

/** Wrapper de emit com ack em forma de Promise. */
export const emitAck = (socket, event, payload) =>
  new Promise((resolve) => socket.emit(event, payload, resolve));
