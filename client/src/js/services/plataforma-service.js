import { apiGet, apiPost, apiPut, apiDelete } from './api-client.js';

/**
 * Servicos de PLATAFORMA: o que nao pertence a nenhum modulo.
 *
 * `/api/login` e `/api/usuarios` continuaram SEM o prefixo de modulo na fusao,
 * de proposito: servem os tres modulos. Todo endpoint de modulo mora no
 * service do proprio modulo (ex.: modules/orcamento/services/orcamento-service.js).
 */

// ---- Usuarios (administrador global) ----
//
// Em 2026-08-02 a autenticacao veio para dentro do SCA, e com ela o cadastro:
// `criarUsuario` e `excluirUsuario` substituem o par importar/sincronizar, que
// existia enquanto `dgeo.usuario` era um espelho do Auth Server.
export const getUsuarios = () => apiGet('/usuarios');
export const criarUsuario = (body) => apiPost('/usuarios', body);
export const atualizarUsuario = (uuid, body) => apiPut(`/usuarios/${uuid}`, body);
export const excluirUsuario = (uuid) => apiDelete(`/usuarios/${uuid}`);

// Reset em LOTE: a senha de cada um passa a ser o LOGIN dele. A tela diz isso
// com todas as letras antes de chamar, porque a senha resultante e adivinhavel
// de proposito e obriga a troca no primeiro acesso.
export const resetarSenhas = (uuids) => apiPost('/usuarios/senha/reset', { usuarios: uuids });

// Catalogo dos modulos e dos niveis de perfil (1 consulta, 2 operador,
// 3 gerente), para a tela nao decorar os codigos do dominio.
export const getModulos = () => apiGet('/usuarios/dominio/modulo');
export const getTiposPerfil = () => apiGet('/usuarios/dominio/tipo_perfil');

// Posto/graduacao NAO e catalogo de administrador: a tela de "Meu perfil"
// tambem o oferece, e quem a usa e qualquer pessoa logada. O servidor guarda a
// mesma diferenca (verifyLogin nesta rota, verifyAdmin nas duas de cima).
export const getPostosGrad = () => apiGet('/usuarios/dominio/tipo_posto_grad');

// ---- Acessos (administrador global) ----
//
// O historico de login, que nasceu com a fusao da autenticacao em 2026-08-02:
// antes dela o registro de quem entrava ficava no banco do Auth Server, junto
// do catalogo de aplicacoes que nao veio.
//
// `total` e o RECORTE do periodo, e o default mora so no Joi do servidor
// (`acessos_schema.js`). Por isso estas funcoes so mandam o parametro quando a
// tela pede um recorte diferente: repetir o 14 e o 30 aqui criaria um segundo
// lugar declarando a mesma coisa, e os dois divergiriam no primeiro ajuste.
const comTotal = (caminho, total, extra = '') => {
  const params = new URLSearchParams();
  if (total) params.set('total', String(total));
  if (extra) params.set('max', String(extra));
  const query = params.toString();
  return apiGet(query ? `${caminho}?${query}` : caminho);
};

export const getAcessosResumo = () => apiGet('/acessos/resumo');
export const getAcessosLogados = () => apiGet('/acessos/logados');
export const getLoginsDia = (total) => comTotal('/acessos/logins/dia', total);
export const getLoginsMes = (total) => comTotal('/acessos/logins/mes', total);
export const getLoginsUsuarios = (total, max) => comTotal('/acessos/logins/usuarios', total, max);
export const getLoginsClientes = (total) => comTotal('/acessos/logins/clientes', total);

// ---- O PROPRIO cadastro (#/perfil), de qualquer pessoa logada ----
//
// `alterarMinhaSenha` e o unico caminho pelo qual alguem troca a propria senha.
// Ate 2026-08-02 nao existia nenhum: a senha vivia no Auth Server.
export const getMeuPerfil = () => apiGet('/usuarios/perfil');
export const atualizarMeuPerfil = (body) => apiPut('/usuarios/perfil', body);
export const alterarMinhaSenha = (body) => apiPut('/usuarios/perfil/senha', body);

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

