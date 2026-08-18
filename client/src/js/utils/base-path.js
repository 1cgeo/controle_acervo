// Prefixo em que a interface foi buildada, vindo do `base` do Vite (chave
// PUBLIC_PATH de server/config.env, repassada pelo create_build.js).
//
// É '/' quando o SAP responde na raiz do host, e '/<prefixo>/' quando ele está
// atrás de um proxy reverso que o publica num subcaminho. O Vite substitui
// `import.meta.env.BASE_URL` no build e garante a barra no fim; em teste
// (vitest, sem build) ele vale '/', e é por isso que os testes que conferem
// '/api/...' continuam valendo.
//
// A ROTA DA TELA NÃO ENTRA AQUI: o router é de HASH (`#/acervo/...`), e hash
// não atravessa proxy nenhum. O que precisa do prefixo é só o que vira URL de
// rede: a API e os arquivos estáticos.
const BASE = import.meta.env.BASE_URL || '/';

/**
 * Caminho absoluto, na mesma origem, de um arquivo estático do build.
 * @param {string} caminho - sem barra no começo (ex.: 'backgrounds/img-1.jpg')
 * @returns {string}
 */
export function caminhoPublico(caminho) {
  return `${BASE}${String(caminho).replace(/^\/+/, '')}`;
}

/**
 * Prefixo da API na mesma origem, SEM barra no fim: '/api' ou '/<prefixo>/api'.
 * Quem monta a URL concatena o endpoint, que já começa com barra.
 */
export const PREFIXO_API = caminhoPublico('api');
