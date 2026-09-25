import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compareSemanticVersions,
  createRemoteUpdateIntent,
  nextRemoteUpdateAction,
  readRemoteUpdateIntent,
  remoteUpdateMenuItems,
  saveRemoteUpdateIntent,
} from './remoteUpdate.js';

function fakeStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

test('compara versão igual, anterior, posterior e inválida', () => {
  assert.equal(compareSemanticVersions('0.2.72', '0.2.73'), -1);
  assert.equal(compareSemanticVersions('0.2.73', '0.2.73'), 0);
  assert.equal(compareSemanticVersions('0.3.0', '0.2.73'), 1);
  assert.equal(compareSemanticVersions('x', '0.2.73'), null);
});

test('menu só permite reinício para desktop instalado e desatualizado', () => {
  const called = [];
  const items = remoteUpdateMenuItems([
    { socketId: 'old', platform: 'desktop', version: '0.2.72', automaticUpdate: true, updateBridge: true },
    { socketId: 'new', platform: 'desktop', version: '0.2.73', automaticUpdate: true, updateBridge: true },
    { socketId: 'portable', platform: 'desktop', version: '0.2.72', portable: true, updateBridge: true },
    { socketId: 'android', platform: 'android', version: '0.2.72' },
    { socketId: 'web', platform: 'web', version: '0.2.72' },
  ], '0.2.73', (ids) => called.push(ids));

  assert.equal(items[0].desabilitado, false);
  items[0].onClick();
  assert.deepEqual(called, [['old']]);
  assert.equal(items.slice(1).every((item) => item.desabilitado), true);
  assert.match(items[2].label, /Portable/);
});

test('intenção persiste, instala quando pronta e reinicia no máximo uma vez', () => {
  const storage = fakeStorage();
  const intent = createRemoteUpdateIntent('0.2.74', 1000);
  assert.equal(saveRemoteUpdateIntent(intent, storage), true);
  assert.deepEqual(readRemoteUpdateIntent(storage, 1100), intent);

  assert.equal(nextRemoteUpdateAction(intent, {
    status: 'ready', downloaded: true, currentVersion: '0.2.73',
  }, 1100).action, 'install');

  const firstIdle = nextRemoteUpdateAction(intent, {
    status: 'idle', currentVersion: '0.2.73',
  }, 1100);
  assert.equal(firstIdle.action, 'restart');
  assert.equal(firstIdle.intent.restarts, 1);
  assert.equal(nextRemoteUpdateAction(firstIdle.intent, {
    status: 'idle', currentVersion: '0.2.73',
  }, 1200).action, 'stop');
});

test('intenção termina em versão atual, falha ou expiração', () => {
  const intent = createRemoteUpdateIntent('0.2.74', 1000);
  assert.equal(nextRemoteUpdateAction(intent, {
    status: 'idle', currentVersion: '0.2.74',
  }, 1100).reason, 'updated');
  assert.equal(nextRemoteUpdateAction(intent, {
    status: 'failed', currentVersion: '0.2.73',
  }, 1100).reason, 'failed');
  assert.equal(nextRemoteUpdateAction(intent, {
    status: 'checking', currentVersion: '0.2.73',
  }, intent.expiresAt + 1).reason, 'expired');
});
