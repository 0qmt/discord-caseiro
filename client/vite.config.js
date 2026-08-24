import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import pkg from './package.json' with { type: 'json' };

const BACKEND = process.env.BACKEND_URL ?? 'http://localhost:3001';

export default defineConfig({
  plugins: [react()],
  // Prova concreta de que o build chegou: aparece em Configurações > Sobre.
  // Sem isso, "atualizei mas não mudou nada" não dá pra distinguir de
  // "a pessoa não recarregou a janela" de "o build não pegou de verdade".
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  server: {
    // host true = acessivel pelos outros aparelhos da rede local,
    // util pra testar com dois dispositivos antes de expor pra internet.
    host: true,
    port: 5220,
    strictPort: true,
    proxy: {
      '/api': { target: BACKEND, changeOrigin: true },
      '/uploads': { target: BACKEND, changeOrigin: true },
      '/socket.io': { target: BACKEND, ws: true, changeOrigin: true },
    },
  },
});
