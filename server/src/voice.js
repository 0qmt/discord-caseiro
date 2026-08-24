import { q } from './db.js';
import { can, hasRole, isMember, podeAgirSobre, PERM } from './lib/permissions.js';
import { publicUser } from './lib/serialize.js';

/**
 * Quem esta em cada canal de voz, em memoria.
 *
 * channelId -> Map<socketId, { user, guildId, state }>
 *
 * A chave e o socket, nao o usuario: a mesma pessoa pode estar em duas abas, e
 * cada aba e um par de WebRTC diferente. Nada disso vai pro banco - se o
 * servidor reinicia, todo mundo cai da call de qualquer jeito.
 */
const rooms = new Map();

/**
 * Votos de expulsão em aberto: channelId -> Map<socketIdAlvo, Set<socketIdDeQuemVotou>>.
 * Vive só enquanto a sala existe - some sozinho quando o alvo sai ou a call acaba.
 */
const votosDeExpulsao = new Map();

const ESTADO_INICIAL = {
  muted: false, hasMic: true, camera: false, screen: false, deafened: false,
  // Impostos por um moderador: a pessoa nao consegue tirar sozinha.
  serverMuted: false, serverDeafened: false,
};

const participantsOf = (channelId) =>
  [...(rooms.get(channelId) ?? new Map()).entries()].map(([socketId, entry]) => ({
    socketId,
    user: entry.user,
    state: entry.state,
  }));

/** Todos os canais de voz com gente, nos servidores em que a pessoa esta. */
export function voiceSnapshotFor(userId) {
  const guildIds = new Set(
    q.all('SELECT guild_id FROM guild_members WHERE user_id = ?', userId).map((r) => r.guild_id),
  );

  const snapshot = {};
  for (const [channelId, membros] of rooms) {
    const primeiro = membros.values().next().value;
    if (primeiro && guildIds.has(primeiro.guildId)) {
      snapshot[channelId] = participantsOf(channelId);
    }
  }
  return snapshot;
}

/** A lista inteira do canal vai pro servidor todo: e curta e evita deltas. */
function broadcastParticipants(io, channelId, guildId) {
  io.to(`guild:${guildId}`).emit('voice:participants', {
    channelId,
    guildId,
    participants: participantsOf(channelId),
  });
}

/** Limpa qualquer voto de expulsão que envolva esse socket (como alvo ou como quem votou). */
function limparVotosDe(channelId, socketId) {
  const votos = votosDeExpulsao.get(channelId);
  if (!votos) return;
  votos.delete(socketId);
  for (const votantes of votos.values()) votantes.delete(socketId);
  if (votos.size === 0) votosDeExpulsao.delete(channelId);
}

function removeFromRoom(io, socketId, channelId) {
  const membros = rooms.get(channelId);
  const entry = membros?.get(socketId);
  if (!entry) return;

  membros.delete(socketId);
  if (membros.size === 0) { rooms.delete(channelId); votosDeExpulsao.delete(channelId); }
  else limparVotosDe(channelId, socketId);

  io.sockets.sockets.get(socketId)?.leave(`voice:${channelId}`);
  // Os outros precisam derrubar a conexao WebRTC com este socket.
  io.to(`voice:${channelId}`).emit('voice:left', { channelId, socketId });
  broadcastParticipants(io, channelId, entry.guildId);
}

