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

console.log('menções do servidor: 5/5 verificações passaram');
