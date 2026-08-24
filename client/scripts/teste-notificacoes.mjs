/**
 * Teste da regra de "isto vira notificação?".
 *
 * É lógica pura (sem DOM), então roda direto no node:
 *   npm --prefix client run teste
 *
 * Vale o teste próprio porque a regra cruza três controles que ficam em telas
 * diferentes - status, nível do canal e nível do servidor - e é fácil quebrar
 * um deles mexendo no outro sem perceber.
 */
import { chaveDe, deveNotificar, PARA_SEMPRE } from '../src/lib/notificacoes.js';

let passou = 0;
const falhas = [];

function check(rotulo, condicao) {
  if (condicao) {
    passou += 1;
    console.log(`  ok   ${rotulo}`);
  } else {
    falhas.push(rotulo);
    console.log(`  FALHOU ${rotulo}`);
  }
}

const settingsCom = (...pares) =>
  Object.fromEntries(pares.map(([tipo, id, config]) => [chaveDe(tipo, id), config]));

const base = { guildId: 'g1', channelId: 'c1' };

console.log('\nnotificacoes: status');
check('mensagem normal notifica por padrao',
  deveNotificar({ settings: {}, status: 'online', ...base, ehMencao: false }) === true);
check('"nao perturbe" cala mensagem normal',
  deveNotificar({ settings: {}, status: 'dnd', ...base, ehMencao: false }) === false);
check('"nao perturbe" cala ate mencao direta',
  deveNotificar({ settings: {}, status: 'dnd', ...base, ehMencao: true }) === false);
check('"ausente" continua notificando normalmente',
  deveNotificar({ settings: {}, status: 'idle', ...base, ehMencao: false }) === true);

console.log('\nnotificacoes: nivel do servidor');
const soMencoesNoServidor = settingsCom(['guild', 'g1', { level: 'mentions', mutedUntil: null }]);
check('servidor em "so mencoes" ignora mensagem normal',
  deveNotificar({ settings: soMencoesNoServidor, status: 'online', ...base, ehMencao: false }) === false);
check('servidor em "so mencoes" deixa passar a mencao',
  deveNotificar({ settings: soMencoesNoServidor, status: 'online', ...base, ehMencao: true }) === true);

const nadaNoServidor = settingsCom(['guild', 'g1', { level: 'none', mutedUntil: null }]);
check('servidor em "nada" cala ate mencao',
  deveNotificar({ settings: nadaNoServidor, status: 'online', ...base, ehMencao: true }) === false);

console.log('\nnotificacoes: canal ganha do servidor');
const canalFalanteEmServidorMudo = settingsCom(
  ['guild', 'g1', { level: 'none', mutedUntil: null }],
  ['channel', 'c1', { level: 'all', mutedUntil: null }],
);
check('canal em "tudo" fura o servidor em "nada"',
  deveNotificar({ settings: canalFalanteEmServidorMudo, status: 'online', ...base, ehMencao: false }) === true);

const canalMudoEmServidorFalante = settingsCom(['channel', 'c1', { level: 'none', mutedUntil: null }]);
check('canal em "nada" cala mesmo com servidor no padrao',
  deveNotificar({ settings: canalMudoEmServidorFalante, status: 'online', ...base, ehMencao: true }) === false);

check('canal sem configuracao propria herda o servidor',
  deveNotificar({ settings: soMencoesNoServidor, status: 'online', ...base, ehMencao: false }) === false);

console.log('\nnotificacoes: silencio temporario');
const silenciadoAte = settingsCom(['guild', 'g1', { level: 'all', mutedUntil: Date.now() + 60_000 }]);
check('servidor silenciado nao notifica',
  deveNotificar({ settings: silenciadoAte, status: 'online', ...base, ehMencao: true }) === false);

const silencioVencido = settingsCom(['guild', 'g1', { level: 'all', mutedUntil: Date.now() - 60_000 }]);
check('silencio que ja venceu volta a notificar',
  deveNotificar({ settings: silencioVencido, status: 'online', ...base, ehMencao: false }) === true);

const paraSempre = settingsCom(['channel', 'c1', { level: 'all', mutedUntil: PARA_SEMPRE }]);
check('"ate eu reativar" cala de verdade',
  deveNotificar({ settings: paraSempre, status: 'online', ...base, ehMencao: true }) === false);

console.log('\nnotificacoes: conversa direta');
check('dm notifica por padrao',
  deveNotificar({ settings: {}, status: 'online', dmChannelId: 'd1', ehMencao: true }) === true);
const dmMuda = settingsCom(['dm', 'd1', { level: 'none', mutedUntil: null }]);
check('dm em "nada" nao notifica',
  deveNotificar({ settings: dmMuda, status: 'online', dmChannelId: 'd1', ehMencao: true }) === false);
const dmSilenciada = settingsCom(['dm', 'd1', { level: 'all', mutedUntil: Date.now() + 60_000 }]);
check('dm silenciada nao notifica',
  deveNotificar({ settings: dmSilenciada, status: 'online', dmChannelId: 'd1', ehMencao: true }) === false);
check('silencio de servidor nao vaza pra dm',
  deveNotificar({ settings: silenciadoAte, status: 'online', dmChannelId: 'd1', ehMencao: true }) === true);

const total = passou + falhas.length;
console.log(`\n${passou}/${total} verificacoes passaram`);
if (falhas.length) {
  console.log(`falhas: ${falhas.join(', ')}`);
  process.exit(1);
}
console.log('tudo certo\n');
