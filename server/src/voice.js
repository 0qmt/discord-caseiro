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

// Sessao de assistir junto por canal de voz. Tambem vive so em memoria.
const watchSessions = new Map();
const watchVotes = new Map();
const convitesDeCall = new Map();
const DURACAO_CONVITE_MS = 30_000;

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

function watchSessionSnapshot(session) {
  if (!session) return null;
  const position = session.status === 'playing'
    ? session.position + ((Date.now() - session.updatedAt) / 1000)
    : session.position;
  return { ...session, viewers: [...session.viewers], position };
}

function watchSessionsFor(channelId) {
  return [...watchSessions.values()]
    .filter((session) => session.channelId === String(channelId))
    .map(watchSessionSnapshot);
}

function watchProposalsFor(channelId) {
  return [...watchVotes.values()]
    .filter((proposal) => proposal.channelId === String(channelId))
    .map((proposal) => ({
      ...proposal,
      votes: [...proposal.votes],
      needed: proposal.needed,
    }));
}

function normalizarMedia(media) {
  if (!media?.url) return null;
  const url = new URL(media.url);
  if (url.protocol !== 'https:' || url.hostname !== 'superflixapi.beer') return null;
  return {
    id: String(media.id ?? url.pathname).slice(0, 160),
    kind: media.kind === 'filme' ? 'filme' : 'serie',
    imdbId: /^tt\d+$/.test(String(media.imdbId ?? '')) ? media.imdbId : null,
    title: String(media.title ?? 'Assistindo junto').slice(0, 120),
    subtitle: String(media.subtitle ?? '').slice(0, 120),
    poster: typeof media.poster === 'string' ? media.poster : null,
    url: url.href,
  };
}

function membroDaVoz(channelId, socketId) {
  const membros = rooms.get(String(channelId ?? ''));
  const entry = membros?.get(socketId);
  return { membros, entry, channelId: String(channelId ?? '') };
}

function broadcastWatch(io, channelId) {
  const sessions = watchSessionsFor(channelId);
  io.to(`voice:${channelId}`).emit('watch:update', {
    channelId,
    session: sessions[0] ?? null,
    sessions,
    proposals: watchProposalsFor(channelId),
  });
}

