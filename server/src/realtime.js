import { Server } from 'socket.io';
import { config } from './config.js';
import { q } from './db.js';
import { userFromToken } from './lib/auth.js';
import { setIo } from './lib/bus.js';
import { newId } from './lib/ids.js';
import {
  canInChannel, dmParticipants, estaDeCastigo, guildIdOfChannel, isMember, PERM,
} from './lib/permissions.js';
import { dmMessageDto, messageDto, publicUser, reactionsOf } from './lib/serialize.js';
import { registerVoiceHandlers } from './voice.js';

const MAX_MESSAGE_LENGTH = 4000;
const RATE_LIMIT = { messages: 10, windowMs: 5000 };

/**
 * Anexo e opcional; quando vem, valida a forma minima e de onde a url pode
 * vir - arquivo enviado por nos mesmos (/uploads/...) ou gif vindo direto do
 * Giphy (a gente nunca baixa o gif pro nosso servidor, so guarda o link).
 */
function anexoValido(bruto) {
  if (!bruto || typeof bruto !== 'object') return null;
  const url = String(bruto.url ?? '');
  const type = String(bruto.type ?? '');
  const name = String(bruto.name ?? '').slice(0, 200) || null;
  if (!['image', 'video', 'audio', 'file', 'gif'].includes(type)) return null;
  if (type === 'gif') {
    if (!url.startsWith('https://')) return null;
  } else if (!url.startsWith('/uploads/')) {
    return null;
  }
  return { url, type, name };
}

/** userId -> Set<socketId>. Alguem pode estar em varias abas ao mesmo tempo. */
const online = new Map();

/**
 * userId -> { status, activity }. Status e o que a pessoa escolheu
 * (online/ausente/nao perturbe/invisivel); activity e o que o app de desktop
 * detectou que ela esta rodando ("Jogando X"). Nada disso vai pro banco: some
 * quando ela desconecta, que e exatamente o que a gente quer.
 */
const presencas = new Map();

const STATUS_VALIDOS = new Set(['online', 'idle', 'dnd', 'invisible']);
const TIPOS_DE_ATIVIDADE = new Set(['jogo', 'musica', 'custom']);

/** Só imagem embutida: URL de fora aqui viraria um jeito de rastrear quem viu. */
const IMAGEM_OK = (v) => typeof v === 'string' && v.startsWith('data:image/') && v.length <= 24_000;

/**
 * Peneira a atividade que o cliente manda.
 *
 * Aceita as duas formas: o objeto novo ({ tipo, nome, detalhe, desde,
 * imagem }) e a string antiga - versão velha do app de desktop continua
 * mandando string, e derrubar a atividade dela por causa disso seria uma
 * regressão silenciosa pra quem não atualizou.
 */
function atividadeValida(bruta) {
  if (bruta === null) return null;

  if (typeof bruta === 'string') {
    const texto = bruta.trim().slice(0, 64);
    return texto ? { tipo: 'custom', nome: texto, detalhe: null, desde: null, imagem: null } : null;
  }

  if (typeof bruta !== 'object') return null;
  const nome = String(bruta.nome ?? '').trim().slice(0, 80);
  if (!nome) return null;

  const desde = Number(bruta.desde);
  return {
    tipo: TIPOS_DE_ATIVIDADE.has(bruta.tipo) ? bruta.tipo : 'custom',
    nome,
    detalhe: String(bruta.detalhe ?? '').trim().slice(0, 80) || null,
    // Só instante no passado e recente: um `desde` no futuro (ou de anos
    // atrás) viraria "jogando há -3 min" ou "há 400 dias" na tela.
    desde: Number.isFinite(desde) && desde > Date.now() - 7 * 24 * 3600_000 && desde <= Date.now()
      ? desde
      : null,
    imagem: IMAGEM_OK(bruta.imagem) ? bruta.imagem : null,
  };
}

const presencaDe = (userId) => presencas.get(userId) ?? { status: 'online', activity: null };

/** O que os outros podem ver: quem esta invisivel aparece como offline. */
function presencaPublica(userId) {
  const p = presencaDe(userId);
  const conectado = online.has(userId);
  return {
    userId,
    online: conectado && p.status !== 'invisible',
    status: p.status === 'invisible' ? 'offline' : p.status,
    activity: p.status === 'invisible' ? null : p.activity,
  };
}

