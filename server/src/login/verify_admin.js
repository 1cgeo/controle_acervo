'use strict'

const { AppError, asyncHandler, httpCode } = require('../utils')

const { db } = require('../database')

const validateToken = require('./validate_token')

const { montarContexto } = require('./contexto')

// middleware para verificar se o usuário é administrador
const verifyAdmin = asyncHandler(async (req, res, next) => {
  const token = req.headers.authorization

  const decoded = await validateToken(token)

  if (!('uuid' in decoded && decoded.uuid)) {
    throw new AppError('Falta informação de usuário', httpCode.Unauthorized)
  }
  // `id` junto do `administrador`, na MESMA ida ao banco, para `req.usuarioId`
  // sair daqui e não do token. Os irmãos verifyPerfil e verifyGerente já fazem
  // assim: o token diz quem a pessoa é, o banco diz o resto.
  const result = await db.conn.oneOrNone(
    'SELECT id, administrador FROM dgeo.usuario WHERE uuid = $<usuarioUuid> and ativo IS TRUE',
    { usuarioUuid: decoded.uuid }
  )
  if (!result) {
    throw new AppError(
      'Usuário não encontrado ou inativo',
      httpCode.Forbidden
    )
  }
  if (!result.administrador) {
    throw new AppError(
      'Usuário necessita ser um administrador',
      httpCode.Forbidden
    )
  }
  req.usuarioUuid = decoded.uuid
  req.usuarioId = result.id
  req.administrador = true

  // Origem, rota e lote da rastreabilidade.
  montarContexto(req, decoded)

  next()
})

module.exports = verifyAdmin
