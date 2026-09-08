import { Preferences } from '@capacitor/preferences';
import { platform } from './index.js';
import { SecureStorage } from './secureStorage.js';

const TOKEN_KEY = 'discord-caseiro:token';
let nativeToken = null;

export async function initializeAuthStorage() {
  if (!platform.native) return;
  if (platform.android) {
    try {
      const secure = await SecureStorage.get();
      nativeToken = secure.value || null;
      if (nativeToken) return;
    } catch (err) {
      console.warn('[auth] sessao protegida indisponivel:', err);
    }
  }

  const legacy = await Preferences.get({ key: TOKEN_KEY });
  nativeToken = legacy.value || null;
  if (platform.android && nativeToken) {
    await SecureStorage.set({ value: nativeToken });
    await Preferences.remove({ key: TOKEN_KEY });
  }
}

export function readToken() {
  return platform.native ? nativeToken : localStorage.getItem(TOKEN_KEY);
}

export function writeToken(token) {
  if (!platform.native) {
    localStorage.setItem(TOKEN_KEY, token);
    return;
  }
  nativeToken = token;
  if (platform.android) {
    void SecureStorage.set({ value: token }).catch((err) => console.error('[auth] falha ao proteger sessao:', err));
  } else {
    void Preferences.set({ key: TOKEN_KEY, value: token });
  }
}

export function removeToken() {
  if (!platform.native) {
    localStorage.removeItem(TOKEN_KEY);
    return;
  }
  nativeToken = null;
  if (platform.android) {
    void Promise.all([
      SecureStorage.remove(),
      Preferences.remove({ key: TOKEN_KEY }),
    ]).catch((err) => console.error('[auth] falha ao remover sessao:', err));
  } else {
    void Preferences.remove({ key: TOKEN_KEY });
  }
}
