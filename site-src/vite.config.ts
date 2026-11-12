import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  base: '/',
  plugins: [react()],
  build: { rollupOptions: { input: { home: fileURLToPath(new URL('./index.html', import.meta.url)), reading: fileURLToPath(new URL('./reading/index.html', import.meta.url)) } } },
});
