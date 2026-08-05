'use strict'

const express = require('express')

const { asyncHandler, httpCode, schemaValidation } = require('../utils')

const { verifyAdmin } = require('../login')

const acessosCtrl = require('./acessos_ctrl')

const acessosSchema = require('./acessos_schema')

const router = express.Router()

// Historico de acesso: quem entrou, quando e por qual cliente.
//
// A GUARDA E `verifyAdmin` EM TODAS AS ROTAS, e nao `verifyPerfil`. Isto e rota
// de PLATAFORMA, como `/usuarios` e `/rpcmtec`: quem entrou no sistema nao e
// dado do acervo, nem da mapoteca, nem do orcamento, e nao existe "perfil de
// acessos" porque nao existe modulo de acessos. Pedir `verifyPerfil('gerente',
// 'acervo')` aqui entregaria a movimentacao de todo mundo a quem gerencia
// carta, e deixaria de fora o administrador que nao tem linha em modulo nenhum
// (`administrador` e global e dispensa `dgeo.usuario_perfil`).

router.get(
  '/logados',
  verifyAdmin,
  asyncHandler(async (req, res, next) => {
    const dados = await acessosCtrl.logados()

    return res.sendJsonAndLog(
      true,
      'Usuários logados hoje retornados com sucesso',
      httpCode.OK,
      dados
    )
  })
)

router.get(
  '/resumo',
  verifyAdmin,
  asyncHandler(async (req, res, next) => {
    const dados = await acessosCtrl.resumo()

    return res.sendJsonAndLog(
      true,
      'Resumo de acessos retornado com sucesso',
      httpCode.OK,
      dados
    )
  })
)

router.get(
  '/logins/dia',
  verifyAdmin,
  schemaValidation({ query: acessosSchema.loginsDiaQuery }),
  asyncHandler(async (req, res, next) => {
    const dados = await acessosCtrl.loginsDia(req.query.total)

    return res.sendJsonAndLog(
      true,
      'Logins por dia retornados com sucesso',
      httpCode.OK,
      dados
    )
  })
)

router.get(
  '/logins/usuarios',
  verifyAdmin,
  schemaValidation({ query: acessosSchema.loginsUsuariosQuery }),
  asyncHandler(async (req, res, next) => {
    const dados = await acessosCtrl.loginsUsuarios(req.query.total, req.query.max)

    return res.sendJsonAndLog(
      true,
      'Logins por usuário retornados com sucesso',
      httpCode.OK,
      dados
    )
  })
)

module.exports = router
