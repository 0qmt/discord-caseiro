import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canManageRemoteUpdates,
  compareSemanticVersions,
  sanitizeClientInfo,
  selectRemoteUpdateTargets,
  sessionsForUser,
} from './clientSessions.js';

test('compara versões semânticas e rejeita texto inválido', () => {
  assert.equal(compareSemanticVersions('0.2.72', '0.2.73'), -1);
  assert.equal(compareSemanticVersions('0.2.73', '0.2.73'), 0);
  assert.equal(compareSemanticVersions('1.0.0', '0.99.99'), 1);
  assert.equal(compareSemanticVersions('1.0.0-beta.1', '1.0.0'), -1);
  assert.equal(compareSemanticVersions('qualquer', '1.0.0'), null);
});

test('sanitiza a identificação e nunca habilita update fora do desktop instalado', () => {
  assert.deepEqual(sanitizeClientInfo({
    platform: 'desktop', version: 'v0.2.73', portable: false,
    automaticUpdate: true, updateBridge: true,
  }), {
    platform: 'desktop', version: '0.2.73', portable: false,
    automaticUpdate: true, updateBridge: true,
  });
  assert.deepEqual(sanitizeClientInfo({
    platform: 'android', version: '0.2.73', automaticUpdate: true, updateBridge: true,
  }), {
    platform: 'android', version: '0.2.73', portable: false,
    automaticUpdate: false, updateBridge: false,
  });
  assert.equal(sanitizeClientInfo({ platform: 'terminal', version: '0.2.73' }), null);
});

test('a capacidade exige a ID exata configurada', () => {
  assert.equal(canManageRemoteUpdates('pepo-id', 'pepo-id'), true);
  assert.equal(canManageRemoteUpdates('outro-id', 'pepo-id'), false);
  assert.equal(canManageRemoteUpdates('pepo-id', null), false);
});

test('lista também sockets antigos que ainda não se identificaram', () => {
  const sessions = new Map([['socket-a', {
    userId: 'amigo',
    info: sanitizeClientInfo({ platform: 'web', version: '0.2.73' }),
  }]]);
  const result = sessionsForUser(new Set(['socket-a', 'socket-antigo']), sessions);
  assert.equal(result.length, 2);
  assert.equal(result[0].platform, 'web');
  assert.equal(result[1].platform, null);
});

test('seleciona apenas sockets desktop instalados, pertencentes ao alvo e desatualizados', () => {
  const sessions = new Map([
    ['desktop-antigo', { userId: 'amigo', info: sanitizeClientInfo({
      platform: 'desktop', version: '0.2.72', automaticUpdate: true, updateBridge: true,
    }) }],
    ['desktop-atual', { userId: 'amigo', info: sanitizeClientInfo({
      platform: 'desktop', version: '0.2.73', automaticUpdate: true, updateBridge: true,
    }) }],
    ['portable', { userId: 'amigo', info: sanitizeClientInfo({
      platform: 'desktop', version: '0.2.72', portable: true, updateBridge: true,
    }) }],
    ['web', { userId: 'amigo', info: sanitizeClientInfo({
      platform: 'web', version: '0.2.72', automaticUpdate: true, updateBridge: true,
    }) }],
    ['de-outro', { userId: 'outra-pessoa', info: sanitizeClientInfo({
      platform: 'desktop', version: '0.2.72', automaticUpdate: true, updateBridge: true,
    }) }],
  ]);
  const result = selectRemoteUpdateTargets({
    targetUserId: 'amigo',
    selectedSocketIds: [...sessions.keys()],
    onlineSocketIds: new Set(sessions.keys()),
    sessionsBySocket: sessions,
    currentVersion: '0.2.73',
  });
  assert.deepEqual(result, ['desktop-antigo']);
});
