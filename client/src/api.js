const TOKEN_KEY = 'discord-caseiro:token';

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (token) => localStorage.setItem(TOKEN_KEY, token);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

/** Erro com a mensagem que o backend mandou, pra mostrar direto na tela. */
export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function request(method, path, body) {
  const token = getToken();
  const res = await fetch(`/api${path}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;

  if (!res.ok) {
    if (res.status === 401) clearToken();
    throw new ApiError(data?.error ?? `erro ${res.status}`, res.status);
  }
  return data;
}

/** Upload usa FormData: o navegador precisa montar o content-type sozinho. */
async function upload(path, formData) {
  const token = getToken();
  const res = await fetch(`/api${path}`, {
    method: 'POST',
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body: formData,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    if (res.status === 401) clearToken();
    throw new ApiError(data?.error ?? `erro ${res.status}`, res.status);
  }
  return data;
}

export const api = {
  health: () => request('GET', '/health'),

  register: (payload) => request('POST', '/auth/register', payload),
  login: (payload) => request('POST', '/auth/login', payload),
  me: () => request('GET', '/auth/me'),

  uploadAvatar: (file, crop) => {
    const form = new FormData();
    form.append('file', file);
    if (crop) form.append('crop', JSON.stringify(crop));
    return upload('/users/me/avatar', form);
  },
  deleteAvatar: () => request('DELETE', '/users/me/avatar'),

  uploadBanner: (file, crop) => {
    const form = new FormData();
    form.append('file', file);
    if (crop) form.append('crop', JSON.stringify(crop));
    return upload('/users/me/banner', form);
  },
  deleteBanner: () => request('DELETE', '/users/me/banner'),
  getProfile: (userId) => request('GET', `/users/${userId}`),
  updateProfile: (payload) => request('PATCH', '/users/me', payload),
  mudarSenha: (senhaAtual, senhaNova) => request('POST', '/users/me/senha', { senhaAtual, senhaNova }),

  listGuilds: () => request('GET', '/guilds'),
  createGuild: (payload) => request('POST', '/guilds', payload),
  getGuild: (guildId) => request('GET', `/guilds/${guildId}`),
  updateGuild: (guildId, payload) => request('PATCH', `/guilds/${guildId}`, payload),

  reportarBug: ({ title, whatHappens, whatStopsWorking, howToFix, images }) => {
    const form = new FormData();
    form.append('title', title);
    form.append('whatHappens', whatHappens);
    form.append('whatStopsWorking', whatStopsWorking);
    if (howToFix) form.append('howToFix', howToFix);
    for (const img of images ?? []) form.append('images', img);
    return upload('/reports', form);
  },

  uploadGuildIcon: (guildId, file, crop) => {
    const form = new FormData();
    form.append('file', file);
    if (crop) form.append('crop', JSON.stringify(crop));
    return upload(`/guilds/${guildId}/icon`, form);
  },
  deleteGuildIcon: (guildId) => request('DELETE', `/guilds/${guildId}/icon`),
  deleteGuild: (guildId) => request('DELETE', `/guilds/${guildId}`),

  listBans: (guildId) => request('GET', `/guilds/${guildId}/bans`),
  banirMembro: (guildId, userId, reason) =>
    request('POST', `/guilds/${guildId}/bans/${userId}`, { reason }),
  desbanir: (guildId, userId) => request('DELETE', `/guilds/${guildId}/bans/${userId}`),

  auditoria: (guildId) => request('GET', `/guilds/${guildId}/audit`),

  naoLidas: (guildId) => request('GET', `/guilds/${guildId}/unread`),
  createChannel: (guildId, payload) => request('POST', `/guilds/${guildId}/channels`, payload),
  deleteChannel: (guildId, channelId) => request('DELETE', `/guilds/${guildId}/channels/${channelId}`),
  reordenarCanais: (guildId, ordem) => request('PATCH', `/guilds/${guildId}/channels-ordem`, { ordem }),

  createInvite: (guildId, opts = {}) => request('POST', `/guilds/${guildId}/invites`, opts),
  listInvites: (guildId) => request('GET', `/guilds/${guildId}/invites`),
  deleteInvite: (guildId, code) => request('DELETE', `/guilds/${guildId}/invites/${code}`),
  previewInvite: (code) => request('GET', `/invites/${code}`),
  joinInvite: (code) => request('POST', `/invites/${code}/join`, {}),

  setMemberRole: (guildId, userId, role) =>
    request('PATCH', `/guilds/${guildId}/members/${userId}`, { role }),
  removeMember: (guildId, userId) => request('DELETE', `/guilds/${guildId}/members/${userId}`),

  setNickname: (guildId, userId, nickname) =>
    request('PATCH', `/guilds/${guildId}/members/${userId}/nickname`, { nickname }),
  timeoutMember: (guildId, userId, minutos) =>
    request('POST', `/guilds/${guildId}/members/${userId}/timeout`, { minutos }),
  banMember: (guildId, userId, reason) =>
    request('POST', `/guilds/${guildId}/bans/${userId}`, { reason }),
  unbanMember: (guildId, userId) => request('DELETE', `/guilds/${guildId}/bans/${userId}`),
  listBans: (guildId) => request('GET', `/guilds/${guildId}/bans`),

  listRoles: (guildId) => request('GET', `/guilds/${guildId}/roles`),
  createRole: (guildId, payload) => request('POST', `/guilds/${guildId}/roles`, payload),
  updateRole: (guildId, roleId, payload) =>
    request('PATCH', `/guilds/${guildId}/roles/${roleId}`, payload),
  deleteRole: (guildId, roleId) => request('DELETE', `/guilds/${guildId}/roles/${roleId}`),
  addMemberRole: (guildId, userId, roleId) =>
    request('PUT', `/guilds/${guildId}/members/${userId}/roles/${roleId}`),
  removeMemberRole: (guildId, userId, roleId) =>
    request('DELETE', `/guilds/${guildId}/members/${userId}/roles/${roleId}`),

  updateChannel: (guildId, channelId, payload) =>
    request('PATCH', `/guilds/${guildId}/channels/${channelId}`, payload),
  createCategory: (guildId, name) => request('POST', `/guilds/${guildId}/categories`, { name }),
  deleteCategory: (guildId, categoryId) =>
    request('DELETE', `/guilds/${guildId}/categories/${categoryId}`),

  messages: (channelId, { before, limit = 50 } = {}) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (before) params.set('before', before);
    return request('GET', `/channels/${channelId}/messages?${params}`);
  },
  pins: (channelId) => request('GET', `/channels/${channelId}/pins`),
  getEmbed: (url) => request('GET', `/embed?url=${encodeURIComponent(url)}`),
  watchSearch: (q, kind = 'serie') =>
    request('GET', `/watch/search?q=${encodeURIComponent(q)}&kind=${encodeURIComponent(kind)}`),
  watchEpisodes: (imdbId) => request('GET', `/watch/episodes?imdbId=${encodeURIComponent(imdbId)}`),
  watchPlayer: (payload) => request('POST', '/watch/player', payload),
  buscarNoCanal: (channelId, termo) =>
    request('GET', `/channels/${channelId}/search?q=${encodeURIComponent(termo)}`),

  getNote: (userId) => request('GET', `/prefs/notes/${userId}`),
  setNote: (userId, note) => request('PUT', `/prefs/notes/${userId}`, { note }),
  listNotificationSettings: () => request('GET', '/prefs/notifications'),
  setNotificationSetting: (payload) => request('PUT', '/prefs/notifications', payload),

  listDms: () => request('GET', '/dms'),
  dmContatos: () => request('GET', '/dms/contatos'),
  openDm: (userId) => request('POST', '/dms', { userId }),
  dmMessages: (dmChannelId, { before, limit = 50 } = {}) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (before) params.set('before', before);
    return request('GET', `/dms/${dmChannelId}/messages?${params}`);
  },

  uploadAttachment: (file) => {
    const form = new FormData();
    form.append('file', file);
    return upload('/attachments', form);
  },
  gifsTrending: () => request('GET', '/gifs/trending'),
  gifsBuscar: (q) => request('GET', `/gifs/buscar?q=${encodeURIComponent(q)}`),

  adminStats: () => request('GET', '/admin/stats'),
  adminReload: () => request('POST', '/admin/reload'),
};
