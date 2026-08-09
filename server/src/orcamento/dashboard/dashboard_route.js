'use strict'

// Painel do orçamento. Perfil de CONSULTA no módulo orçamento, e não
// administrador: é a tela de acompanhamento de quem trabalha com o crédito.
// Foi o motivo de esta consulta não ter ido junto com o RPCMTec para
// /api/rpcmtec, cuja leitura é `verifyGerente` (era `verifyAdmin` até
// 2026-08-08). Ver orcamento/dashboard/dashboard_ctrl.js.

const express = require('express')

const { schemaValidation, asyncHandler, httpCode } = require('../utils')
const { verifyPerfil } = require('../../login')

const dashboardCtrl = require('./dashboard_ctrl')
const dashboardSchema = require('./dashboard_schema')

const router = express.Router()

router.get(
  '/execucao_nd',
  verifyPerfil('consulta', 'orcamento'),
  schemaValidation({ query: dashboardSchema.execucaoNdQuery }),
  asyncHandler(async (req, res, next) => {
    const dados = await dashboardCtrl.getExecucaoPorNd({
      ano: req.query.ano,
      mes: req.query.mes
    })

    return res.sendJsonAndLog(
      true, 'Execução por ND retornada com sucesso', httpCode.OK, dados
    )
  })
)

module.exports = router
