'use strict'

const { AppError, asyncHandler, httpCode } = require('../utils')

const { db } = require('../database')

const validateToken = require('./validate_token')

const { montarContexto } = require('./contexto')

const { colunaCarimbo, conferirCarimbo } = require('./carimbo_da_senha')

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
    `SELECT id, administrador, ${colunaCarimbo()}
     FROM dgeo.usuario WHERE uuid = $<usuarioUuid> and ativo IS TRUE`,
    { usuarioUuid: decoded.uuid }
  )
  if (!result) {
    throw new AppError(
      'Usuário não encontrado ou inativo',
      httpCode.Forbidden
    )
  }

  // A SENHA MUDOU? O `carimbo` do token é derivado do hash que valia quando ele
  // foi emitido, e a coluna acima traz o do hash de HOJE. Divergiu, a sessão
  // acabou -- é o que faz a troca de senha (e o reset pelo administrador)
  // expulsar quem já estava dentro. Token sem o claim é legado e passa; ver
  // `carimbo_da_senha.js`.
  conferirCarimbo(decoded, result)
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
