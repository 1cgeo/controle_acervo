'use strict'

const express = require('express')

const { schemaValidation, asyncHandler, httpCode } = require('../utils')

const { verifyAdmin, verifyPerfil } = require('../../login')

const configuracaoCtrl = require('./configuracao_ctrl')
const configuracaoSchema = require('./configuracao_schema')

const router = express.Router()

// Anos distintos com dado (para o seletor de ano). Antes de '/' nao importa,
// mas mantemos explicito por clareza.
router.get(
  '/anos',
  verifyPerfil('consulta', 'orcamento'),
  asyncHandler(async (req, res, next) => {
    const dados = await configuracaoCtrl.getAnos()
    return res.sendJsonAndLog(true, 'Anos retornados com sucesso', httpCode.OK, dados)
  })
)

router.get(
  '/',
  verifyPerfil('consulta', 'orcamento'),
  asyncHandler(async (req, res, next) => {
    const dados = await configuracaoCtrl.get()
    return res.sendJsonAndLog(true, 'Configuração retornada com sucesso', httpCode.OK, dados)
  })
)

router.put(
  '/',
  verifyAdmin,
  schemaValidation({ body: configuracaoSchema.atualizar }),
  asyncHandler(async (req, res, next) => {
    const dados = await configuracaoCtrl.atualizar(req.body, req.usuarioUuid)
    return res.sendJsonAndLog(true, 'Configuração atualizada com sucesso', httpCode.OK, dados)
  })
)

module.exports = router
