'use strict'

const express = require('express')

const { schemaValidation, asyncHandler, httpCode } = require('../utils')

const { verifyPerfil } = require('../../login')

const notaCreditoCtrl = require('./nota_credito_ctrl')

const notaCreditoSchema = require('./nota_credito_schema')

const router = express.Router()

router.get(
  '/',
  verifyPerfil('consulta', 'orcamento'),
  schemaValidation({ query: notaCreditoSchema.listarQuery }),
  asyncHandler(async (req, res, next) => {
    const dados = await notaCreditoCtrl.listar({
      ano: req.query.ano,
      classificacao_id: req.query.classificacao_id
    })

    const msg = 'Notas de credito retornadas com sucesso'

    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.get(
  '/:id',
  verifyPerfil('consulta', 'orcamento'),
  schemaValidation({ params: notaCreditoSchema.idParams }),
  asyncHandler(async (req, res, next) => {
    const dados = await notaCreditoCtrl.getPorId(req.params.id)

    const msg = 'Nota de credito retornada com sucesso'

    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.post(
  '/',
  verifyPerfil('operador', 'orcamento'),
  schemaValidation({ body: notaCreditoSchema.criar }),
  asyncHandler(async (req, res, next) => {
    const dados = await notaCreditoCtrl.criar(req.body, req.usuarioUuid)

    const msg = 'Nota de credito criada com sucesso'

    return res.sendJsonAndLog(true, msg, httpCode.Created, dados)
  })
)

router.put(
  '/:id',
  verifyPerfil('operador', 'orcamento'),
  schemaValidation({
    body: notaCreditoSchema.atualizar,
    params: notaCreditoSchema.idParams
  }),
  asyncHandler(async (req, res, next) => {
    await notaCreditoCtrl.atualizar(req.params.id, req.body, req.usuarioUuid)

    const msg = 'Nota de credito atualizada com sucesso'

    return res.sendJsonAndLog(true, msg, httpCode.OK)
  })
)

router.delete(
  '/:id',
  verifyPerfil('gerente', 'orcamento'),
  schemaValidation({ params: notaCreditoSchema.idParams }),
  asyncHandler(async (req, res, next) => {
    await notaCreditoCtrl.deletar(req.params.id)

    const msg = 'Nota de credito excluida com sucesso'

    return res.sendJsonAndLog(true, msg, httpCode.OK)
  })
)

module.exports = router
