/**
 * Teste de fumaca de ponta a ponta: cadastro, servidor, convite, permissoes,
 * chat em tempo real e historico. Com o backend rodando:
 *
 *   npm run smoke
 */
import { io } from 'socket.io-client';

const BASE = process.env.SMOKE_BASE ?? 'http://localhost:3001';
const stamp = Date.now();

let passed = 0;
const failures = [];

function check(label, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${label}`);
  } else {
    failures.push(label);
    console.log(`  FALHOU ${label} ${detail}`);
  }
}

async function api(method, path, { token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  return { status: res.status, data };
}

/**
 * Registra os listeners ANTES de abrir a conexao: o servidor manda
 * presence:sync assim que o socket conecta, e o socket.io nao guarda eventos
 * pra handlers que so aparecem depois.
 */
const connect = (token, registerHandlers = () => {}) =>
  new Promise((resolve, reject) => {
    const socket = io(BASE, { auth: { token }, transports: ['websocket'], autoConnect: false });
    registerHandlers(socket);
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
    socket.connect();
  });

const waitFor = (socket, event, timeoutMs = 4000) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout esperando "${event}"`)), timeoutMs);
    socket.once(event, (payload) => { clearTimeout(timer); resolve(payload); });
  });

/**
 * Bytes minimos com a assinatura certa de cada formato. O servidor decide
 * pelo conteudo, entao nao precisa de imagem de verdade - so do cabecalho.
 */
const fakeImage = (kind) => {
  const bytes = {
    png: [0x89, ...Buffer.from('PNG'), 0x0d, 0x0a, 0x1a, 0x0a, ...Buffer.from('IHDR')],
    // APNG se declara com acTL antes do primeiro IDAT
    apng: [0x89, ...Buffer.from('PNG'), 0x0d, 0x0a, 0x1a, 0x0a,
      ...Buffer.from('IHDR'), ...Buffer.from('acTL'), ...Buffer.from('IDAT')],
    gif: [...Buffer.from('GIF89a')],
    // WEBP parado: sem o chunk estendido VP8X
    webp: [...Buffer.from('RIFF'), 0, 0, 0, 0, ...Buffer.from('WEBPVP8 ')],
    // WEBP animado: VP8X com o bit 0x02 nas flags (offset 20)
    webpanim: [...Buffer.from('RIFF'), 0, 0, 0, 0, ...Buffer.from('WEBPVP8X'),
      0, 0, 0, 0, 0x02],
    lixo: [...Buffer.from('isto nao e imagem nenhuma')],
  }[kind];
  return new Blob([new Uint8Array([...bytes, ...Buffer.alloc(64)])]);
};

