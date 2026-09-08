import { useCallback, useEffect, useRef, useState } from 'react';
import { App as NativeApp } from '@capacitor/app';
import { AndroidUpdater } from '../platform/androidUpdater.js';
import { getNativeVersion, platform } from '../platform/index.js';
import { serverPath } from '../platform/server.js';

const CHECK_INTERVAL_MS = 30 * 60 * 1000;

function validManifest(value) {
  return value
    && value.schemaVersion === 1
    && value.packageName === 'com.discordcaseiro.app'
    && Number.isSafeInteger(value.versionCode)
    && typeof value.versionName === 'string'
    && typeof value.url === 'string'
    && /^[a-fA-F0-9]{64}$/.test(value.sha256)
    && Number.isSafeInteger(value.size)
    && value.size > 0;
}

export default function MobileUpdater() {
  const [update, setUpdate] = useState(null);
  const [status, setStatus] = useState('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const checkingRef = useRef(false);
  const installingRef = useRef(false);

  const check = useCallback(async () => {
    if (!platform.android || checkingRef.current || installingRef.current) return;
    checkingRef.current = true;
    try {
      const [appInfo, response] = await Promise.all([
        getNativeVersion(),
        fetch(serverPath('/api/mobile/update'), { cache: 'no-store' }),
      ]);
      if (response.status === 204) return;
      if (!response.ok) throw new Error(`Servidor respondeu ${response.status}.`);
      const manifest = await response.json();
      if (!validManifest(manifest)) throw new Error('Manifesto de atualizacao invalido.');

      const currentVersionCode = Number(appInfo?.build);
      if (!Number.isSafeInteger(currentVersionCode)) {
        throw new Error('Nao foi possivel identificar a versao instalada.');
      }
      if (manifest.versionCode > currentVersionCode) {
        setUpdate(manifest);
        setError('');
        setStatus('available');
      } else {
        setUpdate(null);
        setStatus('idle');
      }
    } catch (err) {
      // Falha de update nunca impede login, chamadas ou uso offline do app.
      console.warn('[android-update] checagem falhou:', err);
    } finally {
      checkingRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (!platform.android) return undefined;
    void check();
    const timer = window.setInterval(() => void check(), CHECK_INTERVAL_MS);
    let appListener;
    let progressListener;
    let disposed = false;
    void NativeApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive) void check();
    }).then((listener) => {
      if (disposed) listener.remove();
      else appListener = listener;
    });
    void AndroidUpdater.addListener('downloadProgress', ({ percent }) => {
      setProgress(Math.max(0, Math.min(100, Number(percent) || 0)));
    }).then((listener) => {
      if (disposed) listener.remove();
      else progressListener = listener;
    });
    return () => {
      disposed = true;
      window.clearInterval(timer);
      appListener?.remove();
      progressListener?.remove();
    };
  }, [check]);

  async function install() {
    if (!update || installingRef.current) return;
    installingRef.current = true;
    setError('');
    try {
      const permission = await AndroidUpdater.getInstallPermission();
      if (!permission.allowed) {
        await AndroidUpdater.openInstallPermissionSettings();
        setError('Ative "Permitir desta fonte" e toque em Atualizar novamente.');
        return;
      }

      setStatus('downloading');
      setProgress(0);
      const fileName = new URL(update.url, serverPath('/')).pathname.split('/').pop();
      await AndroidUpdater.downloadAndInstall({
        url: serverPath(update.url),
        sha256: update.sha256,
        size: update.size,
        fileName,
      });
      setStatus('installing');
    } catch (err) {
      console.error('[android-update] instalacao falhou:', err);
      setStatus('available');
      setError(err?.message || 'Nao foi possivel instalar a atualizacao.');
    } finally {
      installingRef.current = false;
    }
  }

  if (!update) return null;

  return (
    <aside className="mobile-update" role="status" aria-live="polite">
      <div>
        <strong>Discordia {update.versionName} disponivel</strong>
        <span>
          {status === 'downloading'
            ? `Baixando e verificando... ${Math.round(progress)}%`
            : status === 'installing'
              ? 'Confirme a instalacao no Android.'
              : error || 'Atualize sem perder sua conta ou configuracoes.'}
        </span>
      </div>
      <button type="button" onClick={install} disabled={status === 'downloading' || status === 'installing'}>
        {status === 'downloading' ? `${Math.round(progress)}%` : 'Atualizar'}
      </button>
    </aside>
  );
}
