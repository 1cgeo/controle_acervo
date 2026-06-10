// Path: mapoteca\dashboard_route.js
'use strict'

const express = require('express')

const { asyncHandler, httpCode, schemaValidation, csvExport } = require('../utils')

const { verifyLogin } = require('../login')

const dashboardCtrl = require('./dashboard_ctrl')
const mapotecaSchema = require('./mapoteca_schema')

const router = express.Router()

// Order Status Distribution
router.get(
  '/order_status',
  verifyLogin,
  asyncHandler(async (req, res, next) => {
    const dados = await dashboardCtrl.getOrderStatusDistribution()
    const msg = 'Distribuição de status de pedidos retornada com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

// Orders Timeline
router.get(
  '/orders_timeline',
  verifyLogin,
  schemaValidation({
    query: mapotecaSchema.mesesQuery
  }),
  asyncHandler(async (req, res, next) => {
    const meses = req.query.meses || 6
    const dados = await dashboardCtrl.getOrdersTimeline(meses)
    const msg = 'Timeline de pedidos retornada com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

// Average Fulfillment Time
router.get(
  '/avg_fulfillment_time',
  verifyLogin,
  asyncHandler(async (req, res, next) => {
    const dados = await dashboardCtrl.getAverageFulfillmentTime()
    const msg = 'Tempo médio de atendimento retornado com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

// Client Activity
router.get(
  '/client_activity',
  verifyLogin,
  schemaValidation({
    query: mapotecaSchema.limiteQuery
  }),
  asyncHandler(async (req, res, next) => {
    const limite = req.query.limite || 10
    const dados = await dashboardCtrl.getClientActivity(limite)
    const msg = 'Atividade de clientes retornada com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

// Pending Orders
router.get(
  '/pending_orders',
  verifyLogin,
  asyncHandler(async (req, res, next) => {
    const dados = await dashboardCtrl.getPendingOrders()
    const msg = 'Pedidos pendentes retornados com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

// Stock by Location
router.get(
  '/stock_by_location',
  verifyLogin,
  asyncHandler(async (req, res, next) => {
    const dados = await dashboardCtrl.getStockByLocation()
    const msg = 'Estoque por localização retornado com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

// Material Consumption Trends
router.get(
  '/material_consumption',
  verifyLogin,
  schemaValidation({
    query: mapotecaSchema.mesesQuery
  }),
  asyncHandler(async (req, res, next) => {
    const meses = req.query.meses || 12
    const dados = await dashboardCtrl.getMaterialConsumptionTrends(meses)
    const msg = 'Tendências de consumo de material retornadas com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

// Plotter Status
router.get(
  '/plotter_status',
  verifyLogin,
  asyncHandler(async (req, res, next) => {
    const dados = await dashboardCtrl.getPlotterStatus()
    const msg = 'Status de plotters retornado com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

// Entregas por tipo de produto × escala no ano
router.get(
  '/entregas_por_tipo_produto',
  verifyLogin,
  schemaValidation({
    query: mapotecaSchema.relatorioQuery
  }),
  asyncHandler(async (req, res, next) => {
    const { ano, formato } = req.query
    const dados = await dashboardCtrl.getEntregasPorTipoProduto(ano)
    const msg = 'Entregas por tipo de produto retornadas com sucesso'
    return csvExport.sendReport(res, formato, msg, dados, {
      filename: `entregas_por_tipo_produto_${ano}.csv`,
      columns: dashboardCtrl.COLUNAS_ENTREGAS_TIPO_PRODUTO
    })
  })
)

// Entregas por tipo de mídia no ano
router.get(
  '/entregas_por_midia',
  verifyLogin,
  schemaValidation({
    query: mapotecaSchema.relatorioQuery
  }),
  asyncHandler(async (req, res, next) => {
    const { ano, formato } = req.query
    const dados = await dashboardCtrl.getEntregasPorMidia(ano)
    const msg = 'Entregas por tipo de mídia retornadas com sucesso'
    return csvExport.sendReport(res, formato, msg, dados, {
      filename: `entregas_por_midia_${ano}.csv`,
      columns: dashboardCtrl.COLUNAS_ENTREGAS_MIDIA
    })
  })
)

// Operações apoiadas no ano
router.get(
  '/operacoes_apoiadas',
  verifyLogin,
  schemaValidation({
    query: mapotecaSchema.relatorioQuery
  }),
  asyncHandler(async (req, res, next) => {
    const { ano, formato } = req.query
    const dados = await dashboardCtrl.getOperacoesApoiadas(ano)
    const msg = 'Operações apoiadas retornadas com sucesso'
    return csvExport.sendReport(res, formato, msg, dados, {
      filename: `operacoes_apoiadas_${ano}.csv`,
      columns: dashboardCtrl.COLUNAS_OPERACOES
    })
  })
)

// Resumo anual (totais de pedidos, entregas, OMs, operações e custo de manutenção)
router.get(
  '/resumo_anual',
  verifyLogin,
  schemaValidation({
    query: mapotecaSchema.anoQuery
  }),
  asyncHandler(async (req, res, next) => {
    const dados = await dashboardCtrl.getResumoAnual(req.query.ano)
    const msg = 'Resumo anual retornado com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

// Entregas por mês (tabela-resumo mensal Carta Topo × Carta Orto × Outros)
router.get(
  '/entregas_por_mes',
  verifyLogin,
  schemaValidation({
    query: mapotecaSchema.relatorioQuery
  }),
  asyncHandler(async (req, res, next) => {
    const { ano, formato } = req.query
    const dados = await dashboardCtrl.getEntregasPorMes(ano)
    const msg = 'Entregas por mês retornadas com sucesso'
    return csvExport.sendReport(res, formato, msg, dados, {
      filename: `entregas_por_mes_${ano}.csv`,
      columns: dashboardCtrl.COLUNAS_ENTREGAS_MES
    })
  })
)

module.exports = router