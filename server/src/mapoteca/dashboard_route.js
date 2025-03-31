// Path: mapoteca\dashboard_route.js
'use strict'

const express = require('express')

const { asyncHandler, httpCode } = require('../utils')

const { verifyLogin } = require('../login')

const dashboardCtrl = require('./dashboard_ctrl')

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
  asyncHandler(async (req, res, next) => {
    const meses = req.query.meses ? parseInt(req.query.meses) : 6
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
  asyncHandler(async (req, res, next) => {
    const limite = req.query.limite ? parseInt(req.query.limite) : 10
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
  asyncHandler(async (req, res, next) => {
    const meses = req.query.meses ? parseInt(req.query.meses) : 12
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

module.exports = router