// ---- Execucao mensal das metas (2.1 do RPCMTec) ----
// Absorvida do SAP em 2026-08-02, junto com as colunas de PROMESSA da meta. LER
// segue a meta (qualquer pessoa logada); ESCREVER e do administrador global.
export const getExecucaoMes = (ano, mes) =>
  apiGet(`/metas/execucao?ano=${ano}&mes=${mes}`);
export const getResumoPit = (ano, mes) =>
  apiGet(mes ? `/metas/execucao/resumo?ano=${ano}&mes=${mes}` : `/metas/execucao/resumo?ano=${ano}`);
export const getExecucaoDaMeta = (metaId) => apiGet(`/metas/execucao/meta/${metaId}`);
// UMA rota para criar e alterar: o par (meta, mes) e uma CELULA de grade, e quem
// preenche nao sabe se aquele mes ja tinha linha. Quem separa e o servidor, e so
// para o rastro.
export const salvarExecucaoPit = (body) => apiPost('/metas/execucao', body);
export const deleteExecucaoPit = (id) => apiDelete(`/metas/execucao/${id}`);

// ---- Demanda Extra-PIT (3.3 do RPCMTec) ----
export const getExtraPit = (ano) =>
  apiGet(ano ? `/metas/extra?ano=${ano}` : '/metas/extra');
export const getAnosExtraPit = () => apiGet('/metas/extra/anos');
export const createExtraPit = (body) => apiPost('/metas/extra', body);
export const updateExtraPit = (id, body) => apiPut(`/metas/extra/${id}`, body);
export const deleteExtraPit = (id) => apiDelete(`/metas/extra/${id}`);

// ---- Aproveitamento do efetivo (6.1) e capacitacao (2.6 e 6.2) ----
// Moram sob /rpcmtec porque sao a ENTRADA do relatorio e nao existem por outra
// razao. Todas sao verifyAdmin no servidor, como o resto daquele modulo.
export const getEfetivoMes = (ano, mes) => apiGet(`/rpcmtec/efetivo/${ano}/${mes}`);
export const getEfetivoFaltantes = (ano, mes) =>
  apiGet(`/rpcmtec/efetivo/faltantes/${ano}/${mes}`);
export const getMesesEfetivo = (ano) =>
  apiGet(ano ? `/rpcmtec/efetivo/meses?ano=${ano}` : '/rpcmtec/efetivo/meses');
export const iniciarEfetivoDoMes = (body) => apiPost('/rpcmtec/efetivo/iniciar', body);
export const copiarEfetivoMesAnterior = (body) => apiPost('/rpcmtec/efetivo/copiar', body);
export const createEfetivo = (body) => apiPost('/rpcmtec/efetivo', body);
export const updateEfetivo = (id, body) => apiPut(`/rpcmtec/efetivo/${id}`, body);
export const deleteEfetivo = (id) => apiDelete(`/rpcmtec/efetivo/${id}`);

export const getCapacitacoes = (ano, tipoId) => {
  const q = new URLSearchParams();
  if (ano) q.set('ano', ano);
  if (tipoId) q.set('tipo_id', tipoId);
  const busca = q.toString();
  return apiGet(busca ? `/rpcmtec/capacitacao?${busca}` : '/rpcmtec/capacitacao');
};
export const getAnosCapacitacao = () => apiGet('/rpcmtec/capacitacao/anos');
export const createCapacitacao = (body) => apiPost('/rpcmtec/capacitacao', body);
export const updateCapacitacao = (id, body) => apiPut(`/rpcmtec/capacitacao/${id}`, body);
export const deleteCapacitacao = (id) => apiDelete(`/rpcmtec/capacitacao/${id}`);

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
