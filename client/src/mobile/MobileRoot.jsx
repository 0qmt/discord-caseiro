import { useCallback, useEffect, useRef, useState } from 'react';
import { Network } from '@capacitor/network';
import { App as NativeApp } from '@capacitor/app';
import { Preferences } from '@capacitor/preferences';
import App from '../App.jsx';
import { platform, saveServerUrl } from '../platform/index.js';
import MobileUpdater from './MobileUpdater.jsx';

const HEALTH_TIMEOUT_MS = 7000;
const MOBILE_SERVER_CANDIDATES = [
  'http://192.168.0.56:3001',
  'http://discord-caseiro.duckdns.org:3001',
];

async function serverHealth(baseUrl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
  try {
    const response = await fetch(new URL('/api/health', `${baseUrl}/`), {
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`Servidor respondeu ${response.status}.`);
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function MobileConnecting({ error, onRetry }) {
  return (
    <main className="mobile-server-screen">
      <section className="mobile-server-panel" aria-live="polite">
        <div className="mobile-server-logo">d</div>
        <h1>discordia</h1>
        <p>{error || 'Conectando...'}</p>
        {error && <button className="primary" type="button" onClick={onRetry}>Tentar novamente</button>}
      </section>
    </main>
  );
}

export default function MobileRoot() {
  const [connected, setConnected] = useState(!platform.native);
  const [error, setError] = useState('');
  const [connecting, setConnecting] = useState(platform.native);
  const checkingRef = useRef(false);

  const check = useCallback(async () => {
    if (!platform.native || checkingRef.current) return;
    checkingRef.current = true;
    setConnecting(true);
    setError('');
    const candidates = [...MOBILE_SERVER_CANDIDATES];
    const saved = platform.native
      ? await Preferences.get({ key: 'discordia:server-url' }).then((r) => r.value).catch(() => '')
      : '';
    if (saved && !candidates.includes(saved)) candidates.push(saved);

    for (const candidate of candidates) {
      try {
        await serverHealth(candidate);
        await saveServerUrl(candidate);
        setConnected(true);
        setConnecting(false);
        checkingRef.current = false;
        return;
      } catch (err) {
        console.warn('[mobile] servidor indisponivel', candidate, err?.message || err);
      }
    }
    setConnected(false);
    setError('Nao foi possivel conectar ao servidor.');
    setConnecting(false);
    checkingRef.current = false;
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
    return () => {
      networkListener?.remove();
      window.removeEventListener('discordia:configure-server', reconnect);
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
  return <MobileConnecting error={connecting ? 'Conectando...' : error} onRetry={check} />;
}
