/**
 * Teste de fumaca das configuracoes de servidor: banimentos, registro de
 * auditoria e exclusao do servidor.
 *
 *   node scripts/smoke-config-servidor.js
 */
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
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const texto = await res.text();
  let json = null;
  try { json = texto ? JSON.parse(texto) : null; } catch { /* resposta nao-JSON */ }
  return { status: res.status, body: json };
}

const criarConta = async (nome) => {
  const { body } = await api('POST', '/auth/register', {
    body: { email: `${nome}-${stamp}@teste.local`, username: `${nome}${stamp}`, password: 'SenhaTeste123!' },
  });
  return { token: body.token, id: body.user.id, username: body.user.username };
};

(async () => {
  const dono = await criarConta('dono');
  const reu = await criarConta('reu');
  const ze = await criarConta('ze');

  const { body: criado } = await api('POST', '/guilds', {
    token: dono.token, body: { name: `Servidor ${stamp}` },
  });
  const guildId = criado.guild.id;

  // Reu e Ze entram pelo convite.
  const { body: conv } = await api('POST', `/guilds/${guildId}/invites`, { token: dono.token, body: {} });
  await api('POST', `/invites/${conv.invite.code}/join`, { token: reu.token, body: {} });
  await api('POST', `/invites/${conv.invite.code}/join`, { token: ze.token, body: {} });

  console.log('\nbanimentos');
  const ban = await api('POST', `/guilds/${guildId}/bans/${reu.id}`, {
    token: dono.token, body: { reason: 'testando' },
  });
  check('dono consegue banir', ban.status === 200, JSON.stringify(ban.body));

  const lista = await api('GET', `/guilds/${guildId}/bans`, { token: dono.token });
  const banido = lista.body?.bans?.[0];
  check('banido aparece na lista', banido?.userId === reu.id);
  check('lista traz o motivo', banido?.reason === 'testando');
  check('lista traz quem baniu', banido?.bannedBy === dono.username, JSON.stringify(banido));
  check('lista traz a data', typeof banido?.createdAt === 'number');

  const semPermissao = await api('GET', `/guilds/${guildId}/bans`, { token: ze.token });
  check('membro comum nao ve banidos', semPermissao.status === 403);

  const reentrar = await api('POST', `/invites/${conv.invite.code}/join`, { token: reu.token, body: {} });
  check('banido nao consegue voltar pelo convite', reentrar.status >= 400, JSON.stringify(reentrar.body));

  const desban = await api('DELETE', `/guilds/${guildId}/bans/${reu.id}`, { token: dono.token });
  check('dono consegue desbanir', desban.status === 200);
  const depois = await api('GET', `/guilds/${guildId}/bans`, { token: dono.token });
  check('lista fica vazia depois do desban', depois.body?.bans?.length === 0);

  console.log('\nregistro de auditoria');
  const audit = await api('GET', `/guilds/${guildId}/audit`, { token: dono.token });
  check('dono ve o registro', audit.status === 200, JSON.stringify(audit.body));
  const acoes = (audit.body?.entradas ?? []).map((e) => e.acao);
  check('registrou o banimento', acoes.includes('membro.banido'), acoes.join(','));
  check('registrou o desbanimento', acoes.includes('membro.desbanido'));
  check('registrou a criacao do convite', acoes.includes('convite.criado'));

  const linhaBan = audit.body.entradas.find((e) => e.acao === 'membro.banido');
  check('registro guarda quem agiu', linhaBan?.ator?.nome === dono.username, JSON.stringify(linhaBan));
  check('registro guarda quem levou', linhaBan?.alvo?.nome === reu.username);
  check('registro guarda o motivo', linhaBan?.detalhe === 'testando');
  check('mais novo vem primeiro', audit.body.entradas[0].createdAt >= audit.body.entradas.at(-1).createdAt);

  const auditZe = await api('GET', `/guilds/${guildId}/audit`, { token: ze.token });
  check('membro comum nao ve o registro', auditZe.status === 403);

  console.log('\nexcluir servidor');
  const naoDono = await api('DELETE', `/guilds/${guildId}`, { token: ze.token });
  check('quem nao e dono nao apaga', naoDono.status === 403, JSON.stringify(naoDono.body));

  const apagou = await api('DELETE', `/guilds/${guildId}`, { token: dono.token });
  check('dono apaga o servidor', apagou.status === 200, JSON.stringify(apagou.body));

  const sumiu = await api('GET', `/guilds/${guildId}`, { token: dono.token });
  check('servidor some de verdade', sumiu.status >= 400);

  const listaDono = await api('GET', '/guilds', { token: dono.token });
  check('some da lista do dono', !listaDono.body?.guilds?.some((g) => g.id === guildId));
  const listaZe = await api('GET', '/guilds', { token: ze.token });
  check('some da lista dos membros', !listaZe.body?.guilds?.some((g) => g.id === guildId));

  const auditSumido = await api('GET', `/guilds/${guildId}/audit`, { token: dono.token });
  check('registro do servidor apagado fica inacessivel', auditSumido.status >= 400);

  console.log(`\n${passed}/${passed + failures.length} verificacoes passaram`);
  if (failures.length) {
    console.log('falhas:', failures.join(' | '));
    process.exit(1);
  }
  console.log('tudo certo');
})().catch((err) => {
  console.error('erro no teste:', err);
  process.exit(1);
});
