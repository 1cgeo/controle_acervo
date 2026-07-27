import { apiGet, apiPost, apiPut, apiDelete, apiDownload, apiUpload } from '@services/api-client.js';

/**
 * Camada de servico do modulo ORCAMENTO: uma funcao por endpoint do backend.
 * Todas devolvem o payload `dados` (o api-client ja desembrulha o envelope).
 *
 * PREFIXO: na fusao com o SCA (2026-07-27) toda rota deste modulo ganhou
 * '/orcamento' ('/dfd' virou '/orcamento/dfd'), o que resolve as colisoes de
 * nome com o acervo (/dominio, /relatorio, /arquivo). A lista real esta em
 * server/src/routes.js. As rotas de PLATAFORMA ('/login', '/usuarios')
 * continuam sem prefixo e moram em '@services/plataforma-service.js'.
 */

const API = '/orcamento';

function qs(params = {}) {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') search.append(k, v);
  }
  const s = search.toString();
  return s ? `?${s}` : '';
}

// ---- Dominios (selects) ----
export const getNaturezaDespesa = () => apiGet(`${API}/dominio/natureza_despesa`);
export const getPlanoInterno = () => apiGet(`${API}/dominio/plano_interno`);
export const getUg = () => apiGet(`${API}/dominio/ug`);
export const getTipoLicitacao = () => apiGet(`${API}/dominio/tipo_licitacao`);
export const getClassificacaoNc = () => apiGet(`${API}/dominio/classificacao_nc`);
export const getTipoItemDfd = () => apiGet(`${API}/dominio/tipo_item_dfd`);
export const getGrauPrioridade = () => apiGet(`${API}/dominio/grau_prioridade`);
export const getTipoPostoGrad = () => apiGet(`${API}/dominio/tipo_posto_grad`);

// ---- Dominios editaveis (CRUD admin, geridos pela Configuracao) ----
export const createNaturezaDespesa = (body) => apiPost(`${API}/dominio/natureza_despesa`, body);
export const updateNaturezaDespesa = (code, body) => apiPut(`${API}/dominio/natureza_despesa/${encodeURIComponent(code)}`, body);
export const deleteNaturezaDespesa = (code) => apiDelete(`${API}/dominio/natureza_despesa/${encodeURIComponent(code)}`);

export const createPlanoInterno = (body) => apiPost(`${API}/dominio/plano_interno`, body);
export const updatePlanoInterno = (code, body) => apiPut(`${API}/dominio/plano_interno/${encodeURIComponent(code)}`, body);
export const deletePlanoInterno = (code) => apiDelete(`${API}/dominio/plano_interno/${encodeURIComponent(code)}`);

export const createUg = (body) => apiPost(`${API}/dominio/ug`, body);
export const updateUg = (code, body) => apiPut(`${API}/dominio/ug/${encodeURIComponent(code)}`, body);
export const deleteUg = (code) => apiDelete(`${API}/dominio/ug/${encodeURIComponent(code)}`);

// ---- Configuracao geral e anos ----
export const getConfig = () => apiGet(`${API}/configuracao`);
export const updateConfig = (body) => apiPut(`${API}/configuracao`, body);
export const getAnos = () => apiGet(`${API}/configuracao/anos`);

// ---- Meta do PIT ----
export const getMetas = (ano) => apiGet(`${API}/metas${qs({ ano })}`);
export const getMeta = (id) => apiGet(`${API}/metas/${id}`);
export const createMeta = (body) => apiPost(`${API}/metas`, body);
export const updateMeta = (id, body) => apiPut(`${API}/metas/${id}`, body);
export const deleteMeta = (id) => apiDelete(`${API}/metas/${id}`);

// ---- DFD (o "PCA do ano" e o conjunto de DFDs do ano) ----
export const getDfds = (ano) => apiGet(`${API}/dfd${qs({ ano })}`);
export const getDfd = (id) => apiGet(`${API}/dfd/${id}`);
export const createDfd = (body) => apiPost(`${API}/dfd`, body);
export const updateDfd = (id, body) => apiPut(`${API}/dfd/${id}`, body);
export const deleteDfd = (id) => apiDelete(`${API}/dfd/${id}`);

// ---- PDR (itens; o PDR e o conjunto dos itens do ano) ----
export const getPdrItens = (ano) => apiGet(`${API}/pdr${qs({ ano })}`);
export const getPdrItem = (id) => apiGet(`${API}/pdr/${id}`);
export const createPdrItem = (body) => apiPost(`${API}/pdr`, body);
export const updatePdrItem = (id, body) => apiPut(`${API}/pdr/${id}`, body);
export const deletePdrItem = (id) => apiDelete(`${API}/pdr/${id}`);

