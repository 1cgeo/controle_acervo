import { defineConfig } from 'vite';
import { resolve } from 'path';

// Interface unica do SCA. Um client so, com os tres modulos (acervo, mapoteca e
// orcamento), servido na raiz pelo Express. Os clients antigos (acervo_client e
// mapoteca_client) foram apagados em 2026-07-27, quando os tres modulos
// terminaram de ser portados.
//
// As duas portas saem do ambiente, com o padrao de sempre. Existe para levantar
// uma SEGUNDA instancia de desenvolvimento em paralelo (outro par de portas,
// mesmo codigo) sem editar este arquivo, que e versionado: editar o arquivo faz
// a troca de porta aparecer em todo diff e acabar commitada por engano.
const PORTA_CLIENT = Number(process.env.SCA_CLIENT_PORT) || 3003;
const PORTA_API = Number(process.env.SCA_API_PORT) || 3015;

export default defineConfig({
  root: '.',
  base: '/',
  publicDir: 'public',
  server: {
    port: PORTA_CLIENT,
    proxy: {
      '/api': {
        target: `http://localhost:${PORTA_API}`,
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
