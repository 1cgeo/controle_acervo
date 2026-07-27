import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

// Config do Vitest para o client. Usa os mesmos aliases do vite.config.js e o
// ambiente jsdom (DOM, localStorage) para testar paginas/componentes Vanilla JS.
export default defineConfig({
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
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/__tests__/setup.js'],
    include: ['src/**/*.test.js'],
    css: false,
  },
});
