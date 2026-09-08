import { useCallback, useEffect, useState } from 'react';
import { Network } from '@capacitor/network';
import { App as NativeApp } from '@capacitor/app';
import App from '../App.jsx';
import { getServerUrl, platform, saveServerUrl } from '../platform/index.js';
import { serverPath } from '../platform/server.js';
import MobileUpdater from './MobileUpdater.jsx';

const HEALTH_TIMEOUT_MS = 7000;

async function serverHealth() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
  try {
    const response = await fetch(serverPath('/api/health'), {
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`Servidor respondeu ${response.status}.`);
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function ServerSetup({ initialUrl, initialError, onConnected }) {
  const [url, setUrl] = useState(initialUrl);
  const [error, setError] = useState(initialError);
  const [checking, setChecking] = useState(false);

  async function connect(event) {
    event.preventDefault();
    setChecking(true);
    setError('');
    try {
      await saveServerUrl(url);
      await serverHealth();
      onConnected();
    } catch (err) {
      setError(err.name === 'AbortError'
        ? 'O servidor demorou demais para responder.'
        : (err.message || 'Nao foi possivel conectar.'));
    } finally {
      setChecking(false);
    }
  }

  return (
    <main className="mobile-server-screen">
      <form className="mobile-server-panel" onSubmit={connect}>
        <div className="mobile-server-logo">d</div>
        <h1>discordia</h1>
        <p>Conecte ao servidor dos seus amigos.</p>
        <label>
          Endereco do servidor
          <input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="discord-caseiro.duckdns.org:3001"
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck="false"
            required
          />
        </label>
        {error && <div className="auth-error">{error}</div>}
        <button className="primary" type="submit" disabled={checking}>
          {checking ? 'Conectando...' : 'Conectar'}
        </button>
        <small>Na mesma rede do Umbrel, voce tambem pode usar o IP local.</small>
      </form>
    </main>
  );
}

export default function MobileRoot() {
  const [connected, setConnected] = useState(!platform.native);
  const [error, setError] = useState('');

  const check = useCallback(async () => {
    try {
      await serverHealth();
      setError('');
      setConnected(true);
    } catch (err) {
      setError(err.name === 'AbortError'
        ? 'O servidor demorou demais para responder.'
        : 'Nao encontrei o servidor nesse endereco.');
      setConnected(false);
    }
  }, []);

  useEffect(() => {
    if (!platform.native) return undefined;
    void check();

    let networkListener;
    void Network.addListener('networkStatusChange', ({ connected: online }) => {
      if (online && !connected) void check();
    }).then((listener) => { networkListener = listener; });

    const configure = () => setConnected(false);
    window.addEventListener('discordia:configure-server', configure);
    return () => {
      networkListener?.remove();
      window.removeEventListener('discordia:configure-server', configure);
    };
  }, [check, connected]);

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
  return (
    <ServerSetup
      initialUrl={getServerUrl()}
      initialError={error}
      onConnected={() => setConnected(true)}
    />
  );
}
