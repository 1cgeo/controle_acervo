import { apiGet, apiPost, apiPut } from './api-client.js';

/**
 * Endpoints de /api/usuarios do SCA. Só administrador enxerga.
 *
 * O acesso da pessoa tem duas peças independentes: `administrador` (global,
 * vale em qualquer módulo) e `perfis` (o nível dela em cada módulo, no formato
 * { acervo: 1, mapoteca: 2 }). Nível nulo REMOVE o acesso àquele módulo.
 */

/** @returns {Promise<Array<{uuid:string, login:string, nome:string, administrador:boolean, ativo:boolean, perfis:Object}>>} */
export const getUsuarios = () => apiGet('/usuarios');

/** Usuários que existem no serviço de autenticação e ainda não foram importados. */
export const getUsuariosAuthServer = () => apiGet('/usuarios/servico_autenticacao');

/** Importa por uuid; o usuário nasce ativo, sem perfil nenhum. */
export const importarUsuarios = (uuids) => apiPost('/usuarios', { usuarios: uuids });

/** Repuxa nome, posto e login do serviço de autenticação (não mexe em perfil). */
export const sincronizarUsuarios = () => apiPut('/usuarios/sincronizar', {});

/**
 * @param {string} uuid
 * @param {{administrador:boolean, ativo:boolean, perfis?:Object}} body
 */
export const atualizarUsuario = (uuid, body) => apiPut(`/usuarios/${uuid}`, body);

/** Catálogo dos módulos da plataforma (acervo, mapoteca, ...). */
export const getModulos = () => apiGet('/usuarios/dominio/modulo');

/** Catálogo dos níveis (1 consulta, 2 operador, 3 gerente). */
export const getTiposPerfil = () => apiGet('/usuarios/dominio/tipo_perfil');
