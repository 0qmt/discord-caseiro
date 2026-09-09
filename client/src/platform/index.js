import { Capacitor } from '@capacitor/core';
import { App as NativeApp } from '@capacitor/app';
import { SplashScreen } from '@capacitor/splash-screen';
import { StatusBar, Style } from '@capacitor/status-bar';
import { Preferences } from '@capacitor/preferences';
import { configureServerUrl, getServerUrl } from './server.js';

const SERVER_KEY = 'discordia:server-url';

export const platform = {
  name: Capacitor.getPlatform(),
  native: Capacitor.isNativePlatform(),
  android: Capacitor.getPlatform() === 'android',
};

export async function initializePlatform() {
  if (!platform.native) return;

  const saved = await Preferences.get({ key: SERVER_KEY });
  if (saved.value) configureServerUrl(saved.value);

  if (platform.android) {
    // A interface do app precisa comecar abaixo da barra de status. `env()`
    // nao recebe inset confiavel no WebView do Android quando ele sobrepoe a
    // janela, e os cabecalhos acabam sob relogio/notificacoes.
    await StatusBar.setOverlaysWebView({ overlay: false }).catch(() => {});
    await StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
    await StatusBar.setBackgroundColor({ color: '#111214' }).catch(() => {});
  }
}

export async function finishNativeLaunch() {
  if (platform.native) await SplashScreen.hide().catch(() => {});
}

export async function saveServerUrl(value) {
  const normalized = configureServerUrl(value);
  if (!normalized) throw new Error('Endereco do servidor invalido.');
  if (platform.native) await Preferences.set({ key: SERVER_KEY, value: normalized });
  return normalized;
}

export async function getNativeVersion() {
  if (!platform.native) return null;
  return NativeApp.getInfo();
}

export { getServerUrl };
