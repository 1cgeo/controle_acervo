import { apiGet, apiDownload } from '@services/api-client.js';
import { cachedFetch, invalidate, TTL_DASHBOARD, TTL_DOMINIO } from '@services/cache.js';

/**
 * Camada de servico do modulo ACERVO: uma funcao por endpoint do backend.
 * Todas devolvem o payload `dados` (o api-client ja desembrulha o envelope).
 *
 * SEM PREFIXO: na fusao com o SCO (2026-07-27) so o orcamento ganhou prefixo.
 * As rotas do acervo continuam onde estavam ('/dashboard/...', '/acervo/...',
 * '/produtos', '/projetos', '/volumes', '/gerencia', '/arquivo'), conforme
 * server/src/routes.js. As rotas de PLATAFORMA ('/login', '/usuarios') moram em
 * '@services/plataforma-service.js'.
 *
 * CACHE: o dashboard chama muitos endpoints por aba, e o auto-refresh repete a
 * carga a cada 60 s. Todas as chaves usam o prefixo CACHE, entao invalidar o
 * dashboard do acervo nao derruba o cache dos outros modulos.
 */

const CACHE = 'acervo:dashboard';

const cached = (chave, endpoint) =>
  cachedFetch(`${CACHE}:${chave}`, () => apiGet(endpoint), TTL_DASHBOARD);

/** Descarta o cache do dashboard do acervo (usado pelo auto-refresh). */
export function invalidarDashboard() {
  invalidate(CACHE);
}

// ---- Aba 1: Visao Geral ----
export const getProdutosTotal = () => cached('produtos_total', '/dashboard/produtos_total');
export const getArquivosTotalGb = () => cached('arquivos_total_gb', '/dashboard/arquivos_total_gb');
export const getUsuariosTotal = () => cached('usuarios_total', '/dashboard/usuarios_total');
export const getSystemHealth = () => cached('system_health', '/dashboard/system_health');

// ---- Aba 2: Distribuicao ----
export const getProdutosTipo = () => cached('produtos_tipo', '/dashboard/produtos_tipo');
export const getProdutosEscala = () => cached('produtos_escala', '/dashboard/produtos_escala');
export const getGbTipoProduto = () => cached('gb_tipo_produto', '/dashboard/gb_tipo_produto');
export const getArquivosTipoArquivo = () => cached('arquivos_tipo_arquivo', '/dashboard/arquivos_tipo_arquivo');
export const getGbVolume = () => cached('gb_volume', '/dashboard/gb_volume');

// ---- Aba 3: Atividade ----
export const getArquivosDia = () => cached('arquivos_dia', '/dashboard/arquivos_dia');
export const getDownloadsDia = () => cached('downloads_dia', '/dashboard/downloads_dia');
export const getUltimosProdutos = () => cached('ultimos_produtos', '/dashboard/ultimos_produtos');
export const getUltimasVersoes = () => cached('ultimas_versoes', '/dashboard/ultimas_versoes');
export const getUltimosCarregamentos = () => cached('ultimos_carregamentos', '/dashboard/ultimos_carregamentos');
export const getUltimasModificacoes = () => cached('ultimas_modificacoes', '/dashboard/ultimas_modificacoes');
export const getUltimosDeletes = () => cached('ultimos_deletes', '/dashboard/ultimos_deletes');
export const getDownloads = () => cached('downloads', '/dashboard/download');
export const getSituacaoCarregamento = () => cached('situacao_carregamento', '/dashboard/situacao_carregamento');

// ---- Aba 4: Analises Avancadas ----
export const getProdutoActivityTimeline = (meses = 6) =>
  cached(`produto_timeline_${meses}`, `/dashboard/produto_activity_timeline?months=${meses}`);
export const getVersaoActivityTimeline = (meses = 6) =>
  cached(`versao_timeline_${meses}`, `/dashboard/versao_activity_timeline?months=${meses}`);
export const getStorageGrowthTrends = (meses = 6) =>
  cached(`storage_trends_${meses}`, `/dashboard/storage_growth_trends?months=${meses}`);
export const getVersionStatistics = () => cached('version_statistics', '/dashboard/version_statistics');
export const getProjectStatusSummary = () => cached('project_status', '/dashboard/project_status_summary');
export const getUserActivityMetrics = (limite = 10) =>
  cached(`user_activity_${limite}`, `/dashboard/user_activity_metrics?limit=${limite}`);

/**
 * Exportacoes do acervo, consumidas pela barra de exportacao do dashboard.
 * Cada uma baixa um ZIP montado pelo servidor.
 */
export const EXPORTACOES_ACERVO = [
  {
    label: 'Exportar planilha (CSV)',
    title: 'Baixa um ZIP com CSVs no formato da planilha de referência, um por escala e tipo de produto',
    endpoint: '/acervo/export-planilha-csv',
    filename: 'planilha-acervo.zip',
  },
  {
    label: 'Exportar GeoJSON (site de produtos)',
    title: 'Baixa um ZIP com os GeoJSONs de situação geral, no formato que o site de produtos consome',
    endpoint: '/acervo/situacao-geral',
    filename: 'situacao-geral.zip',
  },
];

