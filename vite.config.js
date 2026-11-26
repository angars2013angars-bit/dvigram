import { defineConfig } from 'vite';

export default defineConfig({
  appType: 'spa',
  build: {
    target: 'es2020',
    cssMinify: true,
    minify: 'esbuild',
    sourcemap: false,
  },
  server: {
    port: 5173,
    strictPort: false,
  },
});
