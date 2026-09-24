import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CALL_INVITE_SOUND, canUseSpecialCallSound, resolveCallInviteSound,
} from './callInviteSound.js';

test('a capacidade só existe para a ID exata configurada', () => {
  assert.equal(canUseSpecialCallSound('dono-123', 'dono-123'), true);
  assert.equal(canUseSpecialCallSound('outro', 'dono-123'), false);
  assert.equal(canUseSpecialCallSound('dono-123', ''), false);
});

test('a conta autorizada consegue selecionar a sirene', () => {
  assert.equal(
    resolveCallInviteSound('dono-123', 'sirene', 'dono-123'),
    CALL_INVITE_SOUND.SIREN,
  );
});

test('pedido forjado ou desconhecido sempre cai no toque padrão', () => {
  assert.equal(resolveCallInviteSound('outro', 'sirene', 'dono-123'), CALL_INVITE_SOUND.DEFAULT);
  assert.equal(resolveCallInviteSound('dono-123', 'arquivo.mp3', 'dono-123'), CALL_INVITE_SOUND.DEFAULT);
  assert.equal(resolveCallInviteSound('dono-123', 'https://exemplo.test/som', 'dono-123'), CALL_INVITE_SOUND.DEFAULT);
});