// ---------------------------------------------------------------------------
// Busca do acervo (fase 3 do portal do acervo, chefe 2026-07-25)
// ---------------------------------------------------------------------------

/**
 * Monta a query string SO com o que foi preenchido.
 *
 * Mandar `termo=` vazio ou `tipo_produto_id=` sem valor faz o Joi do servidor
 * recusar ou filtrar por nada, e ainda polui a URL compartilhavel.
 * @param {Object} filtros
 * @returns {string}
 */
function queryString(filtros) {
  const params = new URLSearchParams();
  for (const [chave, valor] of Object.entries(filtros)) {
    if (valor === null || valor === undefined || valor === '' || valor === false) continue;
    params.set(chave, Array.isArray(valor) ? valor.join(',') : String(valor));
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

/**
 * Busca de produtos: textual, por dominio e por recorte espacial.
 *
 * NAO passa pelo cache de propósito. O cache existe para o dashboard, que
 * repete as mesmas chamadas a cada 60 s; busca e sempre uma pergunta nova, e
 * guardar combinacao de filtro so gastaria memoria para nunca acertar.
 *
 * @param {Object} filtros - { termo, tipo_produto_id, tipo_escala_id,
 *   projeto_id, lote_id, bbox, palavra_chave, com_geometria, page, limit }
 * @returns {Promise<{total:number, page:number, limit:number,
 *   extent:Array<number>|null, dados:Array<Object>}>}
 */
export const buscarProdutos = (filtros = {}) =>
  apiGet(`/acervo/busca${queryString(filtros)}`);

/**
 * Geometria de TODOS os produtos que casam com os filtros, sem paginacao.
 *
 * Rota separada da lista de proposito: a lista pagina porque ninguem le 800
 * cartoes, mas o mapa nao pode paginar. Vinte poligonos numa tela de 800
 * resultados afirmam visualmente que o acervo tem vinte cartas ali.
 *
 * O acervo inteiro (5.741 produtos em 2026-07-28) sai em 1,39 MB, entao a
 * chamada e sempre a busca completa e nunca uma fatia.
 *
 * @param {Object} filtros - os MESMOS da busca (sem page/limit)
 * @returns {Promise<{total:number, truncado:boolean, dados:Array<Object>}>}
 */
export const buscarGeometrias = (filtros = {}) =>
  apiGet(`/acervo/busca/geometrias${queryString(filtros)}`);

/**
 * Baixa o resultado da busca em CSV.
 *
 * Exporta o conjunto INTEIRO, e nao a pagina na tela. Com `ids` preenchido sai
 * so o que a pessoa selecionou, e os demais filtros continuam valendo: o CSV
 * nunca traz algo que a busca corrente nao traria.
 *
 * @param {Object} filtros - os mesmos da busca, mais `ids` opcional
 * @param {string} [nomeArquivo]
 * @returns {Promise<void>}
 */
export const baixarBuscaCsv = (filtros = {}, nomeArquivo = 'busca-acervo.csv') =>
  apiDownload(`/acervo/busca/csv${queryString(filtros)}`, nomeArquivo);

/**
 * Palavras-chave em uso, para sugerir a etiqueta em vez de exigir adivinhacao.
 * Cacheado como dominio: a lista muda quando alguem cataloga, nao a cada tecla.
 * @param {string} [termo]
 * @returns {Promise<Array<{palavra:string, usos:number}>>}
 */
export const getPalavrasChave = (termo = '') =>
  cachedFetch(
    `acervo:palavras_chave:${termo}`,
    () => apiGet(`/acervo/palavras_chave${queryString({ termo })}`),
    TTL_DOMINIO
  );

/**
 * Ficha completa do produto: dados, versoes, arquivos e relacionamentos.
 * @param {number} produtoId
 * @returns {Promise<Object>}
 */
export const getProdutoDetalhado = (produtoId) =>
  apiGet(`/acervo/produto/detalhado/${produtoId}`);

// Dominios dos filtros da busca. TTL de dominio: sao tabelas que quase nao mudam.
export const getTiposProduto = () =>
  cachedFetch('acervo:dominio:tipo_produto', () => apiGet('/gerencia/dominio/tipo_produto'), TTL_DOMINIO);

export const getTiposEscala = () =>
  cachedFetch('acervo:dominio:tipo_escala', () => apiGet('/gerencia/dominio/tipo_escala'), TTL_DOMINIO);

/**
 * Subtipos de produto. Cada um pertence a um tipo (`tipo_id`), e a busca usa
 * isso para estreitar a lista quando ha um tipo escolhido.
 * @returns {Promise<Array<{code:number, nome:string, tipo_id:number}>>}
 */
export const getSubtiposProduto = () =>
  cachedFetch('acervo:dominio:subtipo_produto', () => apiGet('/gerencia/dominio/subtipo_produto'), TTL_DOMINIO);