const guildIdsOf = (userId) =>
  q.all('SELECT guild_id FROM guild_members WHERE user_id = ?', userId).map((r) => r.guild_id);

/**
 * Reagir e desreagir sao a mesma acao vista de dois lados: se o emoji ja
 * estava la, o clique tira; se nao, poe. Vale igual pra mensagem de canal e
 * de DM porque os ids nao se repetem entre as duas tabelas.
 */
function alternarReacao(messageId, userId, emoji) {
  const jaTem = q.get(
    'SELECT 1 FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?',
    messageId, userId, emoji,
  );
  if (jaTem) {
    q.run(
      'DELETE FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?',
      messageId, userId, emoji,
    );
  } else {
    q.run(
      'INSERT INTO message_reactions (message_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?)',
      messageId, userId, emoji, Date.now(),
    );
  }
  return reactionsOf(messageId);
}

/** Recarrega a mensagem do banco ja com o autor junto e devolve o DTO pronto. */
function montarDto(id, tabela) {
  const linha = q.get(
    `SELECT m.*, u.username, u.avatar_url, u.avatar_crop, u.handle
     FROM ${tabela} m JOIN users u ON u.id = m.author_id WHERE m.id = ?`,
    id,
  );
  if (!linha) return null;
  return tabela === 'messages' ? messageDto(linha) : dmMessageDto(linha);
}

/** Emoji cru, sem nome de arquivo nem html - so um punhado de caracteres. */
const emojiValido = (bruto) => {
  const emoji = String(bruto ?? '').trim();
  return emoji.length >= 1 && emoji.length <= 16 && !/[<>\s]/.test(emoji) ? emoji : null;
};

