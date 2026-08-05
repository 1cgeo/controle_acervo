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
  InternalError: 500
}

module.exports = httpCode
