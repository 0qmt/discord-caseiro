import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => ({
  base: mode === 'embedded' ? '/baixar/' : '/',
  plugins: [react()],
  server: {
    port: 5221,
    strictPort: true,
  },
}));
