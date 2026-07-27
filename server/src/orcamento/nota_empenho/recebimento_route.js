// Path: orcamento\nota_empenho\recebimento_route.js
'use strict'

const express = require('express')

const { schemaValidation, asyncHandler, httpCode } = require('../utils')

const { verifyPerfil } = require('../../login')

const recebimentoCtrl = require('./recebimento_ctrl')

const recebimentoSchema = require('./recebimento_schema')

const router = express.Router()

router.get(
  '/',
  verifyPerfil('consulta', 'orcamento'),
  schemaValidation({ query: recebimentoSchema.listarQuery }),
  asyncHandler(async (req, res, next) => {
    const dados = await recebimentoCtrl.listar({
      nota_empenho_id: req.query.nota_empenho_id
    })

    const msg = 'Recebimentos de material retornados com sucesso'

    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.get(
  '/:id',
  verifyPerfil('consulta', 'orcamento'),
  schemaValidation({ params: recebimentoSchema.idParams }),
  asyncHandler(async (req, res, next) => {
    const dados = await recebimentoCtrl.getPorId(req.params.id)

    const msg = 'Recebimento de material retornado com sucesso'

    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.post(
  '/',
  verifyPerfil('operador', 'orcamento'),
  schemaValidation({ body: recebimentoSchema.criar }),
  asyncHandler(async (req, res, next) => {
    const dados = await recebimentoCtrl.criar(req.body, req.usuarioUuid)

    const msg = 'Recebimento de material criado com sucesso'

    return res.sendJsonAndLog(true, msg, httpCode.Created, dados)
  })
)

router.put(
  '/:id',
  verifyPerfil('operador', 'orcamento'),
  schemaValidation({
    body: recebimentoSchema.atualizar,
    params: recebimentoSchema.idParams
  }),
  asyncHandler(async (req, res, next) => {
    await recebimentoCtrl.atualizar(req.params.id, req.body, req.usuarioUuid)

    const msg = 'Recebimento de material atualizado com sucesso'

    return res.sendJsonAndLog(true, msg, httpCode.OK)
  })
)

router.delete(
  '/:id',
  verifyPerfil('gerente', 'orcamento'),
  schemaValidation({ params: recebimentoSchema.idParams }),
  asyncHandler(async (req, res, next) => {
    await recebimentoCtrl.deletar(req.params.id)

    const msg = 'Recebimento de material excluido com sucesso'

    return res.sendJsonAndLog(true, msg, httpCode.OK)
  })
)

module.exports = router