function removeFromRoom(io, socketId, channelId) {
  const membros = rooms.get(channelId);
  const entry = membros?.get(socketId);
  if (!entry) return;

  membros.delete(socketId);
  if (membros.size === 0) {
    rooms.delete(channelId);
    votosDeExpulsao.delete(channelId);
    for (const [id, session] of [...watchSessions]) {
      if (session.channelId === channelId) watchSessions.delete(id);
    }
    for (const [id, proposal] of [...watchVotes]) {
      if (proposal.channelId === channelId) watchVotes.delete(id);
    }
  }
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
    socket.emit('watch:sync', {
      channelId: channel.id,
      session: watchSessionsFor(channel.id)[0] ?? null,
      sessions: watchSessionsFor(channel.id),
      proposals: watchProposalsFor(channel.id),
    });

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

    /*
     * Arrastar a si mesmo pra outro canal de voz vale sempre, sem cargo
     * nenhum: é o mesmo que sair e entrar na outra sala, coisa que qualquer
     * um já pode fazer clicando. Exigir permissão aqui só tornaria o gesto
     * mais chato que o clique, sem proteger nada.
     *
     * Mover OS OUTROS continua exigindo a permissão e a hierarquia.
     */
    const souEu = String(socketId ?? '') === socket.id;
    if (!souEu) {
      if (!can(meuRegistro.guildId, user.id, PERM.MOVER_MEMBROS)) return;
      if (!podeAgirSobre(meuRegistro.guildId, user.id, alvo.user.id)) return;
    }

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

    const alvoId = String(userId);
    const conviteAnterior = [...convitesDeCall.values()].find((convite) => convite.alvoId === alvoId);
    if (conviteAnterior) return;

    const canalInfo = q.get('SELECT name FROM channels WHERE id = ?', meuCanal);
    const id = `${socket.id}:${Date.now()}`;
    const convite = { id, chamadorSocketId: socket.id, chamadorId: user.id, alvoId, channelId: meuCanal };
    convitesDeCall.set(id, convite);
    const expira = setTimeout(() => {
      if (!convitesDeCall.delete(id)) return;
      io.to(`user:${alvoId}`).emit('voice:convite-expirou', { id });
      io.to(socket.id).emit('voice:convite-resultado', { id, resultado: 'nao-atendeu' });
    }, DURACAO_CONVITE_MS);
    convite.expira = expira;

    io.to(`user:${alvoId}`).emit('voice:convite', {
      id,
      de: user,
      channelId: meuCanal,
      guildId: entry.guildId,
      channelName: canalInfo?.name ?? 'chamada',
      expiresAt: Date.now() + DURACAO_CONVITE_MS,
    });
  });

  socket.on('voice:convite-responder', ({ id, resposta } = {}) => {
    const convite = convitesDeCall.get(String(id ?? ''));
    if (!convite || convite.alvoId !== user.id) return;
    clearTimeout(convite.expira);
    convitesDeCall.delete(convite.id);
    const resultado = resposta === 'aceitar' ? 'aceitou' : 'recusou';
    io.to(convite.chamadorSocketId).emit('voice:convite-resultado', { id: convite.id, resultado });
    io.to(socket.id).emit('voice:convite-encerrado', { id: convite.id });
  });

  socket.on('voice:convite-cancelar', ({ userId } = {}) => {
    const alvoId = String(userId ?? '');
    const convite = [...convitesDeCall.values()].find((item) => (
      item.chamadorSocketId === socket.id && item.alvoId === alvoId
    ));
    if (!convite) return;

    clearTimeout(convite.expira);
    convitesDeCall.delete(convite.id);
    io.to(`user:${convite.alvoId}`).emit('voice:convite-encerrado', { id: convite.id });
  });

  socket.on('watch:start', ({ channelId, media } = {}, ack) => {
    const respond = (data) => (typeof ack === 'function' ? ack(data) : undefined);
    const { membros, entry, channelId: canal } = membroDaVoz(channelId, socket.id);
    if (!membros || !entry) return respond({ error: 'voce precisa estar na chamada' });

    let clean;
    try { clean = normalizarMedia(media); } catch { clean = null; }
    if (!clean) return respond({ error: 'player invalido' });

    const id = `${canal}:${socket.id}:${Date.now()}`;
    watchSessions.set(id, {
      id,
      channelId: canal,
      guildId: entry.guildId,
      media: clean,
      status: 'playing',
      position: 0,
      updatedAt: Date.now(),
      startedBy: entry.user,
      ownerSocketId: socket.id,
      viewers: new Set([socket.id]),
    });
    broadcastWatch(io, canal);
    return respond({ ok: true, session: watchSessionSnapshot(watchSessions.get(id)) });
  });

  socket.on('watch:join', ({ channelId, sessionId } = {}, ack) => {
    const respond = (data) => (typeof ack === 'function' ? ack(data) : undefined);
    const { membros, channelId: canal } = membroDaVoz(channelId, socket.id);
    const session = watchSessions.get(String(sessionId ?? ''));
    if (!membros || !session || session.channelId !== canal) return respond({ error: 'sessao nao encontrada' });
    session.viewers.add(socket.id);
    broadcastWatch(io, canal);
    return respond({ ok: true, session: watchSessionSnapshot(session) });
  });

  socket.on('watch:leave', ({ channelId, sessionId } = {}, ack) => {
    const respond = (data) => (typeof ack === 'function' ? ack(data) : undefined);
    const { membros, channelId: canal } = membroDaVoz(channelId, socket.id);
    const session = watchSessions.get(String(sessionId ?? ''));
    if (!membros || !session || session.channelId !== canal) return respond({ error: 'sessao nao encontrada' });
    session.viewers.delete(socket.id);
    broadcastWatch(io, canal);
    return respond({ ok: true });
  });

  socket.on('watch:stop', ({ channelId, sessionId } = {}, ack) => {
    const respond = (data) => (typeof ack === 'function' ? ack(data) : undefined);
    const { membros, channelId: canal } = membroDaVoz(channelId, socket.id);
    const id = String(sessionId ?? '');
    const session = watchSessions.get(id);
    if (!membros || !session || session.channelId !== canal) return respond({ error: 'sessao nao encontrada' });
    watchSessions.delete(id);
    for (const [proposalId, proposal] of [...watchVotes]) {
      if (proposal.sessionId === id) watchVotes.delete(proposalId);
    }
    broadcastWatch(io, canal);
    return respond({ ok: true });
  });

  socket.on('watch:control', ({ channelId, sessionId, status, position } = {}, ack) => {
    const respond = (data) => (typeof ack === 'function' ? ack(data) : undefined);
    const { membros, channelId: canal } = membroDaVoz(channelId, socket.id);
    const session = watchSessions.get(String(sessionId ?? ''));
    if (!membros || !session || session.channelId !== canal) return respond({ error: 'sessao nao encontrada' });

    const current = watchSessionSnapshot(session);
    session.position = Number.isFinite(Number(position)) ? Math.max(0, Number(position)) : current.position;
    session.status = status === 'paused' ? 'paused' : 'playing';
    session.updatedAt = Date.now();
    broadcastWatch(io, canal);
    return respond({ ok: true, session: watchSessionSnapshot(session) });
  });

  socket.on('watch:propose-control', ({ channelId, sessionId, status, position } = {}, ack) => {
    const respond = (data) => (typeof ack === 'function' ? ack(data) : undefined);
    const { membros, entry, channelId: canal } = membroDaVoz(channelId, socket.id);
    const session = watchSessions.get(String(sessionId ?? ''));
    if (!membros || !entry || !session || session.channelId !== canal) return respond({ error: 'sessao nao encontrada' });
    if (!session.viewers.has(socket.id)) return respond({ error: 'entre na sessao antes de controlar' });

    const viewers = [...session.viewers].filter((id) => membros.has(id));
    const id = `vote:${session.id}:${Date.now()}`;
    const proposal = {
      id,
      channelId: canal,
      sessionId: session.id,
      requestedBy: entry.user,
      status: status === 'paused' ? 'paused' : 'playing',
      position: Number.isFinite(Number(position)) ? Math.max(0, Number(position)) : watchSessionSnapshot(session).position,
      votes: new Set([socket.id]),
      eligible: viewers,
      needed: Math.max(1, Math.ceil(viewers.length / 2)),
      createdAt: Date.now(),
    };
    watchVotes.set(id, proposal);

    if (proposal.votes.size >= proposal.needed) {
      session.position = proposal.position;
      session.status = proposal.status;
      session.updatedAt = Date.now();
      watchVotes.delete(id);
    }
    broadcastWatch(io, canal);
    return respond({ ok: true });
  });

  socket.on('watch:vote-control', ({ channelId, proposalId, approve } = {}, ack) => {
    const respond = (data) => (typeof ack === 'function' ? ack(data) : undefined);
    const { membros, channelId: canal } = membroDaVoz(channelId, socket.id);
    const proposal = watchVotes.get(String(proposalId ?? ''));
    if (!membros || !proposal || proposal.channelId !== canal) return respond({ error: 'votacao nao encontrada' });
    if (!proposal.eligible.includes(socket.id)) return respond({ error: 'voce nao esta nessa sessao' });
    if (approve === false) watchVotes.delete(proposal.id);
    else proposal.votes.add(socket.id);

    const session = watchSessions.get(proposal.sessionId);
    if (session && proposal.votes.size >= proposal.needed) {
      session.position = proposal.position;
      session.status = proposal.status;
      session.updatedAt = Date.now();
      watchVotes.delete(proposal.id);
    }
    broadcastWatch(io, canal);
    return respond({ ok: true });
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
