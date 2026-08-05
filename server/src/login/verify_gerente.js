'use strict'

const { AppError, asyncHandler, httpCode } = require('../utils')

const { db } = require('../database')

const validateToken = require('./validate_token')
const { montarContexto } = require('./contexto')

/**
 * Passa o ADMINISTRADOR GLOBAL e o GERENTE de qualquer módulo. Fora ficam
 * operador e consulta.
 *
 * Não é `verifyPerfil` porque aquele lê UM módulo por vez, e o PIT é o plano
 * anual da Divisão, que os três consomem. Não é `verifyLogin` porque aquele lê
 * `administrador` do TOKEN, que envelhece até o JWT_EXPIRACAO; aqui o perfil sai
 * do BANCO a cada requisição.
 *
 * Irmão de `auditoria/verify_rastreabilidade.js`, que faz a mesma pergunta e
 * ainda devolve QUAIS módulos a pessoa vê.
 */

// 3 = gerente, em dominio.tipo_perfil.
const PERFIL_GERENTE = 3

const verifyGerente = asyncHandler(async (req, res, next) => {
  const decoded = await validateToken(req.headers.authorization)

  if (!('uuid' in decoded && decoded.uuid)) {
    throw new AppError('Falta informação de usuário', httpCode.Unauthorized)
  }

  const usuario = await db.conn.oneOrNone(
    'SELECT id, administrador FROM dgeo.usuario WHERE uuid = $<uuid> AND ativo IS TRUE',
    { uuid: decoded.uuid }
  )

  if (!usuario) {
    throw new AppError('Usuário não encontrado ou inativo', httpCode.Forbidden)
  }

  req.usuarioUuid = decoded.uuid
  req.usuarioId = usuario.id
  req.administrador = usuario.administrador
  montarContexto(req, decoded)

  if (usuario.administrador) {
    return next()
  }

  const { gerente } = await db.conn.one(
    `SELECT EXISTS (
       SELECT 1 FROM dgeo.usuario_perfil
       WHERE usuario_id = $<usuarioId> AND perfil_id >= $<minimo>
     ) AS gerente`,
    { usuarioId: usuario.id, minimo: PERFIL_GERENTE }
  )

  if (!gerente) {
    throw new AppError(
      'Usuário não possui permissão de gerente em nenhum módulo',
      httpCode.Forbidden
    )
  }

  return next()
})

module.exports = verifyGerente
