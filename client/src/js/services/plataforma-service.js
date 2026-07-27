import { apiGet, apiPost, apiPut } from './api-client.js';

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
