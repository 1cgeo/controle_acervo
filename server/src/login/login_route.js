// Path: login\login_route.js
'use strict'

const express = require('express')

const { schemaValidation, asyncHandler, httpCode } = require('../utils')

const loginCtrl = require('./login_ctrl')
const loginSchema = require('./login_schema')
const verifyLogin = require('./verify_login')

const router = express.Router()

router.post(
  '/',
  schemaValidation({ body: loginSchema.login }),
  asyncHandler(async (req, res, next) => {
    const dados = await loginCtrl.login(
      req.body.usuario,
      req.body.senha,
      req.body.cliente
    )

    return res.sendJsonAndLog(
      true,
      'Usuário autenticado com sucesso',
      httpCode.Created,
      dados
    )
  })
)

// Perfil atual de quem ja tem token, para o client reconferir a foto que
// guardou no login. So exige token valido (verifyLogin), e nao perfil em modulo
// nenhum: quem perdeu todo o acesso tambem precisa da resposta para a tela
// parar de oferecer o que nao pode mais.
router.get(
  '/sessao',
  verifyLogin,
  asyncHandler(async (req, res, next) => {
    const dados = await loginCtrl.sessao(req.usuarioUuid)

    return res.sendJsonAndLog(
      true,
      'Sessão retornada com sucesso',
      httpCode.OK,
      dados
    )
  })
)

module.exports = router
