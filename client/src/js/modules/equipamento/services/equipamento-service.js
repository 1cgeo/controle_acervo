import { apiGet, apiPost, apiPut, apiDelete, apiDownload } from '@services/api-client.js';

/**
 * Camada de servico do modulo EQUIPAMENTO: uma funcao por endpoint do backend.
 * Todas devolvem o payload `dados` (o api-client ja desembrulha o envelope).
 *
 * PREFIXO '/equipamento', montado em server/src/routes.js. O nome colide de
 * proposito com o `id` do modulo no registry e com `dominio.modulo.nome_abrev`:
 * sao a mesma coisa vista de tres lados, e o `verifyPerfil(nivel, 'equipamento')`
 * do servidor compara essa string por igualdade.
 *
 * A LISTA DE BENS E A RAIZ (`GET /api/equipamento`), sem sufixo: e por isso que
 * `getEquipamentos` chama `${API}` puro e nao `${API}/equipamento`.
 */

const API = '/equipamento';

function qs(params = {}) {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') search.append(k, v);
  }
  const s = search.toString();
  return s ? `?${s}` : '';
}

// ---- Dominios ----
// UMA chamada para as CINCO listas (classe_suprimento, secao_detentora,
// situacao, situacao_transferencia, tipo_transferencia). Cinco rotas separadas
// obrigariam cada tela a um Promise.all de cinco, e uma falha ali derrubaria a
// tela inteira pela mensagem da quinta.
export const getDominio = () => apiGet(`${API}/dominio`);

// ---- Tipo de equipamento (CADASTRO, id SERIAL) ----
export const getTipos = () => apiGet(`${API}/tipo`);
export const createTipo = (body) => apiPost(`${API}/tipo`, body);
export const updateTipo = (id, body) => apiPut(`${API}/tipo/${id}`, body);
export const deleteTipo = (id) => apiDelete(`${API}/tipo/${id}`);

// ---- Painel ----
export const getDashboard = () => apiGet(`${API}/dashboard`);

// ---- Relatorio DMT ----
// Responde BINARIO (planilha ODS), e por isso passa por `apiDownload` e nao por
// `apiGet`: o api-client desembrulharia um envelope que esta rota nao tem.
export const baixarRelatorioDmt = () =>
  apiDownload(`${API}/relatorio/dmt_ods`, 'relatorio_dmt.ods');

// ---- Indisponibilidade ----
export const getIndisponibilidades = (params = {}) => apiGet(`${API}/indisponibilidade${qs(params)}`);
export const createIndisponibilidade = (body) => apiPost(`${API}/indisponibilidade`, body);
export const updateIndisponibilidade = (id, body) => apiPut(`${API}/indisponibilidade/${id}`, body);
export const deleteIndisponibilidade = (id) => apiDelete(`${API}/indisponibilidade/${id}`);

// ---- Afastamento ----
export const getAfastamentos = (params = {}) => apiGet(`${API}/afastamento${qs(params)}`);
export const createAfastamento = (body) => apiPost(`${API}/afastamento`, body);
export const updateAfastamento = (id, body) => apiPut(`${API}/afastamento/${id}`, body);
export const deleteAfastamento = (id) => apiDelete(`${API}/afastamento/${id}`);

// ---- Manutencao ----
export const getManutencoes = (params = {}) => apiGet(`${API}/manutencao${qs(params)}`);
export const createManutencao = (body) => apiPost(`${API}/manutencao`, body);
export const updateManutencao = (id, body) => apiPut(`${API}/manutencao/${id}`, body);
export const deleteManutencao = (id) => apiDelete(`${API}/manutencao/${id}`);

// ---- Transferencia e descarga ----
export const getTransferencias = (params = {}) => apiGet(`${API}/transferencia${qs(params)}`);
export const createTransferencia = (body) => apiPost(`${API}/transferencia`, body);
export const updateTransferencia = (id, body) => apiPut(`${API}/transferencia/${id}`, body);
export const deleteTransferencia = (id) => apiDelete(`${API}/transferencia/${id}`);

// ---- O BEM ----
export const getEquipamentos = (params = {}) => apiGet(`${API}${qs(params)}`);
export const getEquipamento = (id) => apiGet(`${API}/${id}`);
export const createEquipamento = (body) => apiPost(API, body);
export const updateEquipamento = (id, body) => apiPut(`${API}/${id}`, body);
export const deleteEquipamento = (id) => apiDelete(`${API}/${id}`);
