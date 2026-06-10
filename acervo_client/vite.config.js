import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: '.',
  publicDir: 'public',
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:3013',
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
      '@features': resolve(__dirname, 'src/js/features'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-charts': ['chart.js'],
        },
      },
    },
  },
});
