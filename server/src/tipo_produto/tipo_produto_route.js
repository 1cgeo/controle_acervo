'use strict'

const express = require('express')

const { schemaValidation, asyncHandler, httpCode } = require('../utils')

const { verifyAdmin } = require('../login')

const tipoProdutoCtrl = require('./tipo_produto_ctrl')
const tipoProdutoSchema = require('./tipo_produto_schema')

const router = express.Router()

router.get(
  '/tipo_produto',
  verifyAdmin,
  asyncHandler(async (req, res, next) => {
    const dados = await tipoProdutoCtrl.getTipoProduto()

    const msg = 'Tipo Produto retornada com sucesso'

    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.delete(
  '/tipo_produto',
  verifyAdmin,
  schemaValidation({
    body: tipoProdutoSchema.tipoProdutoIds
  }),
  asyncHandler(async (req, res, next) => {
    await tipoProdutoCtrl.deleteTipoProduto(req.body.tipo_produto_ids)

    const msg = 'Entradas do Tipo Produto deletadas com sucesso'

    return res.sendJsonAndLog(true, msg, httpCode.OK)
  })
)

router.post(
  '/tipo_produto',
  verifyAdmin,
  schemaValidation({
    body: tipoProdutoSchema.tipoProduto
  }),
  asyncHandler(async (req, res, next) => {
    await tipoProdutoCtrl.criaTipoProduto(req.body.tipo_produto)

    const msg = 'Entradas do Tipo Produto criadas com sucesso'

    return res.sendJsonAndLog(true, msg, httpCode.Created)
  })
)

router.put(
  '/tipo_produto',
  verifyAdmin,
  schemaValidation({
    body: tipoProdutoSchema.tipoProdutoAtualizacao
  }),
  asyncHandler(async (req, res, next) => {
    await tipoProdutoCtrl.atualizaTipoProduto(req.body.tipo_produto)

    const msg = 'Entradas do Tipo Produto atualizadas com sucesso'

    return res.sendJsonAndLog(true, msg, httpCode.OK)
  })
)

module.exports = router
