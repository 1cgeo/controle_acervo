import { apiGet, apiPost, apiPut, apiDelete } from './api-client.js';

/**
 * Servicos de PLATAFORMA: o que nao pertence a nenhum modulo.
 *
 * `/api/login` e `/api/usuarios` continuaram SEM o prefixo de modulo na fusao,
 * de proposito: servem os tres modulos. Todo endpoint de modulo mora no
 * service do proprio modulo (ex.: modules/orcamento/services/orcamento-service.js).
 */

// ---- Usuarios ----
export const getUsuarios = () => apiGet('/usuarios');
export const getUsuariosAuthServer = () => apiGet('/usuarios/servico_autenticacao');
export const importarUsuarios = (uuids) => apiPost('/usuarios', { usuarios: uuids });
export const atualizarUsuario = (uuid, body) => apiPut(`/usuarios/${uuid}`, body);
export const sincronizarUsuarios = () => apiPut('/usuarios/sincronizar', {});

// Catalogo dos modulos e dos niveis de perfil (1 consulta, 2 operador,
// 3 gerente), para a tela nao decorar os codigos do dominio.
export const getModulos = () => apiGet('/usuarios/dominio/modulo');
export const getTiposPerfil = () => apiGet('/usuarios/dominio/tipo_perfil');

// ---- Metas do PIT ----
// Saiu de '/orcamento/metas' em 2026-07-31: o PIT e o plano anual da Divisao, e
// os tres modulos o consomem. LER e de qualquer pessoa logada; ESCREVER e do
// administrador global (o backend cobra, o cliente so evita oferecer o botao).
export const getMetasPit = (ano) => apiGet(ano ? `/metas?ano=${ano}` : '/metas');
export const getAnosMetaPit = () => apiGet('/metas/anos');
export const getMetaPit = (id) => apiGet(`/metas/${id}`);
export const createMetaPit = (body) => apiPost('/metas', body);
export const updateMetaPit = (id, body) => apiPut(`/metas/${id}`, body);
export const deleteMetaPit = (id) => apiDelete(`/metas/${id}`);

/**
 * Rotulo curto da meta, como a planilha e as telas a escrevem: '4.1' quando a
 * meta se subdivide, e o numero da meta quando ela e indivisa (`item` NULO; o
 * '-' literal tambem cai aqui, caso alguem o digite).
 * Mesma regra do SQL em mapoteca_ctrl (ROTULO_META), para as duas nao divergirem.
 * @param {Object} meta
 * @returns {string}
 */
export function codigoMetaPit(meta) {
  if (!meta) return '';
  const item = meta.item && meta.item !== '-' ? String(meta.item) : null;
  return item || String(meta.numero_meta ?? '');
}

/**
 * Rotulo completo para lista de escolha: 'Meta 4.1 - Carta Topográfica...'.
 * @param {Object} meta
 * @returns {string}
 */
export function rotuloMetaPit(meta) {
  if (!meta) return '';
  const codigo = codigoMetaPit(meta);
  return meta.descricao ? `Meta ${codigo} - ${meta.descricao}` : `Meta ${codigo}`;
}
