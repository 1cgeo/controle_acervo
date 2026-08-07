import { apiGet, apiPost, apiPut, apiDelete, apiDownload, apiUpload } from '@services/api-client.js';

/**
 * Camada de servico do modulo ORCAMENTO: uma funcao por endpoint do backend.
 * Todas devolvem o payload `dados` (o api-client ja desembrulha o envelope).
 *
 * PREFIXO: na fusao com o SCA toda rota deste modulo ganhou
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
export const getFaseLicitacao = () => apiGet(`${API}/dominio/fase_licitacao`);
export const getClassificacaoNc = () => apiGet(`${API}/dominio/classificacao_nc`);
export const getTipoItemDfd = () => apiGet(`${API}/dominio/tipo_item_dfd`);
export const getGrauPrioridade = () => apiGet(`${API}/dominio/grau_prioridade`);

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
export const getAnos = () => apiGet(`${API}/configuracao/anos`);

// ---- Meta do PIT ----
// As metas do PIT NAO sao deste modulo: elas sao dado de
// plataforma, em '@services/plataforma-service.js' (getMetasPit). O orcamento
// continua CONSUMINDO, nos dialogos de item do PDR e de nota de credito.

// ---- DFD (o "PCA do ano" e o conjunto de DFDs do ano) ----
export const getDfds = (ano) => apiGet(`${API}/dfd${qs({ ano })}`);
export const getDfd = (id) => apiGet(`${API}/dfd/${id}`);
export const createDfd = (body) => apiPost(`${API}/dfd`, body);
export const updateDfd = (id, body) => apiPut(`${API}/dfd/${id}`, body);
export const deleteDfd = (id) => apiDelete(`${API}/dfd/${id}`);

// ---- PDR (itens; o PDR e o conjunto dos itens do ano) ----
export const getPdrItens = (ano) => apiGet(`${API}/pdr${qs({ ano })}`);
// SEM `getPdrItem`: a lista ja devolve o item inteiro, e o dialogo de edicao
// recebe a linha da tabela. O embrulho de `GET /orcamento/pdr/:id` nao tinha
// chamador nenhum, e embrulho sem chamador vira contrato que ninguem confere.
export const createPdrItem = (body) => apiPost(`${API}/pdr`, body);
export const updatePdrItem = (id, body) => apiPut(`${API}/pdr/${id}`, body);
export const deletePdrItem = (id) => apiDelete(`${API}/pdr/${id}`);

// ---- Nota de Credito ----
export const getNotasCredito = (params = {}) => apiGet(`${API}/notas_credito${qs(params)}`);
export const getNotaCredito = (id) => apiGet(`${API}/notas_credito/${id}`);
export const createNotaCredito = (body) => apiPost(`${API}/notas_credito`, body);
export const updateNotaCredito = (id, body) => apiPut(`${API}/notas_credito/${id}`, body);
export const deleteNotaCredito = (id) => apiDelete(`${API}/notas_credito/${id}`);

// ---- Recolhimento de crédito ----
// Uma linha por DOCUMENTO do SIAFI que devolve crédito, apontando a NC que ele
// abate. Até a 1.39.0 isto era o campo `valor_recolhido` da própria NC, digitado
// à mão. O `valor_recolhido` continua saindo nas LEITURAS da NC, agora como soma
// destas linhas, e por isso a tela não mudou de nome para o número.
export const getRecolhimentos = (params = {}) => apiGet(`${API}/recolhimentos${qs(params)}`);
export const getRecolhimento = (id) => apiGet(`${API}/recolhimentos/${id}`);
export const createRecolhimento = (body) => apiPost(`${API}/recolhimentos`, body);
export const updateRecolhimento = (id, body) => apiPut(`${API}/recolhimentos/${id}`, body);
export const deleteRecolhimento = (id) => apiDelete(`${API}/recolhimentos/${id}`);

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

// ---- Painel ----
// A execucao por ND que alimenta as tres abas do dashboard. Era
// /orcamento/relatorio/secao3, e e rota propria do painel,
// quando o RPCMTec saiu do modulo: o painel quer NUMEROS quebrados em PDR e
// Extra-PDR, com linha de TOTAL, e e lido por quem tem consulta no orcamento; o
// relatorio quer a visao do PDR ja formatada e e admin-only. Servir os dois da
// mesma rota obrigaria a guarda mais fraca a valer para os dois.
//
// Devolve a LISTA de linhas por ND direto, e nao mais { tabela_31: [...] }: as
// outras seis tabelas da antiga secao 3 nunca foram lidas por esta tela.
export const getExecucaoNd = (params = {}) => apiGet(`${API}/dashboard/execucao_nd${qs(params)}`);

// SEM as chamadas do RPCMTec: elas vivem em
// @services/rpcmtec-service.js, junto com a tela. Este modulo gerava so a secao
// do PDR, e o CRUD da edicao mensal vivia sob /api/orcamento/relatorio; hoje as
// duas coisas estao em /api/rpcmtec, porque o relatorio e da Divisao inteira.

// ---- Arquivos anexados ----
// NC = 1 PDF, DFD = 1 PDF, PDR = varios por ano, recolhimento = varios.
// O vinculo e exatamente um entre { nota_credito_id } | { dfd_id } |
// { pdr_ano } | { recolhimento_id }.
export const getArquivos = (vinculo) => apiGet(`${API}/arquivo${qs(vinculo)}`);
export const uploadArquivo = (vinculo, file) => {
  const fd = new FormData();
  fd.append('arquivo', file);
  return apiUpload(`${API}/arquivo${qs(vinculo)}`, fd);
};
export const downloadArquivo = (id, filename) => apiDownload(`${API}/arquivo/${id}/download`, filename);
export const deleteArquivo = (id) => apiDelete(`${API}/arquivo/${id}`);
