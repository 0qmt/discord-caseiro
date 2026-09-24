import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ganhoDoVolumeIndividual,
  limitarVolumeHtml,
  limitarVolumeIndividual,
  suportaGanhoWebAudio,
} from './volumeGain.js';

test('volume normal fica entre 0% e 200%', () => {
  assert.equal(limitarVolumeIndividual(-1), 0);
  assert.equal(limitarVolumeIndividual(1), 1);
  assert.equal(limitarVolumeIndividual(2), 2);
  assert.equal(limitarVolumeIndividual(4), 2);
});

test('volume confirmado aceita ganho real ate 400%', () => {
  assert.equal(limitarVolumeIndividual(2, true), 2);
  assert.equal(limitarVolumeIndividual(3.25, true), 3.25);
  assert.equal(limitarVolumeIndividual(4, true), 4);
  assert.equal(limitarVolumeIndividual(8, true), 4);
  assert.equal(ganhoDoVolumeIndividual(4), 4);
});

test('fallback HTML nunca finge amplificacao', () => {
  assert.equal(limitarVolumeHtml(0), 0);
  assert.equal(limitarVolumeHtml(0.82), 0.82);
  assert.equal(limitarVolumeHtml(2), 1);
  assert.equal(limitarVolumeHtml(4), 1);
});

test('amplificacao so aparece quando o grafo necessario existe', () => {
  class ContextoCompleto {}
  ContextoCompleto.prototype.createMediaStreamSource = () => {};
  ContextoCompleto.prototype.createGain = () => {};

  assert.equal(suportaGanhoWebAudio({ AudioContext: ContextoCompleto }), true);
  assert.equal(suportaGanhoWebAudio({ AudioContext: class {} }), false);
  assert.equal(suportaGanhoWebAudio({}), false);
});
