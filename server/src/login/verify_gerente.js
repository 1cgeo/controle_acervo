'use strict'

const { AppError, asyncHandler, httpCode } = require('../utils')

const { db } = require('../database')

const validateToken = require('./validate_token')
const { montarContexto } = require('./contexto')

/**
 * Passa o ADMINISTRADOR GLOBAL e o GERENTE de qualquer modulo.
 *
 * POR QUE NAO `verifyPerfil`. Ele le o perfil de UM modulo por vez (o `moduloId`
 * entra na consulta), e o que ele guarda aqui nao e de modulo nenhum: o PIT e o
 * plano anual da DIVISAO, e os tres modulos o consomem. Encadear tres guardas
 * daria "passa se tiver perfil em algum", que e outra pergunta.
 *
 * POR QUE NAO `verifyLogin`. Ele le `administrador` do TOKEN, que envelhece por
 * ate 8 horas (JWT_EXPIRACAO). Rebaixar alguem nao tiraria a tela dele hoje.
 * Aqui, como no `verifyPerfil`, o perfil sai do BANCO a cada requisicao.
 *
 * QUEM FICA DE FORA: operador e consulta. O PIT e o compromisso do ano, e quem
 * responde por ele e quem responde pelo modulo. Ate 2026-08-02 a leitura era de
 * qualquer pessoa logada; o chefe fechou para gerente e administrador.
 *
 * IRMAO DE `auditoria/verify_rastreabilidade.js`, que faz a mesma pergunta e
 * ainda devolve QUAIS modulos a pessoa ve. Aquele fica onde esta: o recorte por
 * modulo so interessa a quem varre os tres, e trazer o recorte para ca daria a
 * esta rota um campo que ela nao usa.
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
