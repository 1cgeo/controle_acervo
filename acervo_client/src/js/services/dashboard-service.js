import { apiGet } from './api-client.js';
import { cachedFetch } from './cache.js';

const TTL = 60 * 1000; // 1 minute

// Tab 1 - Visao Geral
export function getProdutosTotal() {
  return cachedFetch('produtos_total', () => apiGet('/dashboard/produtos_total'), TTL);
}

export function getArquivosTotalGb() {
  return cachedFetch('arquivos_total_gb', () => apiGet('/dashboard/arquivos_total_gb'), TTL);
}

export function getUsuariosTotal() {
  return cachedFetch('usuarios_total', () => apiGet('/dashboard/usuarios_total'), TTL);
}

// Tab 2 - Distribuicao
export function getProdutosTipo() {
  return cachedFetch('produtos_tipo', () => apiGet('/dashboard/produtos_tipo'), TTL);
}

export function getGbTipoProduto() {
  return cachedFetch('gb_tipo_produto', () => apiGet('/dashboard/gb_tipo_produto'), TTL);
}

export function getGbVolume() {
  return cachedFetch('gb_volume', () => apiGet('/dashboard/gb_volume'), TTL);
}

// Tab 3 - Atividade
export function getArquivosDia() {
  return cachedFetch('arquivos_dia', () => apiGet('/dashboard/arquivos_dia'), TTL);
}

export function getDownloadsDia() {
  return cachedFetch('downloads_dia', () => apiGet('/dashboard/downloads_dia'), TTL);
}

export function getUltimosCarregamentos() {
  return cachedFetch('ultimos_carregamentos', () => apiGet('/dashboard/ultimos_carregamentos'), TTL);
}

export function getUltimasModificacoes() {
  return cachedFetch('ultimas_modificacoes', () => apiGet('/dashboard/ultimas_modificacoes'), TTL);
}

export function getUltimosDeletes() {
  return cachedFetch('ultimos_deletes', () => apiGet('/dashboard/ultimos_deletes'), TTL);
}

export function getDownloads() {
  return cachedFetch('downloads', () => apiGet('/dashboard/download'), TTL);
}

// Tab 4 - Analises Avancadas
export function getProdutoActivityTimeline(months = 6) {
  return cachedFetch(`produto_timeline_${months}`, () => apiGet(`/dashboard/produto_activity_timeline?months=${months}`), TTL);
}

export function getVersionStatistics() {
  return cachedFetch('version_statistics', () => apiGet('/dashboard/version_statistics'), TTL);
}

export function getStorageGrowthTrends(months = 6) {
  return cachedFetch(`storage_trends_${months}`, () => apiGet(`/dashboard/storage_growth_trends?months=${months}`), TTL);
}

export function getProjectStatusSummary() {
  return cachedFetch('project_status', () => apiGet('/dashboard/project_status_summary'), TTL);
}

export function getUserActivityMetrics(limit = 10) {
  return cachedFetch(`user_activity_${limit}`, () => apiGet(`/dashboard/user_activity_metrics?limit=${limit}`), TTL);
}

// New endpoints
export function getSystemHealth() {
  return cachedFetch('system_health', () => apiGet('/dashboard/system_health'), TTL);
}

export function getProdutosEscala() {
  return cachedFetch('produtos_escala', () => apiGet('/dashboard/produtos_escala'), TTL);
}

export function getArquivosTipoArquivo() {
  return cachedFetch('arquivos_tipo_arquivo', () => apiGet('/dashboard/arquivos_tipo_arquivo'), TTL);
}

export function getSituacaoCarregamento() {
  return cachedFetch('situacao_carregamento', () => apiGet('/dashboard/situacao_carregamento'), TTL);
}

export function getVersaoActivityTimeline(months = 6) {
  return cachedFetch(`versao_timeline_${months}`, () => apiGet(`/dashboard/versao_activity_timeline?months=${months}`), TTL);
}

export function getUltimosProdutos() {
  return cachedFetch('ultimos_produtos', () => apiGet('/dashboard/ultimos_produtos'), TTL);
}

export function getUltimasVersoes() {
  return cachedFetch('ultimas_versoes', () => apiGet('/dashboard/ultimas_versoes'), TTL);
}
