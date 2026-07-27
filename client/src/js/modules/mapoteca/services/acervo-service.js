import { apiGet } from '@services/api-client.js';
import { cachedFetch, TTL_DOMINIO, TTL_LISTA } from '@services/cache.js';

/**
 * Leitura do catalogo do ACERVO, usada pelo wizard de pedido para escolher a
 * versao (RN08: todo item de pedido referencia acervo.versao; quando a busca
 * nao acha nada, a pessoa cadastra o produto no acervo primeiro).
 *
 * POR QUE ELE MORA NO MODULO MAPOTECA: o arquivo cruza dois modulos, mas quem
 * consome e so o wizard da mapoteca. Enquanto o consumidor for unico, ele fica
 * aqui. Quando uma segunda tela (de outro modulo) chamar as mesmas rotas, mova
 * para '@services/' como service de plataforma. As rotas em si sao do acervo
 * ('/acervo/busca', '/acervo/produto/detalhado/:id', '/gerencia/dominio/...').
 */

/**
 * Paginated product search (does NOT return uuid_versao — pick the version
 * via getProdutoDetalhado afterwards).
 * @param {{termo?:string, tipo_produto_id?:number, tipo_escala_id?:number, page?:number, limit?:number}} [filtros]
 * @returns {Promise<{total:number, page:number, limit:number, dados:Array}>}
 */
export function buscarProdutos(filtros = {}) {
  const params = new URLSearchParams();
  if (filtros.termo) params.set('termo', filtros.termo);
  if (filtros.tipo_produto_id) params.set('tipo_produto_id', String(filtros.tipo_produto_id));
  if (filtros.tipo_escala_id) params.set('tipo_escala_id', String(filtros.tipo_escala_id));
  params.set('page', String(filtros.page || 1));
  params.set('limit', String(filtros.limit || 20));
  const qs = params.toString();
  return cachedFetch(`acervo:busca:${qs}`, () => apiGet(`/acervo/busca?${qs}`), TTL_LISTA);
}

/**
 * Full product info including versions (each with `uuid_versao`),
 * relationships and files.
 * @param {number} produtoId
 */
export function getProdutoDetalhado(produtoId) {
  return cachedFetch(
    `acervo:produto_detalhado:${produtoId}`,
    () => apiGet(`/acervo/produto/detalhado/${produtoId}`),
    TTL_LISTA
  );
}

/** Acervo domain: product types. @returns {Promise<Array<{code:number, nome:string}>>} */
export function getTiposProduto() {
  return cachedFetch('acervo:dominio:tipo_produto', () => apiGet('/gerencia/dominio/tipo_produto'), TTL_DOMINIO);
}

/** Acervo domain: scale types. @returns {Promise<Array<{code:number, nome:string}>>} */
export function getTiposEscala() {
  return cachedFetch('acervo:dominio:tipo_escala', () => apiGet('/gerencia/dominio/tipo_escala'), TTL_DOMINIO);
}
