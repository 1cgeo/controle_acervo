'use strict'

const express = require('express')

const { schemaValidation, asyncHandler, httpCode } = require('../utils')

const { verifyAdmin } = require('../login')

const tipoProdutoCtrl = require('./produto_ctrl')
const tipoProdutoSchema = require('./produto_schema')

const router = express.Router()

router.put(
  '/:id',
  schemaValidation({
    body: tipoProdutoSchema.produto,
    params: tipoProdutoSchema.idParams
  }),
  verifyAdmin,
  asyncHandler(async (req, res, next) => {
    await tipoProdutoCtrl.updateTipoProduto(
      req.params.id,
      req.body.nome
    )

    const msg = 'Tipo de produto atualizado com sucesso'

    return res.sendJsonAndLog(true, msg, httpCode.OK)
  })
)

router.delete(
  '/:id',
  schemaValidation({
    params: tipoProdutoSchema.idParams
  }),
  verifyAdmin,
  asyncHandler(async (req, res, next) => {
    await tipoProdutoCtrl.deletaTipoProduto(req.params.id)

    const msg = 'Tipo de produto deletado com sucesso'

    return res.sendJsonAndLog(true, msg, httpCode.OK)
  })
)

router.get(
  '/',
  verifyAdmin,
  asyncHandler(async (req, res, next) => {
    const dados = await tipoProdutoCtrl.getTiposProduto()

    const msg = 'Tipos de produto retornados com sucesso'

    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.post(
  '/',
  verifyAdmin,
  schemaValidation({ body: tipoProdutoSchema.produto }),
  asyncHandler(async (req, res, next) => {
    await tipoProdutoCtrl.criaTipoProduto(
      req.body.nome
    )
    const msg = 'Tipo de produto adicionado com sucesso'

    return res.sendJsonAndLog(true, msg, httpCode.Created)
  })
)

module.exports = router
