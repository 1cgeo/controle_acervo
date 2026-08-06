'use strict'

const express = require('express')

const { asyncHandler, httpCode } = require('../utils')

const { verifyPerfil } = require('../../login')

const configuracaoCtrl = require('./configuracao_ctrl')

const router = express.Router()

// Anos distintos com dado, para o seletor de ano de TODAS as telas do modulo.
//
// E A UNICA ROTA QUE SOBROU aqui. O `GET /` e o `PUT /` saiam da tabela
// `orcamento.configuracao`, podada em 2026-08-06: ela guardava `uasg` e `codom`,
// preenchidas e sem leitor. Esta le o `ano` das tabelas de negocio, e por isso
// nao dependia daquela tabela.
router.get(
  '/anos',
  verifyPerfil('consulta', 'orcamento'),
  asyncHandler(async (req, res, next) => {
    const dados = await configuracaoCtrl.getAnos()
    return res.sendJsonAndLog(true, 'Anos retornados com sucesso', httpCode.OK, dados)
  })
)

module.exports = router
