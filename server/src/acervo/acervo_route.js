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
  '/download',
  asyncHandler(async (req, res, next) => {
    const dados = await acervoCtrl.getDownload()

    const msg = 'Informação de download retornadas com sucesso'

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

module.exports = router
