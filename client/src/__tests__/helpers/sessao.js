// Sessao de teste, para as telas que escondem acao por perfil.
//
// O setup global limpa o localStorage entre testes, entao SEM chamar isto uma
// pagina renderiza como quem nao tem perfil nenhum: os botoes de escrita nao
// aparecem, de proposito. Todo teste que exercita criar, editar ou excluir
// precisa dizer com que perfil esta entrando, e o proprio teste passa a
// documentar o nivel que aquela tela exige.

import { saveAuth } from '@store/auth-store.js';

/** Niveis de dominio.tipo_perfil, hierarquicos. */
export const CONSULTA = 1;
export const OPERADOR = 2;
export const GERENTE = 3;

/**
 * Entra com um perfil por modulo.
 *   logarComo({ mapoteca: GERENTE })
 *   logarComo({ orcamento: OPERADOR })
 *   logarComo({}, { administrador: true })
 *
 * @param {Object} perfis - mapa nome_abrev -> nivel (1 a 3)
 * @param {{administrador?: boolean}} [opcoes]
 */
export function logarComo(perfis = {}, { administrador = false } = {}) {
  // Fixture curta de proposito: o guard anti-vazamento trata `token: <valor>`
  // com 12 caracteres ou mais como possivel credencial de verdade.
  saveAuth({ token: 'tk-teste', administrador, uuid: 'u-teste', perfis, modulos: [] }, 'teste');
}
