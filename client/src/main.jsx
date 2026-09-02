import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { restaurarTemaAppInicial } from './lib/temaApp.js';
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

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
