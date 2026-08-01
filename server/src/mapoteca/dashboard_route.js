'use strict'

const express = require('express')

const { asyncHandler, httpCode, schemaValidation, csvExport } = require('../utils')

const { verifyPerfil } = require('../login')

const dashboardCtrl = require('./dashboard_ctrl')
const mapotecaSchema = require('./mapoteca_schema')

const router = express.Router()

// As métricas de PEDIDO (situação, entrada mensal, tempo de atendimento e Top
// de clientes) são do ANO consultado, pela data do pedido. É um recorte
// diferente do Resumo Anual e do Mapa, que são por data de ENTREGA; ver
// FILTRO_ANO_PEDIDO em dashboard_ctrl.js.
//
// Order Status Distribution
router.get(
  '/order_status',
  verifyPerfil('consulta', 'mapoteca'),
  schemaValidation({
    query: mapotecaSchema.anoQuery
  }),
  asyncHandler(async (req, res, next) => {
    const dados = await dashboardCtrl.getOrderStatusDistribution(req.query.ano)
    const msg = 'Distribuição de status de pedidos retornada com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

// Orders Timeline
router.get(
  '/orders_timeline',
  verifyPerfil('consulta', 'mapoteca'),
  schemaValidation({
    query: mapotecaSchema.anoQuery
  }),
  asyncHandler(async (req, res, next) => {
    const dados = await dashboardCtrl.getOrdersTimeline(req.query.ano)
    const msg = 'Timeline de pedidos retornada com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

// Average Fulfillment Time
router.get(
  '/avg_fulfillment_time',
  verifyPerfil('consulta', 'mapoteca'),
  schemaValidation({
    query: mapotecaSchema.anoQuery
  }),
  asyncHandler(async (req, res, next) => {
    const dados = await dashboardCtrl.getAverageFulfillmentTime(req.query.ano)
    const msg = 'Tempo médio de atendimento retornado com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

// Client Activity
router.get(
  '/client_activity',
  verifyPerfil('consulta', 'mapoteca'),
  schemaValidation({
    query: mapotecaSchema.limiteAnoQuery
  }),
  asyncHandler(async (req, res, next) => {
    const limite = req.query.limite || 10
    const dados = await dashboardCtrl.getClientActivity(limite, req.query.ano)
    const msg = 'Atividade de clientes retornada com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

// Pending Orders
router.get(
  '/pending_orders',
  verifyPerfil('consulta', 'mapoteca'),
  asyncHandler(async (req, res, next) => {
    const dados = await dashboardCtrl.getPendingOrders()
    const msg = 'Pedidos pendentes retornados com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

// Stock by Location
//
// SEM ano, e de propósito: estoque é o saldo de HOJE, não um acumulado de
// período. "Estoque de 2025" não existe, e aceitar o parâmetro sugeriria que
// sim. A tela avisa que este painel é o único da aba que ignora o ano.
router.get(
  '/stock_by_location',
  verifyPerfil('consulta', 'mapoteca'),
  asyncHandler(async (req, res, next) => {
    const dados = await dashboardCtrl.getStockByLocation()
    const msg = 'Estoque por localização retornado com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

// Material Consumption Trends
router.get(
  '/material_consumption',
  verifyPerfil('consulta', 'mapoteca'),
  schemaValidation({
    query: mapotecaSchema.anoQuery
  }),
  asyncHandler(async (req, res, next) => {
    const dados = await dashboardCtrl.getMaterialConsumptionTrends(req.query.ano)
    const msg = 'Tendências de consumo de material retornadas com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

// Plotter Status
router.get(
  '/plotter_status',
  verifyPerfil('consulta', 'mapoteca'),
  asyncHandler(async (req, res, next) => {
    const dados = await dashboardCtrl.getPlotterStatus()
    const msg = 'Status de plotters retornado com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

// Entregas por tipo de produto × escala no ano
router.get(
  '/entregas_por_tipo_produto',
  verifyPerfil('consulta', 'mapoteca'),
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
  verifyPerfil('consulta', 'mapoteca'),
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
  verifyPerfil('consulta', 'mapoteca'),
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
  verifyPerfil('consulta', 'mapoteca'),
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
  verifyPerfil('consulta', 'mapoteca'),
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

// Entregas do ano com geometria (mapa do dashboard), com filtros opcionais de
// tipo de produto, escala e cliente
router.get(
  '/entregas_geo',
  verifyPerfil('consulta', 'mapoteca'),
  schemaValidation({
    query: mapotecaSchema.entregasGeoQuery
  }),
  asyncHandler(async (req, res, next) => {
    const { ano, ...filtros } = req.query
    const dados = await dashboardCtrl.getEntregasGeo(ano, filtros)
    const msg = 'Entregas com geometria retornadas com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

// Opções dos filtros do mapa, com o quantitativo de cada uma já cruzado pelos
// outros filtros ativos
router.get(
  '/entregas_filtros',
  verifyPerfil('consulta', 'mapoteca'),
  schemaValidation({
    query: mapotecaSchema.entregasGeoQuery
  }),
  asyncHandler(async (req, res, next) => {
    const { ano, ...filtros } = req.query
    const dados = await dashboardCtrl.getEntregasFiltros(ano, filtros)
    const msg = 'Opções de filtro do mapa retornadas com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

// Anos com dado na mapoteca (alimenta o seletor de ano da navbar)
router.get(
  '/anos',
  verifyPerfil('consulta', 'mapoteca'),
  asyncHandler(async (req, res, next) => {
    const dados = await dashboardCtrl.getAnosComDados()
    const msg = 'Anos com dado retornados com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

module.exports = router