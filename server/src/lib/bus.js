/**
 * Ponte entre as rotas HTTP e o Socket.io: uma rota REST (criar canal, entrar
 * por convite) precisa avisar todo mundo que ja esta conectado.
 */
let io = null;

export const setIo = (instance) => { io = instance; };
export const getIo = () => io;

export const emitToGuild = (guildId, event, payload) =>
  io?.to(`guild:${guildId}`).emit(event, payload);

export const emitToUser = (userId, event, payload) =>
  io?.to(`user:${userId}`).emit(event, payload);
