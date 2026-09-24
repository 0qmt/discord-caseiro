const assert = require('node:assert/strict');
const test = require('node:test');
const {
  TOQUE_PADRAO, TOQUE_SIRENE, normalizarToqueDeChamada,
} = require('./toque-chamada.js');

test('aceita somente os dois identificadores fechados', () => {
  assert.equal(normalizarToqueDeChamada('sirene'), TOQUE_SIRENE);
  assert.equal(normalizarToqueDeChamada('padrao'), TOQUE_PADRAO);
  assert.equal(normalizarToqueDeChamada('D:\\som.mp3'), TOQUE_PADRAO);
  assert.equal(normalizarToqueDeChamada('https://exemplo.test/som.mp3'), TOQUE_PADRAO);
  assert.equal(normalizarToqueDeChamada(null), TOQUE_PADRAO);
});
