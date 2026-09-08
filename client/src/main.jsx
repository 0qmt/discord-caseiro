import React from 'react';
import { createRoot } from 'react-dom/client';
import { restaurarTemaAppInicial } from './lib/temaApp.js';
import { initializeAuthStorage } from './platform/authStorage.js';
import { finishNativeLaunch, initializePlatform } from './platform/index.js';
import './styles.css';
import './componentes.css';
import './cargos.css';
// Por último de propósito: as animações encostam em classes definidas nos
// arquivos acima, e vir depois evita depender de ordem de especificidade.
import './animacoes.css';
// Orbit é a interface oficial e sua camada visual precisa vir depois dos
// estilos compartilhados para apenas especializá-los, sem duplicar componentes.
import './skins/orbit/orbit.css';

restaurarTemaAppInicial();

async function start() {
  try {
    await initializePlatform();
    await initializeAuthStorage();
    const { default: App } = await import('./App.jsx');
    createRoot(document.getElementById('root')).render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    );
  } finally {
    await finishNativeLaunch();
  }
}

void start();
