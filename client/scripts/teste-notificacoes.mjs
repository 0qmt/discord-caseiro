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
import {
  ajustarMencoesAposEdicao,
  codificarMencoes,
  codificarMencoesComEntidades,
  decodificarMencoesParaEdicao,
  encontrarConsultaMencao,
  mensagemMenciona,
} from '../src/lib/mencoes.js';
import {
  deveExibirNotificacaoNativaDeMencao,
  tocarSomDeMencao,
} from '../src/lib/notificacaoDeMencao.js';

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

console.log('\nmenções: identidade e edição');
const membros = [
  { id: 'u1', username: 'ana', nickname: 'Ana Silva' },
  { id: 'u2', username: 'bia', nickname: 'Bia' },
];
const consulta = encontrarConsultaMencao('oi @Bi', 6);
check('digitar @ abre uma consulta com intervalo correto',
  consulta?.termo === 'Bi' && consulta.inicio === 3 && consulta.fim === 6);

const entidadeBia = { userId: 'u2', rotulo: '@Bia', inicio: 3, fim: 7 };
check('menção escolhida é serializada pelo ID real',
  codificarMencoesComEntidades('oi @Bia', [entidadeBia], membros) === 'oi <@u2>');

const nomesIguais = [
  { id: 'u3', username: 'alex' },
  { id: 'u4', username: 'alex' },
];
check('nome ambíguo digitado à mão não escolhe um ID arbitrário',
  codificarMencoes('oi @alex', nomesIguais) === 'oi @alex');

check('alteração de nickname não muda o ID já selecionado',
  codificarMencoesComEntidades('oi @Bia', [entidadeBia], [{ ...membros[1], nickname: 'Beatriz' }]) === 'oi <@u2>');

const deslocadas = ajustarMencoesAposEdicao('oi @Bia', 'bom dia, oi @Bia', [entidadeBia]);
check('editar antes da menção desloca a entidade sem perder o ID',
  deslocadas[0]?.inicio === 12 && deslocadas[0]?.fim === 16);
check('editar dentro da menção a transforma em texto normal',
  ajustarMencoesAposEdicao('oi @Bia', 'oi @Bixa', [entidadeBia]).length === 0);

const reaberta = decodificarMencoesParaEdicao('olá <@u2>', membros);
check('editar mensagem existente recupera texto legível e ID',
  reaberta.texto === 'olá @Bia' && reaberta.entidades[0]?.userId === 'u2');
check('detecção da menção usa ID, não nome', mensagemMenciona('olá <@u2>', 'u2') === true);

console.log('\nmenções: notificação nativa');
check('canal aberto e app em foco não duplica notificação do Windows',
  deveExibirNotificacaoNativaDeMencao({
    channelId: 'c1', activeChannelId: 'c1', dmMode: false, appFocado: true,
  }) === false);
check('menção em outro canal notifica mesmo com app em foco',
  deveExibirNotificacaoNativaDeMencao({
    channelId: 'c2', activeChannelId: 'c1', dmMode: false, appFocado: true,
  }) === true);
check('menção no canal aberto notifica quando o app está em segundo plano',
  deveExibirNotificacaoNativaDeMencao({
    channelId: 'c1', activeChannelId: 'c1', dmMode: false, appFocado: false,
  }) === true);

let chamadasDaPonte = 0;
globalThis.window = { appDesktop: { tocarSomDeMencao: () => { chamadasDaPonte += 1; } } };
tocarSomDeMencao();
check('som de menção no desktop chama o MP3 empacotado', chamadasDaPonte === 1);
delete globalThis.window;

let tonsIniciados = 0;
globalThis.AudioContext = class AudioContextFake {
  constructor() { this.state = 'running'; this.currentTime = 0; this.destination = {}; }
  createGain() {
    return {
      gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
      connect() {},
    };
  }
  createOscillator() {
    return {
      type: 'sine', frequency: { setValueAtTime() {} }, connect() {},
      start() { tonsIniciados += 1; }, stop() {},
    };
  }
};
tocarSomDeMencao();
check('som de menção no navegador mantém o aviso local', tonsIniciados === 2);
delete globalThis.AudioContext;

const total = passou + falhas.length;
console.log(`\n${passou}/${total} verificacoes passaram`);
if (falhas.length) {
  console.log(`falhas: ${falhas.join(', ')}`);
  process.exit(1);
}
console.log('tudo certo\n');
