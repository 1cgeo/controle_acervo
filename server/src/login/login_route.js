// Path: login\login_route.js
'use strict'

const express = require('express')

const { schemaValidation, asyncHandler, httpCode } = require('../utils')

const loginCtrl = require('./login_ctrl')
const loginSchema = require('./login_schema')

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

module.exports = router
