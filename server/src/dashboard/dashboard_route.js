'use strict'

const express = require('express')

const { asyncHandler, httpCode, schemaValidation } = require('../utils')

const dashboardCtrl = require('./dashboard_ctrl')
const dashboardSchema = require('./dashboard_schema')

const router = express.Router()

router.get(
  '/produtos_total',
  asyncHandler(async (req, res, next) => {
  const dados = await dashboardCtrl.getTotalProdutos();
  const msg = 'Total de produtos retornado com sucesso'

  return res.sendJsonAndLog(true, msg, httpCode.OK, dados);
}));

router.get(
  '/arquivos_total_gb', 
  asyncHandler(async (req, res, next) => {
  const dados = await dashboardCtrl.getTotalArquivosGb();
  const msg = 'Total de gb retornado com sucesso'

  return res.sendJsonAndLog(true, msg, httpCode.OK, dados);
}));

router.get(
  '/produtos_tipo', 
  asyncHandler(async (req, res, next) => {
  const dados = await dashboardCtrl.getProdutosPorTipo();
  const msg = 'Total de produtos por tipo com sucesso'

  return res.sendJsonAndLog(true, msg, httpCode.OK, dados);
}));

router.get(
  '/gb_tipo_produto', 
  asyncHandler(async (req, res, next) => {
  const dados = await dashboardCtrl.getGbPorTipoProduto();
  const msg = 'Gb por tipo de produto retornado com sucesso'

  return res.sendJsonAndLog(true, msg, httpCode.OK, dados);
}));

router.get(
  '/usuarios_total', 
  asyncHandler(async (req, res, next) => {
  const dados = await dashboardCtrl.getTotalUsuarios();
  const msg = 'Total de usuários retornados com sucesso'

  return res.sendJsonAndLog(true, msg, httpCode.OK, dados);
}));

router.get(
  '/arquivos_dia', 
  asyncHandler(async (req, res, next) => {
  const dados = await dashboardCtrl.getTotalUsuarios();
  const msg = 'Arquivos carregados por dia retornadas com sucesso'

  return res.sendJsonAndLog(true, msg, httpCode.OK, dados);
}));

router.get(
  '/downloads_dia', 
  asyncHandler(async (req, res, next) => {
  const dados = await dashboardCtrl.getDownloadsPorDia();
  const msg = 'Download por dia retornados com sucesso'

  return res.sendJsonAndLog(true, msg, httpCode.OK, dados);
}));

router.get(
  '/gb_volume', 
  asyncHandler(async (req, res, next) => {
  const dados = await dashboardCtrl.getGbPorVolume();
  const msg = 'Gb por volume retornados com sucesso'

  return res.sendJsonAndLog(true, msg, httpCode.OK, dados);
}));

router.get(
  '/ultimos_carregamentos', 
  asyncHandler(async (req, res, next) => {
  const dados = await dashboardCtrl.getUltimosCarregamentos();
  const msg = 'Ultimos carregamentos de arquivo retornados com sucesso'

  return res.sendJsonAndLog(true, msg, httpCode.OK, dados);
}));

router.get(
  '/ultimas_modificacoes', 
  asyncHandler(async (req, res, next) => {
  const dados = await dashboardCtrl.getUltimasModificacoes();
  const msg = 'Ultimas modificações de arquivo retornadas com sucesso'

  return res.sendJsonAndLog(true, msg, httpCode.OK, dados);
}));

router.get(
  '/ultimos_deletes', 
  asyncHandler(async (req, res, next) => {
  const dados = await dashboardCtrl.getUltimosDeletes();
  const msg = 'Ultimos delete de arquivo retornados com sucesso'

  return res.sendJsonAndLog(true, msg, httpCode.OK, dados);
}));

module.exports = router
