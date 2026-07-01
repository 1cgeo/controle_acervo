// Path: relatorio\relatorio_route.js
'use strict'

// Export DOCX do RPCMTec (seção acervo). Rota admin-only (é relatório de
// chefe), mesmo padrão do SCO para a Seção 3: download binário direto, fora
// do envelope JSON de sendJsonAndLog.

const express = require('express')

const { schemaValidation, asyncHandler, httpCode } = require('../utils')
const { verifyAdmin } = require('../login')

const relatorioCtrl = require('./relatorio_ctrl')
const relatorioSchema = require('./relatorio_schema')

const router = express.Router()

// Preview em tela: mesmos dados do DOCX, no envelope JSON padrão.
router.get(
  '/rpcmtec',
  verifyAdmin,
  schemaValidation({ query: relatorioSchema.rpcmtecQuery }),
  asyncHandler(async (req, res, next) => {
    const dados = await relatorioCtrl.gerarRelatorioAcervo(req.query)
    const msg = 'RPCMTec (seção acervo) gerado com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.get(
  '/rpcmtec/docx',
  verifyAdmin,
  schemaValidation({ query: relatorioSchema.rpcmtecQuery }),
  asyncHandler(async (req, res, next) => {
    const { ano, mes } = req.query
    const buffer = await relatorioCtrl.gerarRelatorioAcervoDocx({ ano, mes })
    const nome = `RPCMTec-acervo-${ano}-${String(mes).padStart(2, '0')}.docx`
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    res.setHeader('Content-Disposition', `attachment; filename="${nome}"`)
    return res.send(buffer)
  })
)

module.exports = router