export function attachRealtime(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: config.clientOrigins, credentials: true },
  });
  setIo(io);

  // Autenticacao no handshake: sem token valido, a conexao nem abre.
  io.use((socket, next) => {
    const user = userFromToken(socket.handshake.auth?.token);
    if (!user) return next(new Error('nao autenticado'));
    socket.data.user = user;
    socket.data.messageTimestamps = [];
    next();
  });

  io.on('connection', (socket) => {
    const user = socket.data.user;

    registerVoiceHandlers(io, socket);

    socket.join(`user:${user.id}`);
    for (const guildId of guildIdsOf(user.id)) socket.join(`guild:${guildId}`);

    const sockets = online.get(user.id) ?? new Set();
    const wasOffline = sockets.size === 0;
    sockets.add(socket.id);
    online.set(user.id, sockets);

    // Estado inicial de presenca pra quem acabou de entrar: quem esta online,
    // com que status e fazendo o que.
    socket.emit('presence:sync', {
      online: [...online.keys()].filter((id) => presencaDe(id).status !== 'invisible'),
      presences: [...online.keys()].map(presencaPublica).filter((p) => p.online),
    });
    if (wasOffline) {
      socket.broadcast.emit('presence:update', presencaPublica(user.id));
    }

    /** Entrou num servidor novo por convite: passa a receber os eventos dele. */
    socket.on('guild:subscribe', ({ guildId } = {}) => {
      if (guildId && isMember(guildId, user.id)) socket.join(`guild:${guildId}`);
    });

    socket.on('guild:unsubscribe', ({ guildId } = {}) => {
      if (guildId) socket.leave(`guild:${guildId}`);
    });

    socket.on('message:send', (payload = {}, ack) => {
      const respond = (data) => (typeof ack === 'function' ? ack(data) : undefined);

      const channelId = String(payload.channelId ?? '');
      const content = String(payload.content ?? '').trim();
      const anexo = anexoValido(payload.attachment);

      if (!content && !anexo) return respond({ error: 'mensagem vazia' });
      if (content.length > MAX_MESSAGE_LENGTH) {
        return respond({ error: `mensagem passa de ${MAX_MESSAGE_LENGTH} caracteres` });
      }

      const now = Date.now();
      const recent = socket.data.messageTimestamps.filter((t) => now - t < RATE_LIMIT.windowMs);
      if (recent.length >= RATE_LIMIT.messages) {
        return respond({ error: 'calma la, muitas mensagens de uma vez' });
      }
      socket.data.messageTimestamps = [...recent, now];

      const guildId = guildIdOfChannel(channelId);
      if (!guildId) return respond({ error: 'canal nao encontrado' });
      if (!isMember(guildId, user.id)) return respond({ error: 'voce nao e membro desse servidor' });
      if (estaDeCastigo(guildId, user.id)) return respond({ error: 'voce esta de castigo nesse servidor' });
      if (!canInChannel(channelId, user.id, PERM.ENVIAR_MENSAGEM)) {
        return respond({ error: 'voce nao pode falar nesse canal' });
      }

      // Responder so vale pra mensagem do mesmo canal - senao daria pra
      // "responder" algo de um canal privado e vazar o texto na previa.
      const replyToId = String(payload.replyToId ?? '') || null;
      const alvo = replyToId
        ? q.get('SELECT id FROM messages WHERE id = ? AND channel_id = ?', replyToId, channelId)
        : null;

      const message = {
        id: newId(), channel_id: channelId, author_id: user.id, content, created_at: now,
        attachment_url: anexo?.url ?? null, attachment_type: anexo?.type ?? null, attachment_name: anexo?.name ?? null,
        reply_to_id: alvo?.id ?? null, edited_at: null, pinned_at: null,
      };
      q.run(
        `INSERT INTO messages (id, channel_id, author_id, content, created_at, attachment_url, attachment_type, attachment_name, reply_to_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        message.id, channelId, user.id, content, now, message.attachment_url,
        message.attachment_type, message.attachment_name, message.reply_to_id,
      );

      // Le o perfil na hora: o socket foi autenticado uma vez, mas a pessoa
      // pode ter trocado o avatar depois de conectar.
      const author = q.get(
        'SELECT id, username, handle, avatar_url, avatar_crop FROM users WHERE id = ?', user.id,
      );
      const dto = messageDto({
        ...message,
        username: author.username,
        handle: author.handle,
        avatar_url: author.avatar_url,
        avatar_crop: author.avatar_crop,
      });
      // Vai pra guild inteira (nao so pro canal aberto) pra alimentar
      // indicador de nao-lidas nos outros canais.
      io.to(`guild:${guildId}`).emit('message:new', { guildId, message: dto });
      respond({ message: dto, nonce: payload.nonce ?? null });
    });

    socket.on('dm:send', (payload = {}, ack) => {
      const respond = (data) => (typeof ack === 'function' ? ack(data) : undefined);

      const dmChannelId = String(payload.dmChannelId ?? '');
      const content = String(payload.content ?? '').trim();
      const anexo = anexoValido(payload.attachment);

      if (!content && !anexo) return respond({ error: 'mensagem vazia' });
      if (content.length > MAX_MESSAGE_LENGTH) {
        return respond({ error: `mensagem passa de ${MAX_MESSAGE_LENGTH} caracteres` });
      }

      const now = Date.now();
      const recent = socket.data.messageTimestamps.filter((t) => now - t < RATE_LIMIT.windowMs);
      if (recent.length >= RATE_LIMIT.messages) {
        return respond({ error: 'calma la, muitas mensagens de uma vez' });
      }
      socket.data.messageTimestamps = [...recent, now];

      const participantes = dmParticipants(dmChannelId);
      if (!participantes) return respond({ error: 'conversa nao encontrada' });
      if (!participantes.includes(user.id)) return respond({ error: 'voce nao faz parte dessa conversa' });

      const replyToId = String(payload.replyToId ?? '') || null;
      const alvo = replyToId
        ? q.get('SELECT id FROM dm_messages WHERE id = ? AND dm_channel_id = ?', replyToId, dmChannelId)
        : null;

      const message = {
        id: newId(), dm_channel_id: dmChannelId, author_id: user.id, content, created_at: now,
        attachment_url: anexo?.url ?? null, attachment_type: anexo?.type ?? null, attachment_name: anexo?.name ?? null,
        reply_to_id: alvo?.id ?? null, edited_at: null,
      };
      q.run(
        `INSERT INTO dm_messages (id, dm_channel_id, author_id, content, created_at, attachment_url, attachment_type, attachment_name, reply_to_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        message.id, dmChannelId, user.id, content, now, message.attachment_url,
        message.attachment_type, message.attachment_name, message.reply_to_id,
      );

      const author = q.get(
        'SELECT id, username, handle, avatar_url, avatar_crop FROM users WHERE id = ?', user.id,
      );
      const dto = dmMessageDto({
        ...message,
        username: author.username,
        handle: author.handle,
        avatar_url: author.avatar_url,
        avatar_crop: author.avatar_crop,
      });
      // Os dois lados tem sala 'user:<id>' desde a conexao (ver acima) - nao
      // precisa de uma sala por conversa so pra isso.
      for (const participanteId of participantes) io.to(`user:${participanteId}`).emit('dm:new', { message: dto });
      respond({ message: dto, nonce: payload.nonce ?? null });
    });

    socket.on('typing:start', ({ channelId } = {}) => {
      const guildId = guildIdOfChannel(String(channelId ?? ''));
      if (!guildId || !isMember(guildId, user.id)) return;
      socket.to(`guild:${guildId}`).emit('typing:start', {
        channelId, user: publicUser(user),
      });
    });

    /* --------------------------- reacoes --------------------------- */

    socket.on('message:react', ({ messageId, emoji } = {}) => {
      const id = String(messageId ?? '');
      const icone = emojiValido(emoji);
      if (!id || !icone) return;

      const daGuild = q.get('SELECT channel_id FROM messages WHERE id = ?', id);
      if (daGuild) {
        const guildId = guildIdOfChannel(daGuild.channel_id);
        if (!guildId || !isMember(guildId, user.id)) return;
        const reactions = alternarReacao(id, user.id, icone);
        io.to(`guild:${guildId}`).emit('message:reactions', {
          guildId, channelId: daGuild.channel_id, messageId: id, reactions,
        });
        return;
      }

      const daDm = q.get('SELECT dm_channel_id FROM dm_messages WHERE id = ?', id);
      if (!daDm) return;
      const participantes = dmParticipants(daDm.dm_channel_id);
      if (!participantes?.includes(user.id)) return;
      const reactions = alternarReacao(id, user.id, icone);
      for (const pid of participantes) {
        io.to(`user:${pid}`).emit('message:reactions', {
          dmChannelId: daDm.dm_channel_id, messageId: id, reactions,
        });
      }
    });

    /* ----------------------- editar / apagar ----------------------- */

    socket.on('message:edit', ({ messageId, content } = {}, ack) => {
      const respond = (data) => (typeof ack === 'function' ? ack(data) : undefined);
      const id = String(messageId ?? '');
      const texto = String(content ?? '').trim();
      if (!texto) return respond({ error: 'mensagem vazia' });
      if (texto.length > MAX_MESSAGE_LENGTH) return respond({ error: 'mensagem longa demais' });

      const daGuild = q.get('SELECT * FROM messages WHERE id = ?', id);
      const tabela = daGuild ? 'messages' : 'dm_messages';
      const msg = daGuild ?? q.get('SELECT * FROM dm_messages WHERE id = ?', id);
      if (!msg) return respond({ error: 'mensagem nao encontrada' });
      // Editar e so do autor - nem moderador reescreve o que outro disse.
      if (msg.author_id !== user.id) return respond({ error: 'so da pra editar a propria mensagem' });

      const agora = Date.now();
      q.run(`UPDATE ${tabela} SET content = ?, edited_at = ? WHERE id = ?`, texto, agora, id);
      const dto = montarDto(id, tabela);

      if (daGuild) {
        const guildId = guildIdOfChannel(msg.channel_id);
        io.to(`guild:${guildId}`).emit('message:updated', { guildId, message: dto });
      } else {
        for (const pid of dmParticipants(msg.dm_channel_id) ?? []) {
          io.to(`user:${pid}`).emit('message:updated', { message: dto });
        }
      }
      respond({ message: dto });
    });

    socket.on('message:delete', ({ messageId } = {}, ack) => {
      const respond = (data) => (typeof ack === 'function' ? ack(data) : undefined);
      const id = String(messageId ?? '');

      const daGuild = q.get('SELECT * FROM messages WHERE id = ?', id);
      if (daGuild) {
        const guildId = guildIdOfChannel(daGuild.channel_id);
        if (!guildId) return respond({ error: 'canal nao encontrado' });
        // Autor apaga a propria; quem modera apaga a de qualquer um.
        const podeModerar = canInChannel(daGuild.channel_id, user.id, PERM.GERENCIAR_MENSAGENS);
        if (daGuild.author_id !== user.id && !podeModerar) {
          return respond({ error: 'permissao insuficiente' });
        }
        q.run('DELETE FROM messages WHERE id = ?', id);
        q.run('DELETE FROM message_reactions WHERE message_id = ?', id);
        io.to(`guild:${guildId}`).emit('message:deleted', {
          guildId, channelId: daGuild.channel_id, messageId: id,
        });
        return respond({ ok: true });
      }

      const daDm = q.get('SELECT * FROM dm_messages WHERE id = ?', id);
      if (!daDm) return respond({ error: 'mensagem nao encontrada' });
      if (daDm.author_id !== user.id) return respond({ error: 'permissao insuficiente' });
      q.run('DELETE FROM dm_messages WHERE id = ?', id);
      q.run('DELETE FROM message_reactions WHERE message_id = ?', id);
      for (const pid of dmParticipants(daDm.dm_channel_id) ?? []) {
        io.to(`user:${pid}`).emit('message:deleted', {
          dmChannelId: daDm.dm_channel_id, messageId: id,
        });
      }
      return respond({ ok: true });
    });

    /* ---------------------------- fixar ---------------------------- */

    socket.on('message:pin', ({ messageId, pinned } = {}, ack) => {
      const respond = (data) => (typeof ack === 'function' ? ack(data) : undefined);
      const msg = q.get('SELECT * FROM messages WHERE id = ?', String(messageId ?? ''));
      if (!msg) return respond({ error: 'mensagem nao encontrada' });
      if (!canInChannel(msg.channel_id, user.id, PERM.GERENCIAR_MENSAGENS)) {
        return respond({ error: 'permissao insuficiente' });
      }
      q.run('UPDATE messages SET pinned_at = ? WHERE id = ?', pinned ? Date.now() : null, msg.id);
      const guildId = guildIdOfChannel(msg.channel_id);
      io.to(`guild:${guildId}`).emit('message:updated', {
        guildId, message: montarDto(msg.id, 'messages'),
      });
      return respond({ ok: true });
    });

    /* -------------------- presenca: status e jogo -------------------- */

    socket.on('presence:set', ({ status, activity } = {}) => {
      const atual = presencaDe(user.id);
      const novo = {
        status: STATUS_VALIDOS.has(status) ? status : atual.status,
        // activity === null limpa de proposito (fechou o jogo); undefined mantem.
        activity: activity === undefined
          ? atual.activity
          : atividadeValida(activity),
      };
      const mudou = novo.status !== atual.status
        || JSON.stringify(novo.activity) !== JSON.stringify(atual.activity);
      presencas.set(user.id, novo);
      if (mudou) io.emit('presence:update', presencaPublica(user.id));
    });

    /* ------------------------ marcar como lido ----------------------- */

    /*
     * `ate` opcional: normalmente marca tudo como lido ate agora, mas o
     * "marcar como nao lido" manda o instante logo ANTES da mensagem
     * escolhida - dali pra frente tudo volta a contar como nao lido.
     *
     * So aceita marca no passado. Sem esse limite, um cliente com relogio
     * adiantado (ou de ma fe) marcaria como lido mensagem que ainda nem
     * chegou, e o contador nunca mais subiria naquele canal.
     */
    socket.on('channel:read', ({ channelId, ate } = {}) => {
      const id = String(channelId ?? '');
      if (!id) return;
      const agora = Date.now();
      const marca = Number.isFinite(ate) ? Math.min(Number(ate), agora) : agora;
      q.run(
        `INSERT INTO read_state (user_id, channel_id, last_read_at) VALUES (?, ?, ?)
         ON CONFLICT(user_id, channel_id) DO UPDATE SET last_read_at = excluded.last_read_at`,
        user.id, id, marca,
      );
    });

    socket.on('disconnect', () => {
      const set = online.get(user.id);
      if (!set) return;
      set.delete(socket.id);
      if (set.size === 0) {
        online.delete(user.id);
        // A presenca some junto: status e jogo valem so enquanto ela esta
        // conectada, e sem isso a proxima sessao herdaria um "Jogando X" velho.
        presencas.delete(user.id);
        io.emit('presence:update', { userId: user.id, online: false, status: 'offline', activity: null });
      }
    });
  });

  return io;
}
