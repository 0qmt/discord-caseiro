import { useCallback, useEffect, useRef, useState } from 'react';
import { Network } from '@capacitor/network';
import { App as NativeApp } from '@capacitor/app';
import App from '../App.jsx';
import { platform, saveServerUrl } from '../platform/index.js';
import { findAvailableServer } from '../platform/serverRoutes.js';
import discordiaLogo from '../assets/discordia-logo.png';
import MobileUpdater from './MobileUpdater.jsx';

const RETRY_DELAY_MS = 3000;

function MobileConnecting() {
  return (
    <main className="mobile-server-screen">
      <section className="mobile-server-panel" aria-live="polite">
        <img className="mobile-server-logo" src={discordiaLogo} alt="" />
        <h1>discordia</h1>
        <p>Conectando...</p>
      </section>
    </main>
  );
}

export default function MobileRoot() {
  const [connected, setConnected] = useState(!platform.native);
  const checkingRef = useRef(false);
  const retryRef = useRef(null);

  const check = useCallback(async () => {
    if (!platform.native || checkingRef.current) return;
    clearTimeout(retryRef.current);
    checkingRef.current = true;
    try {
      const serverUrl = await findAvailableServer();
      if (!serverUrl) throw new Error('Nenhuma rota do servidor respondeu.');
      await saveServerUrl(serverUrl);
      setConnected(true);
    } catch (err) {
      console.warn('[mobile] servidor indisponivel', err?.message || err);
      setConnected(false);
      retryRef.current = setTimeout(() => void check(), RETRY_DELAY_MS);
    } finally {
      checkingRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (!platform.native) return undefined;
    void check();

    let networkListener;
    void Network.addListener('networkStatusChange', ({ connected: online }) => {
      if (online && !checkingRef.current) void check();
    }).then((listener) => { networkListener = listener; });
    const reconnect = () => {
      setConnected(false);
      void check();
    };
    window.addEventListener('discordia:configure-server', reconnect);
    window.addEventListener('discordia:connection-lost', reconnect);
    return () => {
      clearTimeout(retryRef.current);
      networkListener?.remove();
      window.removeEventListener('discordia:configure-server', reconnect);
      window.removeEventListener('discordia:connection-lost', reconnect);
    };
  }, [check]);

  useEffect(() => {
    if (!platform.android) return undefined;
    let backListener;
    let disposed = false;
    void NativeApp.addListener('backButton', async ({ canGoBack }) => {
      if (document.fullscreenElement) {
        await document.exitFullscreen().catch(() => {});
        return;
      }

      // Lightboxes vivem dentro das telas de chat e ja entendem Escape.
      if (document.querySelector('.lightbox-fundo')) {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        return;
      }

      const event = new CustomEvent('discordia:native-back', { cancelable: true });
      if (!window.dispatchEvent(event)) return;
      if (canGoBack && window.history.length > 1) window.history.back();
      else await NativeApp.minimizeApp();
    }).then((listener) => {
      if (disposed) listener.remove();
      else backListener = listener;
    });
    return () => {
      disposed = true;
      backListener?.remove();
    };
  }, []);

  if (connected) return <><App /><MobileUpdater /></>;
  return <MobileConnecting />;
}
