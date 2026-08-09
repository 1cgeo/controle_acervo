'use strict'

const { AppError, asyncHandler, httpCode } = require('../utils')

const { db } = require('../database')

const validateToken = require('./validate_token')
const { montarContexto } = require('./contexto')

/**
 * Passa o ADMINISTRADOR GLOBAL e o GERENTE de qualquer módulo. Fora ficam
 * operador e consulta.
 *
 * QUEM O USA, desde 2026-08-08: a LEITURA do RPCMTec. A grade da execução do PIT
 * saiu dele no mesmo dia (ela virou `verifyPerfil('consulta', 'pit')`,
 * porque tem módulo próprio), e ele ficou sem chamador por algumas horas -- foi
 * reaproveitado, e não recriado, quando o chefe decidiu que o gerente de
 * qualquer módulo lê o relatório mensal inteiro. Um segundo middleware com a
 * mesma pergunta seria dois lugares para a régua do gerente divergir.
 *
 * Não é `verifyPerfil` porque aquele lê UM módulo por vez, e o RPCMTec é a
 * prestação de contas da Divisão inteira: as 33 subseções falam dos seis
 * módulos numa peça só, e o chefe assina uma. Não é `verifyLogin` porque aquele
 * lê `administrador` do TOKEN, que envelhece até o JWT_EXPIRACAO; aqui o perfil
 * sai do BANCO a cada requisição.
 *
 * ELE NÃO RECORTA A ESCRITA, e não é para recortar: ele responde "é gerente de
 * ALGUM módulo?", que é a pergunta da leitura. Quem pergunta "é gerente DESTE
 * módulo?" na hora de alterar uma subseção é `rpcmtec/verify_modulo_subsecao.js`,
 * encadeado depois deste.
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
