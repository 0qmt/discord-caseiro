import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Servida pelo servidor principal em /baixar (não na raiz), então os
// caminhos dos assets gerados precisam ser relativos a essa base.
export default defineConfig({
  base: '/baixar/',
  plugins: [react()],
  server: {
    port: 5221,
    strictPort: true,
  },
});
