import assert from 'node:assert/strict';
import { alvosCodificados, resolverDestinatarios } from '../src/lib/mencoes.js';

const alvos = alvosCodificados('oi <@u2>, <@u2> e <@everyone>');
assert.deepEqual([...alvos], ['u2', 'everyone']);

assert.deepEqual(
  resolverDestinatarios('oi <@u2>', ['u1', 'u2', 'u3'], 'u1'),
  ['u2'],
);
assert.deepEqual(
  resolverDestinatarios('<@everyone> e <@u2>', ['u1', 'u2', 'u3'], 'u1').sort(),
  ['u2', 'u3'],
);
assert.deepEqual(
  resolverDestinatarios('tentativa <@fora>', ['u1', 'u2'], 'u1'),
  [],
);
assert.deepEqual(
  resolverDestinatarios('eu mesmo <@u1>', ['u1', 'u2'], 'u1'),
  [],
);
assert.deepEqual(
  resolverDestinatarios('oi @pepo', ['u1', 'u2'], 'u1', [
    { id: 'u1', username: 'ana' },
    { id: 'u2', username: 'pepo' },
  ]),
  ['u2'],
);
assert.deepEqual(
  resolverDestinatarios('oi @joao', ['u1', 'u2'], 'u1', [
    { id: 'u1', username: 'ana' },
    { id: 'u2', username: 'pepo', nickname: 'joao' },
  ]),
  ['u2'],
);
assert.deepEqual(
  resolverDestinatarios('oi @alex', ['u1', 'u2', 'u3'], 'u1', [
    { id: 'u1', username: 'ana' },
    { id: 'u2', username: 'alex' },
    { id: 'u3', username: 'alex' },
  ]),
  [],
);

console.log('menções do servidor: 8/8 verificações passaram');
