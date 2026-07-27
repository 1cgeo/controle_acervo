import { apiGet } from '@services/api-client.js';
import { cachedFetch, invalidate, TTL_DASHBOARD } from '@services/cache.js';

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