export function registerVoiceHandlers(io, socket) {
  const user = socket.data.user;

  socket.emit('voice:sync', { rooms: voiceSnapshotFor(user.id) });

  socket.on('voice:join', ({ channelId } = {}, ack) => {
    const respond = (data) => (typeof ack === 'function' ? ack(data) : undefined);

    const channel = q.get('SELECT * FROM channels WHERE id = ?', String(channelId ?? ''));
    if (!channel) return respond({ error: 'canal nao encontrado' });
    if (channel.type !== 'voice') return respond({ error: 'esse canal nao e de voz' });
    if (!isMember(channel.guild_id, user.id)) {
      return respond({ error: 'voce nao e membro desse servidor' });
    }

    // Uma aba so fica numa call por vez, e uma PESSOA so tem uma sessao de
    // voz por vez - entrar de outra aba/aparelho com a mesma conta desliga
    // a sessao antiga (igual ao Discord), em vez de duplicar a pessoa na
    // call e fazer ela tentar negociar WebRTC consigo mesma.
    for (const [outroCanal, membros] of rooms) {
      for (const [socketId, entry] of [...membros]) {
        if (socketId !== socket.id && entry.user.id !== user.id) continue;
        if (socketId !== socket.id) io.to(socketId).emit('voice:kicked', { motivo: 'outra-sessao' });
        removeFromRoom(io, socketId, outroCanal);
      }
    }

    const existentes = participantsOf(channel.id);

    if (!rooms.has(channel.id)) rooms.set(channel.id, new Map());
    rooms.get(channel.id).set(socket.id, {
      user: publicUser(q.get('SELECT * FROM users WHERE id = ?', user.id)),
      guildId: channel.guild_id,
      state: { ...ESTADO_INICIAL },
    });
    socket.join(`voice:${channel.id}`);

    broadcastParticipants(io, channel.id, channel.guild_id);

    // Quem chega faz as ofertas pra quem ja estava: assim nunca duas pontas
    // oferecem ao mesmo tempo e nao existe conflito de negociacao.
    return respond({ channelId: channel.id, socketId: socket.id, participants: existentes });
  });

  socket.on('voice:leave', ({ channelId } = {}) => {
    if (channelId) removeFromRoom(io, socket.id, String(channelId));
  });

  /**
   * Repasse cego de SDP e ICE entre dois sockets. O servidor nao interpreta
   * nada disso - so confere que os dois estao no mesmo canal de voz.
   */
  socket.on('voice:signal', ({ to, channelId, payload } = {}) => {
    const membros = rooms.get(String(channelId ?? ''));
    if (!membros?.has(socket.id) || !membros.has(String(to))) return;

    io.to(String(to)).emit('voice:signal', {
      from: socket.id,
      channelId,
      payload,
    });
  });

  socket.on('voice:state', ({ channelId, ...state } = {}) => {
    const membros = rooms.get(String(channelId ?? ''));
    const entry = membros?.get(socket.id);
    if (!entry) return;

    entry.state = {
      muted: Boolean(state.muted),
      // Sem info explicita, assume que tem microfone (comeco otimista de todo
      // socket, ate o primeiro voice:state chegar dizendo o contrario).
      hasMic: Boolean(state.hasMic ?? true),
      camera: Boolean(state.camera),
      screen: Boolean(state.screen),
      deafened: Boolean(state.deafened),
      // O cliente nao manda nisso: silencio imposto por moderador so sai
      // por voice:moderar, senao bastaria mandar um voice:state pra escapar.
      serverMuted: entry.state.serverMuted,
      serverDeafened: entry.state.serverDeafened,
    };
    broadcastParticipants(io, String(channelId), entry.guildId);
  });

  /**
   * Moderação de voz: silenciar/ensurdecer alguém no SERVIDOR (diferente de
   * silenciar só pra você). Quem é silenciado assim não consegue se
   * desmutar sozinho - por isso o estado mora aqui, e não no cliente.
   */
  socket.on('voice:moderar', ({ channelId, socketId, serverMuted, serverDeafened } = {}) => {
    const canal = String(channelId ?? '');
    const membros = rooms.get(canal);
    const meuRegistro = membros?.get(socket.id);
    const alvo = membros?.get(String(socketId ?? ''));
    if (!meuRegistro || !alvo) return;

    const guildId = meuRegistro.guildId;
    if (!podeAgirSobre(guildId, user.id, alvo.user.id)) return;

    if (serverMuted !== undefined) {
      if (!can(guildId, user.id, PERM.SILENCIAR_MEMBROS)) return;
      alvo.state.serverMuted = Boolean(serverMuted);
    }
    if (serverDeafened !== undefined) {
      if (!can(guildId, user.id, PERM.ENSURDECER_MEMBROS)) return;
      alvo.state.serverDeafened = Boolean(serverDeafened);
      // Ensurdecido no servidor também fica mudo: é o par natural das duas
      // coisas, e é o que o Discord faz.
      if (serverDeafened) alvo.state.serverMuted = true;
    }

    io.to(String(socketId)).emit('voice:moderado', {
      channelId: canal,
      serverMuted: alvo.state.serverMuted,
      serverDeafened: alvo.state.serverDeafened,
    });
    broadcastParticipants(io, canal, guildId);
  });

  /**
   * Arrastar alguém pra outro canal de voz. O servidor não consegue abrir uma
   * conexão WebRTC no lugar da pessoa, então ele manda a ordem e o cliente
   * dela é quem entra - o efeito prático é o mesmo.
   */
  socket.on('voice:mover', ({ channelId, socketId, paraCanal } = {}) => {
    const canal = String(channelId ?? '');
    const membros = rooms.get(canal);
    const meuRegistro = membros?.get(socket.id);
    const alvo = membros?.get(String(socketId ?? ''));
    if (!meuRegistro || !alvo) return;
    if (!can(meuRegistro.guildId, user.id, PERM.MOVER_MEMBROS)) return;
    if (!podeAgirSobre(meuRegistro.guildId, user.id, alvo.user.id)) return;

    const destino = q.get(
      'SELECT * FROM channels WHERE id = ? AND guild_id = ? AND type = ?',
      String(paraCanal ?? ''), meuRegistro.guildId, 'voice',
    );
    if (!destino) return;

    io.to(String(socketId)).emit('voice:mover-para', { channelId: destino.id, nome: destino.name });
  });

  /** Dono/admin expulsa na hora, sem precisar de votação. */
  socket.on('voice:expulsar', ({ channelId, socketId } = {}) => {
    const canal = String(channelId ?? '');
    const alvoId = String(socketId ?? '');
    const membros = rooms.get(canal);
    const meuRegistro = membros?.get(socket.id);
    if (!meuRegistro || !membros?.has(alvoId) || alvoId === socket.id) return;
    if (!hasRole(meuRegistro.guildId, user.id, 'admin')) return;

    io.to(alvoId).emit('voice:kicked', { motivo: 'expulso' });
    removeFromRoom(io, alvoId, canal);
  });

  /**
   * Voto de expulsão: precisa de maioria de quem MAIS está na call (sem
   * contar o alvo) pra valer. Isso existe pra gente que não é dono/admin
   * poder se defender de alguém incomodando, sem dar esse poder de graça
   * pra qualquer um sozinho.
   */
  socket.on('voice:votar-expulsao', ({ channelId, socketId } = {}) => {
    const canal = String(channelId ?? '');
    const membros = rooms.get(canal);
    const alvoId = String(socketId ?? '');
    if (!membros?.has(socket.id) || !membros.has(alvoId) || alvoId === socket.id) return;

    if (!votosDeExpulsao.has(canal)) votosDeExpulsao.set(canal, new Map());
    const votosDoCanl = votosDeExpulsao.get(canal);
    if (!votosDoCanl.has(alvoId)) votosDoCanl.set(alvoId, new Set());
    const votantes = votosDoCanl.get(alvoId);
    votantes.add(socket.id);

    const necessario = Math.ceil((membros.size - 1) / 2);
    io.to(`voice:${canal}`).emit('voice:votacao', {
      channelId: canal, socketId: alvoId, votos: votantes.size, necessario,
    });

    if (votantes.size >= necessario) {
      votosDoCanl.delete(alvoId);
      io.to(alvoId).emit('voice:kicked', { motivo: 'expulso' });
      removeFromRoom(io, alvoId, canal);
    }
  });

  /**
   * "Puxar" alguém pra call: manda um convite pra sala/DM da pessoa, ela
   * decide se entra. Não entra ninguém à força - só o convite.
   */
  socket.on('voice:convidar', ({ userId } = {}) => {
    let meuCanal = null;
    for (const [canal, membros] of rooms) {
      if (membros.has(socket.id)) { meuCanal = canal; break; }
    }
    if (!meuCanal) return;

    const entry = rooms.get(meuCanal).get(socket.id);
    if (!isMember(entry.guildId, String(userId ?? ''))) return;

    const canalInfo = q.get('SELECT name FROM channels WHERE id = ?', meuCanal);
    io.to(`user:${userId}`).emit('voice:convite', {
      de: user,
      channelId: meuCanal,
      guildId: entry.guildId,
      channelName: canalInfo?.name ?? 'chamada',
    });
  });

  socket.on('disconnect', () => {
    for (const [channelId, membros] of [...rooms]) {
      if (membros.has(socket.id)) removeFromRoom(io, socket.id, channelId);
    }
  });
}

/** Canal apagado: derruba a sala junto. */
export function dropVoiceRoom(io, channelId, guildId) {
  if (!rooms.has(channelId)) return;
  rooms.delete(channelId);
  io.to(`guild:${guildId}`).emit('voice:participants', { channelId, guildId, participants: [] });
}
