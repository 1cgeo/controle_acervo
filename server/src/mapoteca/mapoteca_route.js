// Path: mapoteca\mapoteca_route.js
'use strict'

const express = require('express')

const { schemaValidation, asyncHandler, httpCode } = require('../utils')

const { verifyLogin, verifyAdmin } = require('../login')

const mapotecaCtrl = require('./mapoteca_ctrl')
const mapotecaSchema = require('./mapoteca_schema')

const router = express.Router()

// Rotas para Domínios
router.get(
  '/dominio/tipo_cliente',
  asyncHandler(async (req, res, next) => {
    const dados = await mapotecaCtrl.getTipoCliente()
    const msg = 'Tipos de cliente retornados com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.get(
  '/dominio/situacao_pedido',
  asyncHandler(async (req, res, next) => {
    const dados = await mapotecaCtrl.getSituacaoPedido()
    const msg = 'Situações de pedido retornadas com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.get(
  '/dominio/tipo_midia',
  asyncHandler(async (req, res, next) => {
    const dados = await mapotecaCtrl.getTipoMidia()
    const msg = 'Tipos de mídia retornados com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.get(
  '/dominio/tipo_localizacao',
  asyncHandler(async (req, res, next) => {
    const dados = await mapotecaCtrl.getTipoLocalizacao()
    const msg = 'Tipos de localização retornados com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

// Rotas para Cliente
router.get(
  '/cliente',
  verifyLogin,
  asyncHandler(async (req, res, next) => {
    const dados = await mapotecaCtrl.getClientes()
    const msg = 'Clientes retornados com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.get(
  '/cliente/:id',
  verifyLogin,
  schemaValidation({
    params: mapotecaSchema.clienteId
  }),
  asyncHandler(async (req, res, next) => {
    const { id } = req.params
    const dados = await mapotecaCtrl.getClienteById(id)
    const msg = 'Detalhes do cliente retornados com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.post(
  '/cliente',
  verifyAdmin,
  schemaValidation({
    body: mapotecaSchema.cliente
  }),
  asyncHandler(async (req, res, next) => {
    await mapotecaCtrl.criaCliente(req.body, req.usuarioUuid)
    const msg = 'Cliente criado com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.Created)
  })
)

router.put(
  '/cliente',
  verifyAdmin,
  schemaValidation({
    body: mapotecaSchema.clienteAtualizacao
  }),
  asyncHandler(async (req, res, next) => {
    await mapotecaCtrl.atualizaCliente(req.body, req.usuarioUuid)
    const msg = 'Cliente atualizado com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK)
  })
)

router.delete(
  '/cliente',
  verifyAdmin,
  schemaValidation({
    body: mapotecaSchema.clienteIds
  }),
  asyncHandler(async (req, res, next) => {
    await mapotecaCtrl.deleteClientes(req.body.cliente_ids)
    const msg = 'Clientes deletados com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK)
  })
)

// Rotas para Pedido
router.get(
  '/pedido',
  verifyLogin,
  asyncHandler(async (req, res, next) => {
    const dados = await mapotecaCtrl.getPedidos()
    const msg = 'Pedidos retornados com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.get(
  '/pedido/localizador/:localizador',
  schemaValidation({
    params: mapotecaSchema.pedidoLocalizador
  }),
  asyncHandler(async (req, res, next) => {
    const { localizador } = req.params
    const dados = await mapotecaCtrl.getPedidoByLocalizador(localizador)
    const msg = 'Pedido encontrado com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.get(
  '/pedido/:id',
  verifyLogin,
  schemaValidation({
    params: mapotecaSchema.pedidoId
  }),
  asyncHandler(async (req, res, next) => {
    const { id } = req.params
    const dados = await mapotecaCtrl.getPedidoById(id)
    const msg = 'Detalhes do pedido retornados com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.post(
  '/pedido',
  verifyAdmin,
  schemaValidation({
    body: mapotecaSchema.pedido
  }),
  asyncHandler(async (req, res, next) => {
    const id = await mapotecaCtrl.criaPedido(req.body, req.usuarioUuid)
    const msg = 'Pedido criado com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.Created, { id })
  })
)

router.put(
  '/pedido',
  verifyAdmin,
  schemaValidation({
    body: mapotecaSchema.pedidoAtualizacao
  }),
  asyncHandler(async (req, res, next) => {
    await mapotecaCtrl.atualizaPedido(req.body, req.usuarioUuid)
    const msg = 'Pedido atualizado com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK)
  })
)

router.delete(
  '/pedido',
  verifyAdmin,
  schemaValidation({
    body: mapotecaSchema.pedidoIds
  }),
  asyncHandler(async (req, res, next) => {
    await mapotecaCtrl.deletePedidos(req.body.pedido_ids)
    const msg = 'Pedidos deletados com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK)
  })
)

// Rotas para Produto do Pedido
router.post(
  '/produto_pedido',
  verifyAdmin,
  schemaValidation({
    body: mapotecaSchema.produtoPedido
  }),
  asyncHandler(async (req, res, next) => {
    await mapotecaCtrl.criaProdutoPedido(req.body, req.usuarioUuid)
    const msg = 'Produto adicionado ao pedido com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.Created)
  })
)

router.put(
  '/produto_pedido',
  verifyAdmin,
  schemaValidation({
    body: mapotecaSchema.produtoPedidoAtualizacao
  }),
  asyncHandler(async (req, res, next) => {
    await mapotecaCtrl.atualizaProdutoPedido(req.body, req.usuarioUuid)
    const msg = 'Produto do pedido atualizado com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK)
  })
)

router.delete(
  '/produto_pedido',
  verifyAdmin,
  schemaValidation({
    body: mapotecaSchema.produtoPedidoIds
  }),
  asyncHandler(async (req, res, next) => {
    await mapotecaCtrl.deleteProdutosPedido(req.body.produto_pedido_ids)
    const msg = 'Produtos do pedido deletados com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK)
  })
)

// Rotas para Plotter
router.get(
  '/plotter',
  verifyLogin,
  asyncHandler(async (req, res, next) => {
    const dados = await mapotecaCtrl.getPlotters()
    const msg = 'Plotters retornados com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.get(
  '/plotter/:id',
  verifyLogin,
  schemaValidation({
    params: mapotecaSchema.plotterId
  }),
  asyncHandler(async (req, res, next) => {
    const { id } = req.params
    const dados = await mapotecaCtrl.getPlotterById(id)
    const msg = 'Detalhes do plotter retornados com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.post(
  '/plotter',
  verifyAdmin,
  schemaValidation({
    body: mapotecaSchema.plotter
  }),
  asyncHandler(async (req, res, next) => {
    await mapotecaCtrl.criaPlotter(req.body, req.usuarioUuid)
    const msg = 'Plotter criado com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.Created)
  })
)

router.put(
  '/plotter',
  verifyAdmin,
  schemaValidation({
    body: mapotecaSchema.plotterAtualizacao
  }),
  asyncHandler(async (req, res, next) => {
    await mapotecaCtrl.atualizaPlotter(req.body, req.usuarioUuid)
    const msg = 'Plotter atualizado com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK)
  })
)

router.delete(
  '/plotter',
  verifyAdmin,
  schemaValidation({
    body: mapotecaSchema.plotterIds
  }),
  asyncHandler(async (req, res, next) => {
    await mapotecaCtrl.deletePlotters(req.body.plotter_ids)
    const msg = 'Plotters deletados com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK)
  })
)

// Rotas para Manutenção de Plotter
router.get(
  '/manutencao_plotter',
  verifyLogin,
  asyncHandler(async (req, res, next) => {
    const dados = await mapotecaCtrl.getManutencoesPlotter()
    const msg = 'Manutenções de plotter retornadas com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.post(
  '/manutencao_plotter',
  verifyAdmin,
  schemaValidation({
    body: mapotecaSchema.manutencaoPlotter
  }),
  asyncHandler(async (req, res, next) => {
    await mapotecaCtrl.criaManutencaoPlotter(req.body, req.usuarioUuid)
    const msg = 'Manutenção de plotter registrada com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.Created)
  })
)

router.put(
  '/manutencao_plotter',
  verifyAdmin,
  schemaValidation({
    body: mapotecaSchema.manutencaoPlotterAtualizacao
  }),
  asyncHandler(async (req, res, next) => {
    await mapotecaCtrl.atualizaManutencaoPlotter(req.body, req.usuarioUuid)
    const msg = 'Manutenção de plotter atualizada com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK)
  })
)

router.delete(
  '/manutencao_plotter',
  verifyAdmin,
  schemaValidation({
    body: mapotecaSchema.manutencaoPlotterIds
  }),
  asyncHandler(async (req, res, next) => {
    await mapotecaCtrl.deleteManutencoesPlotter(req.body.manutencao_ids)
    const msg = 'Manutenções de plotter deletadas com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK)
  })
)

// Rotas para Tipo de Material
router.get(
  '/tipo_material',
  verifyLogin,
  asyncHandler(async (req, res, next) => {
    const dados = await mapotecaEstoqueCtrl.getTiposMaterial()
    const msg = 'Tipos de material retornados com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.get(
  '/tipo_material/:id',
  verifyLogin,
  asyncHandler(async (req, res, next) => {
    const { id } = req.params
    const dados = await mapotecaEstoqueCtrl.getTipoMaterialById(id)
    const msg = 'Detalhes do tipo de material retornados com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.post(
  '/tipo_material',
  verifyAdmin,
  schemaValidation({
    body: mapotecaEstoqueSchema.tipoMaterial
  }),
  asyncHandler(async (req, res, next) => {
    const id = await mapotecaEstoqueCtrl.criaTipoMaterial(req.body, req.usuarioUuid)
    const msg = 'Tipo de material criado com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.Created, { id })
  })
)

router.put(
  '/tipo_material',
  verifyAdmin,
  schemaValidation({
    body: mapotecaEstoqueSchema.tipoMaterialAtualizacao
  }),
  asyncHandler(async (req, res, next) => {
    await mapotecaEstoqueCtrl.atualizaTipoMaterial(req.body, req.usuarioUuid)
    const msg = 'Tipo de material atualizado com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK)
  })
)

router.delete(
  '/tipo_material',
  verifyAdmin,
  schemaValidation({
    body: mapotecaEstoqueSchema.tipoMaterialIds
  }),
  asyncHandler(async (req, res, next) => {
    await mapotecaEstoqueCtrl.deleteTiposMaterial(req.body.tipo_material_ids)
    const msg = 'Tipos de material deletados com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK)
  })
)

// Rotas para Estoque de Material
router.get(
  '/estoque_material',
  verifyLogin,
  asyncHandler(async (req, res, next) => {
    const dados = await mapotecaEstoqueCtrl.getEstoqueMaterial()
    const msg = 'Estoque de material retornado com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.get(
  '/estoque_por_localizacao',
  verifyLogin,
  asyncHandler(async (req, res, next) => {
    const dados = await mapotecaEstoqueCtrl.getEstoquePorLocalizacao()
    const msg = 'Estoque por localização retornado com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.post(
  '/estoque_material',
  verifyAdmin,
  schemaValidation({
    body: mapotecaEstoqueSchema.estoqueMaterial
  }),
  asyncHandler(async (req, res, next) => {
    const id = await mapotecaEstoqueCtrl.criaEstoqueMaterial(req.body, req.usuarioUuid)
    const msg = 'Estoque de material criado/atualizado com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.Created, { id })
  })
)

router.put(
  '/estoque_material',
  verifyAdmin,
  schemaValidation({
    body: mapotecaEstoqueSchema.estoqueMaterialAtualizacao
  }),
  asyncHandler(async (req, res, next) => {
    await mapotecaEstoqueCtrl.atualizaEstoqueMaterial(req.body, req.usuarioUuid)
    const msg = 'Estoque de material atualizado com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK)
  })
)

router.delete(
  '/estoque_material',
  verifyAdmin,
  schemaValidation({
    body: mapotecaEstoqueSchema.estoqueMaterialIds
  }),
  asyncHandler(async (req, res, next) => {
    await mapotecaEstoqueCtrl.deleteEstoqueMaterial(req.body.estoque_material_ids)
    const msg = 'Registros de estoque deletados com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK)
  })
)

// Rotas para Consumo de Material
router.get(
  '/consumo_material',
  verifyLogin,
  asyncHandler(async (req, res, next) => {
    const dados = await mapotecaEstoqueCtrl.getConsumoMaterial(req.query)
    const msg = 'Registros de consumo retornados com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.get(
  '/consumo_mensal',
  verifyLogin,
  asyncHandler(async (req, res, next) => {
    const ano = req.query.ano ? parseInt(req.query.ano) : new Date().getFullYear()
    const dados = await mapotecaEstoqueCtrl.getConsumoMensalPorTipo(ano)
    const msg = 'Consumo mensal por tipo de material retornado com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.post(
  '/consumo_material',
  verifyAdmin,
  schemaValidation({
    body: mapotecaEstoqueSchema.consumoMaterial
  }),
  asyncHandler(async (req, res, next) => {
    const id = await mapotecaEstoqueCtrl.criaConsumoMaterial(req.body, req.usuarioUuid)
    const msg = 'Registro de consumo criado com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.Created, { id })
  })
)

router.put(
  '/consumo_material',
  verifyAdmin,
  schemaValidation({
    body: mapotecaEstoqueSchema.consumoMaterialAtualizacao
  }),
  asyncHandler(async (req, res, next) => {
    await mapotecaEstoqueCtrl.atualizaConsumoMaterial(req.body, req.usuarioUuid)
    const msg = 'Registro de consumo atualizado com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK)
  })
)

router.delete(
  '/consumo_material',
  verifyAdmin,
  schemaValidation({
    body: mapotecaEstoqueSchema.consumoMaterialIds
  }),
  asyncHandler(async (req, res, next) => {
    await mapotecaEstoqueCtrl.deleteConsumoMaterial(req.body.consumo_material_ids)
    const msg = 'Registros de consumo deletados com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK)
  })
)

module.exports = router