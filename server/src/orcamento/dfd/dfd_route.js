'use strict'

const express = require('express')

const { schemaValidation, asyncHandler, httpCode } = require('../utils')

const { verifyPerfil } = require('../../login')

const dfdCtrl = require('./dfd_ctrl')

const dfdSchema = require('./dfd_schema')

const router = express.Router()

router.get(
  '/',
  verifyPerfil('consulta', 'orcamento'),
  schemaValidation({ query: dfdSchema.listarQuery }),
  asyncHandler(async (req, res, next) => {
    const dados = await dfdCtrl.listar(req.query.ano)

    return res.sendJsonAndLog(true, 'DFDs retornados com sucesso', httpCode.OK, dados)
  })
)

router.get(
  '/:id',
  verifyPerfil('consulta', 'orcamento'),
  schemaValidation({ params: dfdSchema.idParams }),
  asyncHandler(async (req, res, next) => {
    const dados = await dfdCtrl.getPorId(req.params.id)

    return res.sendJsonAndLog(true, 'DFD retornado com sucesso', httpCode.OK, dados)
  })
)

router.post(
  '/',
  verifyPerfil('operador', 'orcamento'),
  schemaValidation({ body: dfdSchema.criar }),
  asyncHandler(async (req, res, next) => {
    const dados = await dfdCtrl.criar(req.body, req.usuarioUuid)

    return res.sendJsonAndLog(true, 'DFD criado com sucesso', httpCode.Created, dados)
  })
)

router.put(
  '/:id',
  verifyPerfil('operador', 'orcamento'),
  schemaValidation({ params: dfdSchema.idParams, body: dfdSchema.atualizar }),
  asyncHandler(async (req, res, next) => {
    const dados = await dfdCtrl.atualizar(req.params.id, req.body, req.usuarioUuid)

    return res.sendJsonAndLog(true, 'DFD atualizado com sucesso', httpCode.OK, dados)
  })
)

router.delete(
  '/:id',
  verifyPerfil('gerente', 'orcamento'),
  schemaValidation({ params: dfdSchema.idParams }),
  asyncHandler(async (req, res, next) => {
    await dfdCtrl.deletar(req.params.id)

    return res.sendJsonAndLog(true, 'DFD excluído com sucesso', httpCode.OK)
  })
)

module.exports = router
