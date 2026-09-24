import assert from 'node:assert/strict';
import test from 'node:test';
import {
  callInviteSoundFor, isSpecialCallSoundEnabled, setSpecialCallSoundEnabled,
  SPECIAL_CALL_SOUND_STORAGE_KEY,
} from './specialCallSound.js';

function fakeStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

test('a preferência começa desligada e persiste localmente', () => {
  const storage = fakeStorage();
  assert.equal(isSpecialCallSoundEnabled(storage), false);
  setSpecialCallSoundEnabled(true, storage);
  assert.equal(storage.getItem(SPECIAL_CALL_SOUND_STORAGE_KEY), '1');
  assert.equal(isSpecialCallSoundEnabled(storage), true);
  setSpecialCallSoundEnabled(false, storage);
  assert.equal(isSpecialCallSoundEnabled(storage), false);
});

test('só uma conta autorizada e com a opção ativa pede a sirene', () => {
  const storage = fakeStorage();
  setSpecialCallSoundEnabled(true, storage);
  assert.equal(callInviteSoundFor({ capabilities: { specialCallSound: true } }, storage), 'sirene');
  assert.equal(callInviteSoundFor({ capabilities: { specialCallSound: false } }, storage), 'padrao');
  assert.equal(callInviteSoundFor({}, storage), 'padrao');
});

test('falha de armazenamento mantém o toque padrão', () => {
  const broken = { getItem() { throw new Error('bloqueado'); } };
  assert.equal(callInviteSoundFor({ capabilities: { specialCallSound: true } }, broken), 'padrao');
});
