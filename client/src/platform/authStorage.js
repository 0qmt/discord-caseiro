import { Preferences } from '@capacitor/preferences';
import { platform } from './index.js';

const TOKEN_KEY = 'discord-caseiro:token';
let nativeToken = null;

export async function initializeAuthStorage() {
  if (!platform.native) return;
  const saved = await Preferences.get({ key: TOKEN_KEY });
  nativeToken = saved.value || null;
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
  void Preferences.set({ key: TOKEN_KEY, value: token });
}

export function removeToken() {
  if (!platform.native) {
    localStorage.removeItem(TOKEN_KEY);
    return;
  }
  nativeToken = null;
  void Preferences.remove({ key: TOKEN_KEY });
}