// ---- Nota de Credito ----
export const getNotasCredito = (params = {}) => apiGet(`${API}/notas_credito${qs(params)}`);
export const getNotaCredito = (id) => apiGet(`${API}/notas_credito/${id}`);
export const createNotaCredito = (body) => apiPost(`${API}/notas_credito`, body);
export const updateNotaCredito = (id, body) => apiPut(`${API}/notas_credito/${id}`, body);
export const deleteNotaCredito = (id) => apiDelete(`${API}/notas_credito/${id}`);

// ---- Nota de Empenho ----
export const getNotasEmpenho = (params = {}) => apiGet(`${API}/notas_empenho${qs(params)}`);
export const getNotaEmpenho = (id) => apiGet(`${API}/notas_empenho/${id}`);
export const createNotaEmpenho = (body) => apiPost(`${API}/notas_empenho`, body);
export const updateNotaEmpenho = (id, body) => apiPut(`${API}/notas_empenho/${id}`, body);
export const deleteNotaEmpenho = (id) => apiDelete(`${API}/notas_empenho/${id}`);

// ---- Liquidacao ----
export const getLiquidacoes = (notaEmpenhoId) => apiGet(`${API}/liquidacoes${qs({ nota_empenho_id: notaEmpenhoId })}`);
export const createLiquidacao = (body) => apiPost(`${API}/liquidacoes`, body);
export const updateLiquidacao = (id, body) => apiPut(`${API}/liquidacoes/${id}`, body);
export const deleteLiquidacao = (id) => apiDelete(`${API}/liquidacoes/${id}`);

// ---- Recebimento de material ----
export const getRecebimentos = (notaEmpenhoId) => apiGet(`${API}/recebimentos${qs({ nota_empenho_id: notaEmpenhoId })}`);
export const createRecebimento = (body) => apiPost(`${API}/recebimentos`, body);
export const updateRecebimento = (id, body) => apiPut(`${API}/recebimentos/${id}`, body);
export const deleteRecebimento = (id) => apiDelete(`${API}/recebimentos/${id}`);

// ---- Licitacao ----
export const getLicitacoes = (params = {}) => apiGet(`${API}/licitacoes${qs(params)}`);
export const getLicitacao = (id) => apiGet(`${API}/licitacoes/${id}`);
export const createLicitacao = (body) => apiPost(`${API}/licitacoes`, body);
export const updateLicitacao = (id, body) => apiPut(`${API}/licitacoes/${id}`, body);
export const deleteLicitacao = (id) => apiDelete(`${API}/licitacoes/${id}`);

// ---- RPNP ----
export const getRpnps = (ano) => apiGet(`${API}/rpnp${qs({ ano })}`);
export const getRpnp = (id) => apiGet(`${API}/rpnp/${id}`);
export const createRpnp = (body) => apiPost(`${API}/rpnp`, body);
export const updateRpnp = (id, body) => apiPut(`${API}/rpnp/${id}`, body);
export const deleteRpnp = (id) => apiDelete(`${API}/rpnp/${id}`);

// ---- Relatorio (RPCMTec secao 3) ----
export const getRelatorios = () => apiGet(`${API}/relatorio`);
export const getRelatorio = (id) => apiGet(`${API}/relatorio/${id}`);
export const createRelatorio = (body) => apiPost(`${API}/relatorio`, body);
export const updateRelatorio = (id, body) => apiPut(`${API}/relatorio/${id}`, body);
export const deleteRelatorio = (id) => apiDelete(`${API}/relatorio/${id}`);
export const getSecao3 = (params = {}) => apiGet(`${API}/relatorio/secao3${qs(params)}`);
export const downloadSecao3Docx = (params = {}) => apiDownload(`${API}/relatorio/secao3/docx${qs(params)}`, `RPCMTec-secao3-${params.ano || ''}-${params.mes || ''}.docx`);

// ---- Arquivos anexados (NC = 1 PDF, DFD = 1 PDF, PDR = varios por ano) ----
// O vinculo e exatamente um entre { nota_credito_id } | { dfd_id } | { pdr_ano }.
export const getArquivos = (vinculo) => apiGet(`${API}/arquivo${qs(vinculo)}`);
export const uploadArquivo = (vinculo, file) => {
  const fd = new FormData();
  fd.append('arquivo', file);
  return apiUpload(`${API}/arquivo${qs(vinculo)}`, fd);
};
export const downloadArquivo = (id, filename) => apiDownload(`${API}/arquivo/${id}/download`, filename);
export const deleteArquivo = (id) => apiDelete(`${API}/arquivo/${id}`);
