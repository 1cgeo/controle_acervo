'use strict'

const { AppError, asyncHandler, httpCode } = require('../utils')

const { db } = require('../database')

const validateToken = require('./validate_token')
const { montarContexto } = require('./contexto')

/**
 * Passa quem TEM ACESSO AO SISTEMA: o administrador global e quem tem qualquer
 * perfil em qualquer módulo. Fora fica só a conta recém-criada, ainda sem
 * concessão nenhuma.
 *
 * Existe porque "estar logado" e "ter acesso" deixaram de ser a mesma coisa. A
 * conta criada pelo administrador nasce SEM linha em `dgeo.usuario_perfil`, e
 * até a concessão ela não é ninguém no sistema: o que ela pode é ver o próprio
 * cadastro, trocar a própria senha e pedir acesso. Com `verifyLogin`, o PIT do
 * ano -- que é o plano de trabalho da Divisão inteira -- respondia a essa conta
 * no primeiro segundo de vida dela.
 *
 * Irmão de `verify_gerente.js`, com o piso no chão em vez de no gerente: os dois
 * perguntam do BANCO, e não do token, para conceder e revogar valerem na hora.
 *
 * NÃO substitui `verifyLogin` em `/usuarios/perfil` nem em `/login/perfil`:
 * aquelas são justamente as rotas que a pessoa sem acesso precisa alcançar, e
 * trocar a guarda ali a trancaria do lado de fora da própria conta.
 */
const verifyAcesso = asyncHandler(async (req, res, next) => {
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

  const { temAcesso } = await db.conn.one(
    `SELECT EXISTS (
       SELECT 1 FROM dgeo.usuario_perfil WHERE usuario_id = $<usuarioId>
     ) AS "temAcesso"`,
    { usuarioId: usuario.id }
  )

  if (!temAcesso) {
    throw new AppError(
      'Usuário sem acesso a nenhum módulo. Peça ao administrador do sistema o acesso ao módulo de interesse.',
      httpCode.Forbidden
    )
  }

  return next()
})

module.exports = verifyAcesso
