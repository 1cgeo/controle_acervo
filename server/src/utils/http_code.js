'use strict'

/**
 * Objeto com os códigos HTTP
 * @description
 * Objeto que guarda os códigos HTTP
 * @typedef {Object} httpCode
 * @property {number} OK - 200
 * @property {number} Created - 201
 * @property {number} NoContent - 204
 * @property {number} NotModified - 304
 * @property {number} BadRequest - 400
 * @property {number} Unauthorized - 401
 * @property {number} Forbidden - 403
 * @property {number} NotFound - 404
 * @property {number} Conflict - 409
 * @property {number} RangeNotSatisfiable - 416
 * @property {number} InternalError - 500
 * @property {number} ServiceUnavailable - 503
 */
const httpCode = {
  OK: 200,
  Created: 201,
  NoContent: 204,
  // Revalidação por etiqueta: o cliente já tem a versão atual e nada viaja.
  NotModified: 304,
  BadRequest: 400,
  Unauthorized: 401,
  Forbidden: 403,
  NotFound: 404,
  Conflict: 409,
  // Retomada de download que pede faixa de bytes fora do arquivo.
  RangeNotSatisfiable: 416,
  InternalError: 500,
  // A DEPENDENCIA EXTERNA que faltou, e nao um defeito deste servico. Ele existe
  // por causa do BANCO DA TELEMETRIA (`/api/microcontrole`), que e o unico
  // recurso opcional do sistema: sem ele o servico sobe inteiro, e as seis rotas
  // que o leem dizem "indisponivel" em vez de 500. A distincao importa para quem
  // recebe: 500 manda abrir chamado contra o SAP, 503 manda olhar o outro
  // servidor -- ou configurar as chaves MICRO_DB_*, que talvez nunca tenham sido
  // preenchidas.
  ServiceUnavailable: 503
}

module.exports = httpCode