async function uploadImage(token, alvo, kind, crop) {
  const form = new FormData();
  form.append('file', fakeImage(kind), `arquivo.${kind}`);
  if (crop) form.append('crop', JSON.stringify(crop));
  const res = await fetch(`${BASE}/api/users/me/${alvo}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}

const uploadAvatar = (token, kind, crop) => uploadImage(token, 'avatar', kind, crop);

async function uploadAttachment(token, conteudo, nome) {
  const form = new FormData();
  form.append('file', new Blob([conteudo]), nome);
  const res = await fetch(`${BASE}/api/attachments`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}

const register = (nick) =>
  api('POST', '/api/auth/register', {
    body: { email: `${nick}.${stamp}@teste.local`, username: nick, password: 'senha-de-teste-123' },
  });

async function main() {
  console.log(`\nTestando ${BASE}\n`);

  console.log('saude e autenticacao');
  const health = await api('GET', '/api/health');
  check('GET /api/health responde', health.data?.ok === true);

  const alice = (await register('alice')).data;
  const bob = (await register('bob')).data;
  check('cadastro devolve token e usuario', Boolean(alice?.token && alice?.user?.id));

  const dupe = await api('POST', '/api/auth/register', {
    body: { email: alice.user.email, username: 'clone', password: 'senha-de-teste-123' },
  });
  check('e-mail repetido e recusado (409)', dupe.status === 409, `-> ${dupe.status}`);

  const shortPass = await api('POST', '/api/auth/register', {
    body: { email: `curta.${stamp}@teste.local`, username: 'x', password: '123' },
  });
  check('senha curta e recusada (400)', shortPass.status === 400, `-> ${shortPass.status}`);

  const badLogin = await api('POST', '/api/auth/login', {
    body: { email: alice.user.email, password: 'senha-errada' },
  });
  check('senha errada e recusada (401)', badLogin.status === 401, `-> ${badLogin.status}`);

  const login = await api('POST', '/api/auth/login', {
    body: { email: alice.user.email, password: 'senha-de-teste-123' },
  });
  check('login com senha certa funciona', login.status === 200 && Boolean(login.data.token));

  const noToken = await api('GET', '/api/guilds');
  check('rota protegida sem token da 401', noToken.status === 401, `-> ${noToken.status}`);

  console.log('\nservidores e canais');
  const created = await api('POST', '/api/guilds', {
    token: alice.token, body: { name: 'Servidor de Teste' },
  });
  const guild = created.data?.guild;
  check('criar servidor devolve 201', created.status === 201, `-> ${created.status}`);
  check('servidor nasce com canal de texto e de voz',
    guild?.channels?.some((c) => c.type === 'text') && guild?.channels?.some((c) => c.type === 'voice'));
  check('quem cria vira dono', guild?.role === 'owner');

  const textChannel = guild.channels.find((c) => c.type === 'text');

  console.log('\nconvites');
  const invite = await api('POST', `/api/guilds/${guild.id}/invites`, { token: alice.token });
  const code = invite.data?.invite?.code;
  check('gerar convite devolve codigo', typeof code === 'string' && code.length === 8);

  const preview = await api('GET', `/api/invites/${code}`, { token: bob.token });
  check('espiar convite mostra o servidor', preview.data?.invite?.guild?.name === 'Servidor de Teste');

  const badCode = await api('GET', '/api/invites/NAOEXISTE', { token: bob.token });
  check('codigo invalido da 404', badCode.status === 404, `-> ${badCode.status}`);

  const joined = await api('POST', `/api/invites/${code}/join`, { token: bob.token });
  check('entrar por convite funciona', joined.status === 201, `-> ${joined.status}`);
  check('novo membro entra como member',
    joined.data?.guild?.members?.find((m) => m.id === bob.user.id)?.role === 'member');

  const detail = await api('GET', `/api/guilds/${guild.id}`, { token: alice.token });
  check('servidor agora tem 2 membros', detail.data?.guild?.members?.length === 2,
    `-> ${detail.data?.guild?.members?.length}`);

  console.log('\npermissoes');
  const bobChannel = await api('POST', `/api/guilds/${guild.id}/channels`, {
    token: bob.token, body: { name: 'proibido' },
  });
  check('membro comum nao cria canal (403)', bobChannel.status === 403, `-> ${bobChannel.status}`);

  const stranger = (await register('estranho')).data;
  const peek = await api('GET', `/api/guilds/${guild.id}`, { token: stranger.token });
  check('quem nao e membro nao ve o servidor (403)', peek.status === 403, `-> ${peek.status}`);

  const promote = await api('PATCH', `/api/guilds/${guild.id}/members/${bob.user.id}`, {
    token: alice.token, body: { role: 'admin' },
  });
  check('dono promove membro a admin', promote.status === 200, `-> ${promote.status}`);

  const bobChannel2 = await api('POST', `/api/guilds/${guild.id}/channels`, {
    token: bob.token, body: { name: 'agora vai', type: 'text' },
  });
  check('admin ja consegue criar canal (201)', bobChannel2.status === 201, `-> ${bobChannel2.status}`);

  console.log('\ntempo real');
  let capturePresence;
  const presenceArrived = new Promise((resolve) => { capturePresence = resolve; });
  const aliceSocket = await connect(alice.token, (s) => s.once('presence:sync', capturePresence));

  const presence = await Promise.race([
    presenceArrived,
    new Promise((resolve) => setTimeout(() => resolve(null), 4000)),
  ]);
  check('presence:sync chega ao conectar', Array.isArray(presence?.online));
  check('a propria alice ja aparece online no snapshot',
    presence?.online?.includes(alice.user.id) === true);

  // Alice conectou primeiro, entao ela precisa descobrir o bob por evento.
  const bobWentOnline = waitFor(aliceSocket, 'presence:update');
  const bobSocket = await connect(bob.token);
  check('socket conecta com token valido', aliceSocket.connected && bobSocket.connected);

  const update = await bobWentOnline.catch(() => null);
  check('alice e avisada quando o bob entra',
    update?.userId === bob.user.id && update?.online === true, JSON.stringify(update));

  const rejected = await connect('token-invalido').then(() => false).catch(() => true);
  check('socket com token invalido e recusado', rejected);

  const incoming = waitFor(bobSocket, 'message:new');
  const ack = await new Promise((resolve) =>
    aliceSocket.emit('message:send', { channelId: textChannel.id, content: 'oi pessoal' }, resolve));
  check('message:send confirma no ack', Boolean(ack?.message?.id), JSON.stringify(ack));

  const received = await incoming;
  check('a outra ponta recebe message:new', received?.message?.content === 'oi pessoal');
  check('mensagem vem com o autor', received?.message?.author?.username === 'alice');

  const empty = await new Promise((resolve) =>
    aliceSocket.emit('message:send', { channelId: textChannel.id, content: '   ' }, resolve));
  check('mensagem vazia e recusada', Boolean(empty?.error));

  const foreign = await new Promise((resolve) =>
    stranger && connect(stranger.token).then((s) =>
      s.emit('message:send', { channelId: textChannel.id, content: 'invadindo' }, (r) => {
        s.close(); resolve(r);
      })));
  check('quem nao e membro nao escreve no canal', Boolean(foreign?.error), JSON.stringify(foreign));

  let limited = null;
  for (let i = 0; i < 14; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const r = await new Promise((resolve) =>
      bobSocket.emit('message:send', { channelId: textChannel.id, content: `flood ${i}` }, resolve));
    if (r?.error) { limited = r.error; break; }
  }
  check('rate limit corta o flood', Boolean(limited), limited ?? '');

  console.log('\n' + 'avatares');
  const crop = { x: 20, y: 20, width: 50, height: 50 };

  const semArquivo = await fetch(`${BASE}/api/users/me/avatar`, {
    method: 'POST', headers: { authorization: `Bearer ${alice.token}` }, body: new FormData(),
  });
  check('upload sem arquivo da 400', semArquivo.status === 400, `-> ${semArquivo.status}`);

  const lixo = await uploadAvatar(alice.token, 'lixo');
  check('arquivo que nao e imagem e recusado', lixo.status === 400, `-> ${lixo.status}`);

  const gifSemCrop = await uploadAvatar(alice.token, 'gif');
  check('GIF sem recorte e recusado', gifSemCrop.status === 400, `-> ${gifSemCrop.status}`);

  const avatarAtualizado = waitFor(bobSocket, 'user:updated');
  const png = await uploadAvatar(alice.token, 'png');
  check('PNG recortado sobe', png.status === 200, `-> ${png.status}`);
  check('PNG nao guarda recorte (ja veio cortado do canvas)', png.data?.user?.avatarCrop === null);
  check('avatar aponta pra /uploads', png.data?.user?.avatarUrl?.startsWith('/uploads/') === true);

  const aviso = await avatarAtualizado.catch(() => null);
  check('a outra ponta recebe user:updated', aviso?.user?.id === alice.user.id, JSON.stringify(aviso));

  const arquivo = await fetch(BASE + png.data.user.avatarUrl);
  check('o arquivo do avatar e servido', arquivo.status === 200, `-> ${arquivo.status}`);

  const gif = await uploadAvatar(alice.token, 'gif', crop);
  check('GIF com recorte sobe', gif.status === 200, `-> ${gif.status}`);
  check('GIF guarda o recorte pra aplicar na exibicao',
    gif.data?.user?.avatarCrop?.width === 50, JSON.stringify(gif.data?.user?.avatarCrop));
  check('GIF fica com extensao .gif (sem reencode)',
    gif.data?.user?.avatarUrl?.endsWith('.gif') === true);

  const antigo = await fetch(BASE + png.data.user.avatarUrl);
  check('o avatar anterior e apagado do disco', antigo.status === 404, `-> ${antigo.status}`);

  const comAvatar = await api('GET', `/api/guilds/${guild.id}`, { token: bob.token });
  const aliceNaLista = comAvatar.data?.guild?.members?.find((m) => m.id === alice.user.id);
  check('avatar e recorte aparecem na lista de membros',
    aliceNaLista?.avatarUrl?.endsWith('.gif') && aliceNaLista?.avatarCrop?.width === 50);

  const comFoto = await new Promise((resolve) =>
    aliceSocket.emit('message:send', { channelId: textChannel.id, content: 'agora com foto' }, resolve));
  check('mensagem nova ja sai com o avatar novo',
    comFoto?.message?.author?.avatarUrl?.endsWith('.gif') === true);

  const removido = await api('DELETE', '/api/users/me/avatar', { token: alice.token });
  check('remover avatar limpa url e recorte',
    removido.data?.user?.avatarUrl === null && removido.data?.user?.avatarCrop === null);

  console.log('\n' + 'perfil');

  const bioLonga = await api('PATCH', '/api/users/me', {
    token: alice.token, body: { bio: 'x'.repeat(301) },
  });
  check('descricao longa demais e recusada', bioLonga.status === 400, `-> ${bioLonga.status}`);

  const bioOk = await api('PATCH', '/api/users/me', {
    token: alice.token, body: { bio: 'jogo mal mas jogo' },
  });
  check('salvar descricao funciona', bioOk.data?.user?.bio === 'jogo mal mas jogo',
    JSON.stringify(bioOk.data?.user?.bio));

  const semNada = await api('PATCH', '/api/users/me', { token: alice.token, body: {} });
  check('patch vazio da 400', semNada.status === 400, `-> ${semNada.status}`);

  const bannerAnimado = await uploadImage(alice.token, 'banner', 'webpanim', crop);
  check('WEBP animado sobe como banner', bannerAnimado.status === 200,
    `-> ${bannerAnimado.status} ${JSON.stringify(bannerAnimado.data)}`);
  check('WEBP animado guarda o recorte',
    bannerAnimado.data?.user?.bannerCrop?.width === 50);

  const apngSemCrop = await uploadImage(alice.token, 'banner', 'apng');
  check('APNG e reconhecido como animado e exige recorte',
    apngSemCrop.status === 400, `-> ${apngSemCrop.status}`);

  const webpParado = await uploadImage(alice.token, 'banner', 'webp');
  check('WEBP parado nao precisa de recorte', webpParado.status === 200,
    `-> ${webpParado.status}`);
  check('WEBP parado nao guarda recorte', webpParado.data?.user?.bannerCrop === null);

  const perfil = await api('GET', `/api/users/${alice.user.id}`, { token: bob.token });
  check('perfil de quem divide servidor e visivel', perfil.status === 200,
    `-> ${perfil.status}`);
  check('perfil traz descricao e banner',
    perfil.data?.profile?.bio === 'jogo mal mas jogo'
    && perfil.data?.profile?.bannerUrl?.startsWith('/uploads/') === true);
  check('perfil lista os servidores em comum',
    perfil.data?.profile?.sharedGuilds?.some((g) => g.id === guild.id) === true);
  check('perfil de outra pessoa nao vem marcado como proprio',
    perfil.data?.profile?.isSelf === false);

  const perfilProprio = await api('GET', `/api/users/${alice.user.id}`, { token: alice.token });
  check('o proprio perfil vem marcado como proprio',
    perfilProprio.data?.profile?.isSelf === true);

  const perfilBloqueado = await api('GET', `/api/users/${alice.user.id}`, {
    token: stranger.token,
  });
  check('perfil bloqueado pra quem nao divide servidor',
    perfilBloqueado.status === 403, `-> ${perfilBloqueado.status}`);

  const bannerRemovido = await api('DELETE', '/api/users/me/banner', { token: alice.token });
  check('remover banner limpa url e recorte',
    bannerRemovido.data?.user?.bannerUrl === null
    && bannerRemovido.data?.user?.bannerCrop === null);

  console.log('\n' + 'canais de voz');

  const canalVoz = detail.data.guild.channels.find((c) => c.type === 'voice');
  const entrarNaVoz = (socket, channelId) =>
    new Promise((resolve) => socket.emit('voice:join', { channelId }, resolve));

  const vozEmTexto = await entrarNaVoz(aliceSocket, textChannel.id);
  check('nao da pra entrar em call num canal de texto', Boolean(vozEmTexto?.error),
    JSON.stringify(vozEmTexto));

  const strangerSocket = await connect(stranger.token);
  const vozDeEstranho = await entrarNaVoz(strangerSocket, canalVoz.id);
  check('quem nao e membro nao entra na call', Boolean(vozDeEstranho?.error),
    JSON.stringify(vozDeEstranho));

  const aliceNaVoz = await entrarNaVoz(aliceSocket, canalVoz.id);
  check('membro entra na call', aliceNaVoz?.channelId === canalVoz.id,
    JSON.stringify(aliceNaVoz));
  check('quem entra primeiro nao ve ninguem', aliceNaVoz?.participants?.length === 0);

  const listaChegou = waitFor(aliceSocket, 'voice:participants');
  const bobNaVoz = await entrarNaVoz(bobSocket, canalVoz.id);
  check('quem chega depois ve quem ja estava',
    bobNaVoz?.participants?.some((p) => p.socketId === aliceSocket.id) === true,
    JSON.stringify(bobNaVoz?.participants?.length));

  const lista = await listaChegou.catch(() => null);
  check('o servidor avisa a lista de quem esta na call',
    lista?.participants?.length === 2, JSON.stringify(lista?.participants?.length));

  // O repasse de SDP/ICE so pode acontecer entre dois sockets do mesmo canal.
  const sinalChegou = waitFor(bobSocket, 'voice:signal', 3000);
  aliceSocket.emit('voice:signal', {
    to: bobSocket.id, channelId: canalVoz.id, payload: { teste: 'oi' },
  });
  const sinal = await sinalChegou.catch(() => null);
  check('o signaling repassa entre quem esta na mesma call',
    sinal?.payload?.teste === 'oi' && sinal?.from === aliceSocket.id, JSON.stringify(sinal));

  const sinalIndevido = waitFor(bobSocket, 'voice:signal', 1500);
  strangerSocket.emit('voice:signal', {
    to: bobSocket.id, channelId: canalVoz.id, payload: { teste: 'invadindo' },
  });
  const vazou = await sinalIndevido.then(() => true).catch(() => false);
  check('quem nao esta na call nao consegue sinalizar pra dentro', !vazou);

  const saiuDaVoz = waitFor(aliceSocket, 'voice:left', 4000);
  bobSocket.emit('voice:leave', { channelId: canalVoz.id });
  const saida = await saiuDaVoz.catch(() => null);
  check('sair da call avisa quem ficou', saida?.socketId === bobSocket.id,
    JSON.stringify(saida));

  console.log('\n' + 'votacao de expulsao da call');

  // Dois membros comuns extras: dave vira alvo da votacao, carol ajuda a votar.
  const carol = (await register('carol')).data;
  const dave = (await register('dave')).data;
  await api('POST', `/api/invites/${code}/join`, { token: carol.token });
  await api('POST', `/api/invites/${code}/join`, { token: dave.token });
  const carolSocket = await connect(carol.token);
  const daveSocket = await connect(dave.token);

  // So a alice ficou na call (bob acabou de sair) - todo mundo entra:
  // alice, bob (admin), carol e dave (membros comuns).
  await entrarNaVoz(bobSocket, canalVoz.id);
  await entrarNaVoz(carolSocket, canalVoz.id);
  await entrarNaVoz(daveSocket, canalVoz.id);

  // 4 na call, alvo = dave, sobram 3 votantes -> precisa de maioria (2 votos).
  const primeiroPlacar = waitFor(daveSocket, 'voice:votacao');
  carolSocket.emit('voice:votar-expulsao', { channelId: canalVoz.id, socketId: daveSocket.id });
  const placar1 = await primeiroPlacar.catch(() => null);
  check('primeiro voto conta mas nao expulsa sozinho',
    placar1?.votos === 1 && placar1?.necessario === 2, JSON.stringify(placar1));

  const kickPrecoce = await waitFor(daveSocket, 'voice:kicked', 1000).then(() => true).catch(() => false);
  check('um voto so nao basta quando precisa de maioria', !kickPrecoce);

  const kickPorVotacao = waitFor(daveSocket, 'voice:kicked');
  aliceSocket.emit('voice:votar-expulsao', { channelId: canalVoz.id, socketId: daveSocket.id });
  const votoFinal = await kickPorVotacao.catch(() => null);
  check('segundo voto fecha a maioria e expulsa', votoFinal?.motivo === 'expulso', JSON.stringify(votoFinal));

  console.log('\n' + 'expulsar direto (dono/admin)');

  const kickIndevido = waitFor(bobSocket, 'voice:kicked', 1000);
  carolSocket.emit('voice:expulsar', { channelId: canalVoz.id, socketId: bobSocket.id });
  const expulsaoIndevida = await kickIndevido.then(() => true).catch(() => false);
  check('membro comum nao consegue expulsar direto', !expulsaoIndevida);

  const kickDeCarol = waitFor(carolSocket, 'voice:kicked');
  bobSocket.emit('voice:expulsar', { channelId: canalVoz.id, socketId: carolSocket.id });
  const expulsa = await kickDeCarol.catch(() => null);
  check('admin expulsa direto sem precisar de votacao', expulsa?.motivo === 'expulso', JSON.stringify(expulsa));

  console.log('\n' + 'mesma conta em duas sessoes');

  const bobSocket2 = await connect(bob.token);
  const sessaoAntigaCai = waitFor(bobSocket, 'voice:kicked');
  await entrarNaVoz(bobSocket2, canalVoz.id);
  const quedaDaAntiga = await sessaoAntigaCai.catch(() => null);
  check('entrar de outra sessao derruba a sessao antiga da mesma conta',
    quedaDaAntiga?.motivo === 'outra-sessao', JSON.stringify(quedaDaAntiga));

  console.log('\n' + 'moderacao de voz');

  // A carol foi expulsa da call no teste de expulsao logo acima - pra moderar
  // alguem, essa pessoa precisa estar na sala. Alice (dona) nunca saiu.
  const carolVoltou = await entrarNaVoz(carolSocket, canalVoz.id);
  check('carol volta pra call pros testes de moderacao',
    carolVoltou?.channelId === canalVoz.id, JSON.stringify(carolVoltou));

  const carolFoiSilenciada = waitFor(carolSocket, 'voice:moderado');
  aliceSocket.emit('voice:moderar', { channelId: canalVoz.id, socketId: carolSocket.id, serverMuted: true });
  const moderacao = await carolFoiSilenciada.catch(() => null);
  check('dona silencia alguem no servidor', moderacao?.serverMuted === true, JSON.stringify(moderacao));

  // O cliente nao pode escapar mandando um voice:state dizendo que esta livre.
  const listaDepois = waitFor(aliceSocket, 'voice:participants');
  carolSocket.emit('voice:state', { channelId: canalVoz.id, muted: false, hasMic: true });
  const participantes = await listaDepois.catch(() => null);
  const carolNaLista = participantes?.participants?.find((p) => p.socketId === carolSocket.id);
  check('silencio do servidor nao sai com um voice:state do proprio cliente',
    carolNaLista?.state?.serverMuted === true, JSON.stringify(carolNaLista?.state));

  const moderacaoIndevida = waitFor(aliceSocket, 'voice:moderado', 1000);
  carolSocket.emit('voice:moderar', { channelId: canalVoz.id, socketId: aliceSocket.id, serverMuted: true });
  const membroModerouDona = await moderacaoIndevida.then(() => true).catch(() => false);
  check('membro comum nao silencia a dona', !membroModerouDona);

  const desfez = waitFor(carolSocket, 'voice:moderado');
  aliceSocket.emit('voice:moderar', { channelId: canalVoz.id, socketId: carolSocket.id, serverMuted: false });
  check('dona tira o silencio', (await desfez.catch(() => null))?.serverMuted === false);

  // Mover: precisa de um segundo canal de voz.
  const outroCanal = await api('POST', `/api/guilds/${guild.id}/channels`, {
    token: alice.token, body: { name: 'Sala 2', type: 'voice' },
  });
  const canal2 = outroCanal.data?.channel;
  check('dona cria um segundo canal de voz', Boolean(canal2?.id), `-> ${outroCanal.status}`);

  const ordemDeMover = waitFor(carolSocket, 'voice:mover-para');
  aliceSocket.emit('voice:mover', { channelId: canalVoz.id, socketId: carolSocket.id, paraCanal: canal2.id });
  const mover = await ordemDeMover.catch(() => null);
  check('dona manda alguem pra outro canal de voz', mover?.channelId === canal2.id, JSON.stringify(mover));

  const moverIndevido = waitFor(aliceSocket, 'voice:mover-para', 1000);
  carolSocket.emit('voice:mover', { channelId: canalVoz.id, socketId: aliceSocket.id, paraCanal: canal2.id });
  const membroMoveuDona = await moverIndevido.then(() => true).catch(() => false);
  check('membro comum nao move a dona', !membroMoveuDona);

  console.log('\n' + 'puxar alguem pra call');

  const convitePraDave = waitFor(daveSocket, 'voice:convite');
  aliceSocket.emit('voice:convidar', { userId: dave.user.id });
  const convite = await convitePraDave.catch(() => null);
  check('convite pra call chega pra quem foi chamado',
    convite?.channelId === canalVoz.id && convite?.de?.username === 'alice', JSON.stringify(convite));

  const convitePraEstranho = waitFor(strangerSocket, 'voice:convite', 1000);
  aliceSocket.emit('voice:convidar', { userId: stranger.user.id });
  const vazouConvite = await convitePraEstranho.then(() => true).catch(() => false);
  check('nao da pra convidar quem nao e membro do servidor', !vazouConvite);

  bobSocket2.emit('voice:leave', { channelId: canalVoz.id });
  bobSocket2.close();
  // carolSocket e daveSocket seguem abertos: as secoes de reacao, cargo e
  // castigo mais abaixo usam os dois pra testar permissao de membro comum.

  strangerSocket.close();
  aliceSocket.emit('voice:leave', { channelId: canalVoz.id });

  console.log('\n' + 'historico');
  const history = await api('GET', `/api/channels/${textChannel.id}/messages?limit=100`, {
    token: bob.token,
  });
  check('historico persistiu as mensagens', history.data?.messages?.length >= 2,
    `-> ${history.data?.messages?.length}`);
  check('historico vem em ordem cronologica',
    history.data.messages[0].content === 'oi pessoal');

  const blocked = await api('GET', `/api/channels/${textChannel.id}/messages`, {
    token: stranger.token,
  });
  check('historico bloqueado pra quem nao e membro', blocked.status === 403, `-> ${blocked.status}`);

  console.log('\nmensagens diretas');
  const dmSemServidor = await api('POST', '/api/dms', {
    token: stranger.token, body: { userId: alice.user.id },
  });
  check('nao da pra abrir dm com quem nao divide servidor', dmSemServidor.status === 403,
    `-> ${dmSemServidor.status}`);

  const contatos = await api('GET', '/api/dms/contatos', { token: alice.token });
  check('contatos trazem quem divide servidor', contatos.data?.contatos?.some((c) => c.id === bob.user.id));
  check('contatos nao trazem quem nao divide servidor',
    !contatos.data?.contatos?.some((c) => c.id === stranger.user.id));
  check('contatos nao incluem a propria pessoa',
    !contatos.data?.contatos?.some((c) => c.id === alice.user.id));

  const dmAliceBob = await api('POST', '/api/dms', { token: alice.token, body: { userId: bob.user.id } });
  check('abrir dm devolve conversa', dmAliceBob.status === 200 && dmAliceBob.data?.conversation?.id);
  check('dm aponta pro outro usuario', dmAliceBob.data?.conversation?.otherUser?.id === bob.user.id);

  const dmBobAlice = await api('POST', '/api/dms', { token: bob.token, body: { userId: alice.user.id } });
  check('abrir dm do outro lado devolve a MESMA conversa',
    dmBobAlice.data?.conversation?.id === dmAliceBob.data?.conversation?.id);

  const dmChannelId = dmAliceBob.data.conversation.id;

  const dmChegou = waitFor(bobSocket, 'dm:new', 4000);
  const dmAck = await new Promise((resolve) =>
    aliceSocket.emit('dm:send', { dmChannelId, content: 'oi no privado' }, resolve));
  check('enviar dm devolve a mensagem no ack', dmAck?.message?.content === 'oi no privado',
    JSON.stringify(dmAck));

  const dmRecebida = await dmChegou.catch(() => null);
  check('quem recebe a dm ve ela chegar em tempo real',
    dmRecebida?.message?.content === 'oi no privado', JSON.stringify(dmRecebida));

  const dmHistorico = await api('GET', `/api/dms/${dmChannelId}/messages`, { token: bob.token });
  check('historico da dm tem a mensagem', dmHistorico.data?.messages?.[0]?.content === 'oi no privado');

  const dmHistoricoBloqueado = await api('GET', `/api/dms/${dmChannelId}/messages`, {
    token: stranger.token,
  });
  check('historico da dm bloqueado pra quem nao participa', dmHistoricoBloqueado.status === 404,
    `-> ${dmHistoricoBloqueado.status}`);

  const listaDeConversas = await api('GET', '/api/dms', { token: alice.token });
  const conversaNaLista = listaDeConversas.data?.conversations?.find((c) => c.id === dmChannelId);
  check('conversa aparece na lista com a ultima mensagem',
    conversaNaLista?.lastMessage?.content === 'oi no privado', JSON.stringify(conversaNaLista));

  console.log('\nanexos e gifs');
  const anexo = await uploadAttachment(alice.token, 'conteudo qualquer de teste', 'nota.txt');
  check('upload de anexo devolve 200', anexo.status === 200, `-> ${anexo.status}`);
  check('anexo aponta pra /uploads', anexo.data?.attachment?.url?.startsWith('/uploads/'));
  check('anexo generico vem categorizado como file', anexo.data?.attachment?.type === 'file');
  check('anexo guarda o nome original', anexo.data?.attachment?.name === 'nota.txt');

  const semTextoNemAnexo = await new Promise((resolve) =>
    aliceSocket.emit('message:send', { channelId: textChannel.id, content: '' }, resolve));
  check('mensagem sem texto e sem anexo e recusada', semTextoNemAnexo?.error === 'mensagem vazia');

  const chegouComAnexo = waitFor(bobSocket, 'message:new', 4000);
  const comAnexoAck = await new Promise((resolve) =>
    aliceSocket.emit('message:send', {
      channelId: textChannel.id, content: '', attachment: anexo.data.attachment,
    }, resolve));
  check('mensagem so com anexo (sem texto) e aceita', comAnexoAck?.message?.attachment?.url === anexo.data.attachment.url,
    JSON.stringify(comAnexoAck));

  const recebidaComAnexo = await chegouComAnexo.catch(() => null);
  check('anexo chega em tempo real pro resto da guild',
    recebidaComAnexo?.message?.attachment?.name === 'nota.txt', JSON.stringify(recebidaComAnexo));

  const anexoFalso = await new Promise((resolve) =>
    aliceSocket.emit('message:send', {
      channelId: textChannel.id, content: 'tentando enganar', attachment: { url: 'https://evil.example/x', type: 'file' },
    }, resolve));
  check('anexo apontando pra fora de /uploads e ignorado (manda so o texto)',
    anexoFalso?.message?.attachment === null, JSON.stringify(anexoFalso));

  const trending = await api('GET', '/api/gifs/trending', { token: alice.token });
  if (trending.status === 503) {
    console.log('  (pulado: sem GIPHY_API_KEY no ambiente do servidor)');
  } else {
    check('gifs em alta respondem com lista', Array.isArray(trending.data?.gifs) && trending.data.gifs.length > 0,
      `-> status ${trending.status}`);

    const busca = await api('GET', '/api/gifs/buscar?q=ola', { token: alice.token });
    check('busca de gif responde com lista', Array.isArray(busca.data?.gifs), `-> status ${busca.status}`);
  }

  console.log('\n@usuario');
  const handleInvalido = await api('PATCH', '/api/users/me', { token: alice.token, body: { handle: 'A B!' } });
  check('@usuario com caracteres invalidos e recusado', handleInvalido.status === 400, `-> ${handleInvalido.status}`);

  const handleAlice = await api('PATCH', '/api/users/me', { token: alice.token, body: { handle: `alice_teste_${stamp}` } });
  check('definir @usuario funciona', handleAlice.data?.user?.handle === `alice_teste_${stamp}`, JSON.stringify(handleAlice.data));

  const handleDuplicado = await api('PATCH', '/api/users/me', {
    token: bob.token, body: { handle: `ALICE_TESTE_${stamp}` },
  });
  check('@usuario ja em uso (mesmo com maiuscula) e recusado', handleDuplicado.status === 409,
    `-> ${handleDuplicado.status}`);

  const perfilComHandle = await api('GET', `/api/users/${alice.user.id}`, { token: bob.token });
  check('@usuario aparece no perfil pra quem divide servidor',
    perfilComHandle.data?.profile?.handle === `alice_teste_${stamp}`);

  console.log('\nadmin (saude do servidor)');
  const statsDono = await api('GET', '/api/admin/stats', { token: alice.token });
  check('dono do servidor ve as estatisticas', statsDono.status === 200
    && typeof statsDono.data?.cpuPercent === 'number' && typeof statsDono.data?.memTotal === 'number',
    JSON.stringify(statsDono.data));

  const statsMembro = await api('GET', '/api/admin/stats', { token: bob.token });
  check('quem nao administra nenhum servidor nao ve', statsMembro.status === 403, `-> ${statsMembro.status}`);

  const reloadBloqueado = await api('POST', '/api/admin/reload', { token: bob.token });
  check('reload geral bloqueado pra quem nao administra', reloadBloqueado.status === 403,
    `-> ${reloadBloqueado.status}`);

  const reloadChegou = waitFor(bobSocket, 'app:reload', 4000);
  const reloadPedido = await api('POST', '/api/admin/reload', { token: alice.token });
  check('dono consegue pedir reload geral', reloadPedido.status === 200, `-> ${reloadPedido.status}`);
  await reloadChegou.then(() => check('todo mundo recebe o aviso de reload', true))
    .catch(() => check('todo mundo recebe o aviso de reload', false));

  console.log('\nreacoes');
  const alvoReacao = await new Promise((resolve) =>
    aliceSocket.emit('message:send', { channelId: textChannel.id, content: 'reaja aqui' }, resolve));
  const idReagido = alvoReacao.message.id;

  const reacaoChegou = waitFor(bobSocket, 'message:reactions', 4000);
  aliceSocket.emit('message:react', { messageId: idReagido, emoji: '🔥' });
  const reacao = await reacaoChegou.catch(() => null);
  check('reagir avisa a guild inteira em tempo real',
    reacao?.messageId === idReagido && reacao?.reactions?.[0]?.emoji === '🔥',
    JSON.stringify(reacao?.reactions));
  check('reacao conta 1 e guarda quem reagiu',
    reacao?.reactions?.[0]?.count === 1 && reacao?.reactions?.[0]?.userIds?.[0] === alice.user.id);

  const somouSegundo = waitFor(bobSocket, 'message:reactions', 4000);
  bobSocket.emit('message:react', { messageId: idReagido, emoji: '🔥' });
  const duas = await somouSegundo.catch(() => null);
  check('duas pessoas no mesmo emoji viram contador 2', duas?.reactions?.[0]?.count === 2,
    JSON.stringify(duas?.reactions));

  const tirou = waitFor(bobSocket, 'message:reactions', 4000);
  bobSocket.emit('message:react', { messageId: idReagido, emoji: '🔥' });
  const removida = await tirou.catch(() => null);
  check('reagir de novo no mesmo emoji desfaz a reacao', removida?.reactions?.[0]?.count === 1,
    JSON.stringify(removida?.reactions));

  const emojiInvalido = waitFor(bobSocket, 'message:reactions', 1000);
  aliceSocket.emit('message:react', { messageId: idReagido, emoji: '<script>' });
  const passouLixo = await emojiInvalido.then(() => true).catch(() => false);
  check('emoji com caracteres proibidos e ignorado', !passouLixo);

  console.log('\nresponder, editar, apagar e fixar');
  const respostaEnviada = await new Promise((resolve) =>
    bobSocket.emit('message:send', {
      channelId: textChannel.id, content: 'respondendo voce', replyToId: idReagido,
    }, resolve));
  check('mensagem guarda a previa de quem ela responde',
    respostaEnviada?.message?.replyTo?.id === idReagido
    && respostaEnviada?.message?.replyTo?.username === 'alice',
    JSON.stringify(respostaEnviada?.message?.replyTo));

  const replyDeOutroCanal = await new Promise((resolve) =>
    bobSocket.emit('message:send', {
      channelId: textChannel.id, content: 'reply invalido', replyToId: 'nao-existe-mesmo',
    }, resolve));
  check('responder mensagem de fora do canal e ignorado (manda sem previa)',
    replyDeOutroCanal?.message?.replyTo === null);

  const edicaoChegou = waitFor(aliceSocket, 'message:updated', 4000);
  const editada = await new Promise((resolve) =>
    bobSocket.emit('message:edit', { messageId: respostaEnviada.message.id, content: 'texto editado' }, resolve));
  check('autor edita a propria mensagem', editada?.message?.content === 'texto editado',
    JSON.stringify(editada));
  check('mensagem editada ganha marca de edicao', Number(editada?.message?.editedAt) > 0);
  const avisoEdicao = await edicaoChegou.catch(() => null);
  check('edicao chega em tempo real pros outros',
    avisoEdicao?.message?.content === 'texto editado', JSON.stringify(avisoEdicao?.message?.content));

  const edicaoAlheia = await new Promise((resolve) =>
    aliceSocket.emit('message:edit', { messageId: respostaEnviada.message.id, content: 'invadindo' }, resolve));
  check('ninguem edita a mensagem dos outros (nem o dono)', Boolean(edicaoAlheia?.error),
    JSON.stringify(edicaoAlheia));

  const fixarSemPermissao = await new Promise((resolve) =>
    carolSocket.emit('message:pin', { messageId: idReagido, pinned: true }, resolve));
  check('membro comum nao fixa mensagem', Boolean(fixarSemPermissao?.error),
    JSON.stringify(fixarSemPermissao));

  const fixou = await new Promise((resolve) =>
    aliceSocket.emit('message:pin', { messageId: idReagido, pinned: true }, resolve));
  check('dono fixa mensagem', fixou?.ok === true, JSON.stringify(fixou));

  const pins = await api('GET', `/api/channels/${textChannel.id}/pins`, { token: bob.token });
  check('mensagem fixada aparece na lista de fixadas',
    pins.data?.messages?.some((m) => m.id === idReagido), JSON.stringify(pins.data?.messages?.length));

  const buscou = await api('GET', `/api/channels/${textChannel.id}/search?q=texto%20editado`, { token: alice.token });
  check('busca no canal encontra a mensagem',
    buscou.data?.messages?.some((m) => m.content === 'texto editado'),
    JSON.stringify(buscou.data?.messages?.length));

  const apagarAlheia = await new Promise((resolve) =>
    carolSocket.emit('message:delete', { messageId: idReagido }, resolve));
  check('membro comum nao apaga mensagem dos outros', Boolean(apagarAlheia?.error));

  const apagouComoModerador = await new Promise((resolve) =>
    aliceSocket.emit('message:delete', { messageId: respostaEnviada.message.id }, resolve));
  check('quem gerencia mensagens apaga a de qualquer um', apagouComoModerador?.ok === true,
    JSON.stringify(apagouComoModerador));

  console.log('\ncargos');
  const cargoCriado = await api('POST', `/api/guilds/${guild.id}/roles`, {
    token: alice.token, body: { name: 'Veterano', color: '#ff8800', permissions: 0 },
  });
  check('dono cria cargo com cor', cargoCriado.status === 201
    && cargoCriado.data?.role?.color === '#ff8800', JSON.stringify(cargoCriado.data));
  const cargoId = cargoCriado.data?.role?.id;

  const corInvalida = await api('POST', `/api/guilds/${guild.id}/roles`, {
    token: alice.token, body: { name: 'Sem cor', color: 'vermelho' },
  });
  check('cor fora de #rrggbb vira sem cor', corInvalida.data?.role?.color === null,
    JSON.stringify(corInvalida.data?.role?.color));

  const cargoPorMembro = await api('POST', `/api/guilds/${guild.id}/roles`, {
    token: carol.token, body: { name: 'Golpe' },
  });
  check('membro comum nao cria cargo', cargoPorMembro.status === 403, `-> ${cargoPorMembro.status}`);

  const deuCargo = await api('PUT', `/api/guilds/${guild.id}/members/${carol.user.id}/roles/${cargoId}`, {
    token: alice.token,
  });
  check('dono da cargo pra alguem', deuCargo.status === 200, `-> ${deuCargo.status}`);

  const comCargo = await api('GET', `/api/guilds/${guild.id}`, { token: alice.token });
  check('cargo aparece no membro na lista do servidor',
    comCargo.data?.guild?.members?.find((m) => m.id === carol.user.id)?.roles?.includes(cargoId));
  check('servidor lista os cargos, com @everyone junto',
    comCargo.data?.guild?.roles?.some((r) => r.isDefault)
    && comCargo.data?.guild?.roles?.some((r) => r.id === cargoId));

  // Manda o padrao COM o bit de administrador junto: o servidor tem que tirar
  // so o bit proibido e deixar o resto intacto. Mandar so o bit de admin aqui
  // zeraria o @everyone e deixaria todo mundo mudo pros testes seguintes.
  const everyone = comCargo.data.guild.roles.find((r) => r.isDefault);
  const PADRAO = everyone.permissions;
  const viraAdmin = await api('PATCH', `/api/guilds/${guild.id}/roles/${everyone.id}`, {
    token: alice.token, body: { permissions: PADRAO | (1 << 18) },
  });
  check('@everyone nao consegue virar administrador', (viraAdmin.data?.role?.permissions & (1 << 18)) === 0,
    JSON.stringify(viraAdmin.data?.role?.permissions));
  check('tirar o bit de admin nao mexe no resto das permissoes do @everyone',
    viraAdmin.data?.role?.permissions === PADRAO,
    `${viraAdmin.data?.role?.permissions} != ${PADRAO}`);

  console.log('\napelido, castigo e banimento');
  const meuApelido = await api('PATCH', `/api/guilds/${guild.id}/members/${carol.user.id}/nickname`, {
    token: carol.token, body: { nickname: 'Carolzinha' },
  });
  check('qualquer um muda o proprio apelido', meuApelido.data?.nickname === 'Carolzinha',
    JSON.stringify(meuApelido.data));

  const apelidoAlheio = await api('PATCH', `/api/guilds/${guild.id}/members/${dave.user.id}/nickname`, {
    token: carol.token, body: { nickname: 'Zoando' },
  });
  check('membro comum nao muda apelido dos outros', apelidoAlheio.status === 403,
    `-> ${apelidoAlheio.status}`);

  const castigo = await api('POST', `/api/guilds/${guild.id}/members/${dave.user.id}/timeout`, {
    token: alice.token, body: { minutos: 10 },
  });
  check('dono coloca alguem de castigo', castigo.status === 200, `-> ${castigo.status}`);

  const daveTentaFalar = await new Promise((resolve) =>
    daveSocket.emit('message:send', { channelId: textChannel.id, content: 'to de castigo' }, resolve));
  check('quem esta de castigo nao consegue mandar mensagem', Boolean(daveTentaFalar?.error),
    JSON.stringify(daveTentaFalar));

  await api('POST', `/api/guilds/${guild.id}/members/${dave.user.id}/timeout`, {
    token: alice.token, body: { minutos: 0 },
  });
  const daveVoltou = await new Promise((resolve) =>
    daveSocket.emit('message:send', { channelId: textChannel.id, content: 'voltei' }, resolve));
  check('tirar o castigo devolve a fala', Boolean(daveVoltou?.message), JSON.stringify(daveVoltou?.error));

  const castigoNoDono = await api('POST', `/api/guilds/${guild.id}/members/${alice.user.id}/timeout`, {
    token: bob.token, body: { minutos: 10 },
  });
  check('admin nao castiga o dono', castigoNoDono.status === 403, `-> ${castigoNoDono.status}`);

  const baniu = await api('POST', `/api/guilds/${guild.id}/bans/${dave.user.id}`, {
    token: alice.token, body: { reason: 'teste' },
  });
  check('dono bane alguem', baniu.status === 200, `-> ${baniu.status}`);
  const listaBans = await api('GET', `/api/guilds/${guild.id}/bans`, { token: alice.token });
  check('banido aparece na lista de banidos',
    listaBans.data?.bans?.some((b) => b.userId === dave.user.id), JSON.stringify(listaBans.data));
  const daveSumiu = await api('GET', `/api/guilds/${guild.id}`, { token: alice.token });
  check('banido sai da lista de membros',
    !daveSumiu.data?.guild?.members?.some((m) => m.id === dave.user.id));

  console.log('\nnao lidas');
  const canalNaoLido = bobChannel2.data.channel;
  await new Promise((resolve) =>
    aliceSocket.emit('message:send', { channelId: canalNaoLido.id, content: 'primeira' }, resolve));
  await new Promise((resolve) =>
    aliceSocket.emit('message:send', { channelId: canalNaoLido.id, content: 'segunda' }, resolve));

  const antes = await api('GET', `/api/guilds/${guild.id}/unread`, { token: bob.token });
  check('conta as mensagens que a pessoa ainda nao leu',
    antes.data?.unread?.[canalNaoLido.id] === 2, JSON.stringify(antes.data?.unread));

  const proprias = await api('GET', `/api/guilds/${guild.id}/unread`, { token: alice.token });
  check('mensagem propria nao conta como nao lida',
    !proprias.data?.unread?.[canalNaoLido.id], JSON.stringify(proprias.data?.unread));

  bobSocket.emit('channel:read', { channelId: canalNaoLido.id });
  await new Promise((r) => setTimeout(r, 300));
  const depois = await api('GET', `/api/guilds/${guild.id}/unread`, { token: bob.token });
  check('marcar como lido zera o contador',
    !depois.data?.unread?.[canalNaoLido.id], JSON.stringify(depois.data?.unread));

  const naoMembro = await api('GET', `/api/guilds/${guild.id}/unread`, { token: stranger.token });
  check('nao-membro nao ve as nao lidas', naoMembro.status === 403, `-> ${naoMembro.status}`);

  console.log('\nnotas privadas e notificacoes');
  const salvouNota = await api('PUT', `/api/prefs/notes/${bob.user.id}`, {
    token: alice.token, body: { note: 'amigo do trabalho' },
  });
  check('salvar nota privada funciona', salvouNota.data?.note === 'amigo do trabalho',
    JSON.stringify(salvouNota.data));

  const minhaNota = await api('GET', `/api/prefs/notes/${bob.user.id}`, { token: alice.token });
  check('a nota volta pra quem escreveu', minhaNota.data?.note === 'amigo do trabalho');

  const notaDoOutro = await api('GET', `/api/prefs/notes/${bob.user.id}`, { token: carol.token });
  check('a nota de alguem nao vaza pra outra pessoa', notaDoOutro.data?.note === '',
    JSON.stringify(notaDoOutro.data));

  const notaEmEstranho = await api('PUT', `/api/prefs/notes/${stranger.user.id}`, {
    token: alice.token, body: { note: 'nao deveria' },
  });
  check('nao da pra anotar sobre quem nao divide servidor', notaEmEstranho.status === 403,
    `-> ${notaEmEstranho.status}`);

  const silenciou = await api('PUT', '/api/prefs/notifications', {
    token: alice.token, body: { scopeType: 'guild', scopeId: guild.id, level: 'mentions' },
  });
  check('definir nivel de notificacao funciona', silenciou.data?.level === 'mentions',
    JSON.stringify(silenciou.data));

  const listaPrefs = await api('GET', '/api/prefs/notifications', { token: alice.token });
  check('config de notificacao volta na listagem',
    listaPrefs.data?.settings?.some((s) => s.scopeId === guild.id && s.level === 'mentions'));

  const voltouAoPadrao = await api('PUT', '/api/prefs/notifications', {
    token: alice.token, body: { scopeType: 'guild', scopeId: guild.id, level: 'all', mutedUntil: null },
  });
  check('voltar pro padrao limpa a configuracao', voltouAoPadrao.data?.level === 'all');
  const prefsLimpas = await api('GET', '/api/prefs/notifications', { token: alice.token });
  check('configuracao padrao nao fica guardada a toa',
    !prefsLimpas.data?.settings?.some((s) => s.scopeId === guild.id));

  console.log('\npresenca: status e jogo');
  const statusChegou = waitFor(bobSocket, 'presence:update', 4000);
  aliceSocket.emit('presence:set', { status: 'dnd', activity: 'Jogando Stardew Valley' });
  const presenca = await statusChegou.catch(() => null);
  check('status e atividade chegam pros outros em tempo real',
    presenca?.status === 'dnd' && presenca?.activity === 'Jogando Stardew Valley',
    JSON.stringify(presenca));

  const ficouInvisivel = waitFor(bobSocket, 'presence:update', 4000);
  aliceSocket.emit('presence:set', { status: 'invisible' });
  const invisivel = await ficouInvisivel.catch(() => null);
  check('quem fica invisivel aparece como offline pros outros',
    invisivel?.online === false && invisivel?.status === 'offline', JSON.stringify(invisivel));
  check('atividade nao vaza de quem esta invisivel', invisivel?.activity === null);

  aliceSocket.emit('presence:set', { status: 'online' });

  aliceSocket.close();
  bobSocket.close();
  carolSocket.close();
  daveSocket.close();

  const total = passed + failures.length;
  console.log(`\n${passed}/${total} verificacoes passaram`);
  if (failures.length) {
    console.log(`falhas: ${failures.join(', ')}`);
    process.exit(1);
  }
  console.log('tudo certo\n');
  process.exit(0);
}

main().catch((err) => {
  console.error('\nsmoke test quebrou:', err);
  process.exit(1);
});
