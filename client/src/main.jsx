import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { restaurarTemaAppInicial } from './lib/temaApp.js';
import './styles.css';
import './componentes.css';
import './cargos.css';

restaurarTemaAppInicial();

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
