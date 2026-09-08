import { io } from 'socket.io-client';
import { getServerUrl, normalizeServerData } from './platform/server.js';

/**
 * Abre a conexao de tempo real.
 *
 * Os handlers sao registrados ANTES de conectar de proposito: o servidor manda
 * presence:sync no instante em que o socket entra, e o socket.io nao guarda
 * eventos pra listeners que aparecem depois.
 */
export function createSocket(token, handlers = {}) {
  const socket = io(getServerUrl() || undefined, { auth: { token }, autoConnect: false });

  for (const [event, handler] of Object.entries(handlers)) {
    socket.on(event, (...args) => handler(...args.map(normalizeServerData)));
  }

  socket.connect();
  return socket;
}

/** Wrapper de emit com ack em forma de Promise. */
export const emitAck = (socket, event, payload) =>
  new Promise((resolve) => socket.emit(event, payload, resolve));
