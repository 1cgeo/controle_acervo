import { defineConfig } from 'vite';
import { resolve } from 'path';

// Interface unica do SCA. Um client so, com os tres modulos (acervo, mapoteca e
// orcamento), servido na raiz pelo Express. Os clients antigos (acervo_client e
// mapoteca_client) foram apagados em 2026-07-27, quando os tres modulos
// terminaram de ser portados.
export default defineConfig({
  root: '.',
  base: '/',
  publicDir: 'public',
  server: {
    port: 3003,
    proxy: {
      '/api': {
        target: 'http://localhost:3015',
        changeOrigin: true,
      },
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@css': resolve(__dirname, 'src/css'),
      '@js': resolve(__dirname, 'src/js'),
      '@utils': resolve(__dirname, 'src/js/utils'),
      '@components': resolve(__dirname, 'src/js/components'),
      '@pages': resolve(__dirname, 'src/js/pages'),
      '@services': resolve(__dirname, 'src/js/services'),
      '@store': resolve(__dirname, 'src/js/store'),
      '@modules': resolve(__dirname, 'src/js/modules'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: {
          'chart-vendor': ['chart.js'],
        },
      },
    },
  },
});
