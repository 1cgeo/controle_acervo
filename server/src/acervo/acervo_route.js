'use strict'

const express = require('express')

const { schemaValidation, asyncHandler, httpCode } = require('../utils')

const { verifyLogin, verifyAdmin } = require('../login')

const acervoCtrl = require('./acervo_ctrl')
const acervoSchema = require('./acervo_schema')

const router = express.Router()

router.get(
  '/estilo',
  asyncHandler(async (req, res, next) => {
    const dados = await acervoCtrl.getEstilo()

    const msg = 'Estilo retornado com sucesso'

    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.get(
  '/arquivos',
  verifyAdmin,
  schemaValidation({ query: acervoSchema.paginacaoQuery }),
  asyncHandler(async (req, res, next) => {
    const dados = await acervoCtrl.getArquivosPagination(
      req.query.pagina,
      req.query.total_pagina,
      req.query.coluna_ordem,
      req.query.direcao_ordem,
      req.query.filtro
    )

    const msg = 'Lista de execuções retornadas'

    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.post(
  '/path_download',
  verifyLogin,
  schemaValidation({ body: acervoSchema.arquivosIds }),
  asyncHandler(async (req, res, next) => {
    const dados = await acervoCtrl.getPathDownload(req.body.arquivos_id)

    const msg = 'Paths para download retornados com sucesso'

    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.post(
  '/download',
  verifyLogin,
  schemaValidation({ body: acervoSchema.produtosIds }),
  asyncHandler(async (req, res, next) => {
    const dados = await acervoCtrl.downloadInfo(
      req.body.produtos_id,
      req.usuarioUuid
    )

    const msg = 'Informação de download cadastrada com sucesso'

    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.get(
  '/:produto_id/:z/:x/:y.mvt',
  schemaValidation({
    params: acervoSchema.mvtParams
  }),
  asyncHandler(async (req, res, next) => {
    const tile = await acervoCtrl.getMvtProduto(
      req.params.produto_id,
      req.params.x,
      req.params.y,
      req.params.z
    )

    res.setHeader('Content-Type', 'application/x-protobuf')
    if (tile.length === 0) {
      res.status(204)
    }
    res.send(tile)
  })
)

module.exports = router
