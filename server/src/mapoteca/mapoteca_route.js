// Path: mapoteca\mapoteca_route.js
'use strict'

const express = require('express')

const { schemaValidation, asyncHandler, httpCode, csvExport, odsExport, enviarArquivo } = require('../utils')

const { verifyPerfil } = require('../login')

const mapotecaCtrl = require('./mapoteca_ctrl')
const relatorioCtrl = require('./relatorio_ctrl')
const { gerarRtmOds } = require('../rpcmtec/rtm_ods')
const mapotecaSchema = require('./mapoteca_schema')
const anexoPedidoCtrl = require('./anexo_pedido_ctrl')
const auditoriaCtrl = require('./auditoria_ctrl')
const etiquetaEnvioCtrl = require('./etiqueta_envio_ctrl')
const uploadAnexoPedido = require('./anexo_pedido_upload')

const { AppError } = require('../utils')

const router = express.Router()

// Rotas para Domínios
router.get(
  '/dominio/tipo_cliente',
  verifyPerfil('consulta', 'mapoteca'),
  asyncHandler(async (req, res, next) => {
    const dados = await mapotecaCtrl.getTipoCliente()
    const msg = 'Tipos de cliente retornados com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.get(
  '/dominio/situacao_pedido',
  verifyPerfil('consulta', 'mapoteca'),
  asyncHandler(async (req, res, next) => {
    const dados = await mapotecaCtrl.getSituacaoPedido()
    const msg = 'Situações de pedido retornadas com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.get(
  '/dominio/tipo_midia',
  verifyPerfil('consulta', 'mapoteca'),
  asyncHandler(async (req, res, next) => {
    const dados = await mapotecaCtrl.getTipoMidia()
    const msg = 'Tipos de mídia retornados com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.get(
  '/dominio/canal_recebimento',
  verifyPerfil('consulta', 'mapoteca'),
  asyncHandler(async (req, res, next) => {
    const dados = await mapotecaCtrl.getCanalRecebimento()
    const msg = 'Canais de recebimento retornados com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.get(
  '/dominio/tipo_localizacao',
  verifyPerfil('consulta', 'mapoteca'),
  asyncHandler(async (req, res, next) => {
    const dados = await mapotecaCtrl.getTipoLocalizacao()
    const msg = 'Tipos de localização retornados com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.get(
  '/dominio/forma_entrega',
  verifyPerfil('consulta', 'mapoteca'),
  asyncHandler(async (req, res, next) => {
    const dados = await mapotecaCtrl.getFormaEntrega()
    const msg = 'Formas de entrega retornadas com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

// Rotas para Cliente
router.get(
  '/cliente',
  verifyPerfil('consulta', 'mapoteca'),
  asyncHandler(async (req, res, next) => {
    const dados = await mapotecaCtrl.getClientes()
    const msg = 'Clientes retornados com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.get(
  '/cliente/:id',
  verifyPerfil('consulta', 'mapoteca'),
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
  verifyPerfil('gerente', 'mapoteca'),
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
  verifyPerfil('gerente', 'mapoteca'),
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
  verifyPerfil('gerente', 'mapoteca'),
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
// Do ANO consultado, pela data do pedido. O ano vem do contexto do módulo
// (seletor da navbar) e cai no ano corrente quando não vem na query.
router.get(
  '/pedido',
  verifyPerfil('consulta', 'mapoteca'),
  schemaValidation({
    query: mapotecaSchema.anoQuery
  }),
  asyncHandler(async (req, res, next) => {
    const dados = await mapotecaCtrl.getPedidos(req.query.ano)
    const msg = 'Pedidos retornados com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

// PUBLICA de proposito (sem guarda): e o acompanhamento que o proprio cliente
// faz do pedido dele pelo localizador, sem ter conta no sistema. So devolve
// situacao, observacao e itens daquele pedido, e o localizador e o segredo.
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

// A FILA de atendimento: pedidos em aberto, do mais urgente para o menos.
//
// ANTES de '/pedido/:id', e não junto das outras: '/pedido/em_aberto' casaria com
// ':id' e o erro apareceria como "id de pedido inválido", que não diz nada a quem
// chamou. Mesma disciplina de '/pedido/localizador/:localizador' acima.
//
// Perfil OPERADOR, e não consulta: esta é a tela de quem executa o atendimento
// (imprimir, etiquetar, registrar). Quem só consulta usa a lista de pedidos.
router.get(
  '/pedido/em_aberto',
  verifyPerfil('operador', 'mapoteca'),
  asyncHandler(async (req, res, next) => {
    const dados = await mapotecaCtrl.getPedidosEmAberto()
    const msg = 'Pedidos em aberto retornados com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.get(
  '/pedido/:id',
  verifyPerfil('consulta', 'mapoteca'),
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

// O que IMPRIMIR de um pedido, com a carta de cada item.
//
// Leitura pura, ao contrário de '/pedido/:id/download_impressao', que cria token e
// devolve caminho de volume para o plugin do QGIS. Aqui vem o uuid_arquivo, e o
// navegador baixa por GET /acervo/arquivo/:uuid/download.
router.get(
  '/pedido/:id/impressao',
  verifyPerfil('operador', 'mapoteca'),
  schemaValidation({
    params: mapotecaSchema.pedidoId
  }),
  asyncHandler(async (req, res, next) => {
    const dados = await mapotecaCtrl.getImpressaoDoPedido(req.params.id)
    const msg = 'Itens para impressão retornados com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

// Baixa a CARTA de um item do pedido, pelo navegador.
//
// Existe apesar de '/acervo/arquivo/:uuid/download' fazer o mesmo stream, e a
// razão é a permissão: quem atende pedido tem operador na MAPOTECA e pode não ter
// perfil nenhum no acervo. Pela rota do acervo ele levava 403 no meio da tela
// feita para ele. A permissão segue o MÓDULO do trabalho, não o do dado.
//
// O par (pedido, arquivo) é conferido no banco: sem isso, esta rota viraria um
// download do acervo inteiro com perfil de mapoteca, bastando trocar o uuid.
router.get(
  '/pedido/:id/arquivo/:uuid_arquivo/download',
  verifyPerfil('operador', 'mapoteca'),
  schemaValidation({
    params: mapotecaSchema.arquivoImpressaoParams
  }),
  asyncHandler(async (req, res, next) => {
    const arquivo = await mapotecaCtrl.getArquivoDeImpressao(
      req.params.id,
      req.params.uuid_arquivo
    )
    await enviarArquivo.enviarArquivoDoVolume(req, res, arquivo)
  })
)

router.post(
  '/pedido',
  verifyPerfil('gerente', 'mapoteca'),
  schemaValidation({
    body: mapotecaSchema.pedido
  }),
  asyncHandler(async (req, res, next) => {
    const result = await mapotecaCtrl.criaPedido(req.body, req.usuarioUuid)
    const msg = 'Pedido criado com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.Created, result)
  })
)

router.put(
  '/pedido',
  verifyPerfil('gerente', 'mapoteca'),
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
  verifyPerfil('gerente', 'mapoteca'),
  schemaValidation({
    body: mapotecaSchema.pedidoIds
  }),
  asyncHandler(async (req, res, next) => {
    await mapotecaCtrl.deletePedidos(req.body.pedido_ids, req.usuarioUuid)
    const msg = 'Pedidos deletados com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK)
  })
)

// Rotas para Impressão de Pedidos (plugin QGIS da mapoteca)

// Prepara o download dos PDFs das cartas do pedido para impressão.
// Cria tokens em acervo.download; o plugin confirma via /api/acervo/confirm-download.
router.post(
  '/pedido/:id/download_impressao',
  verifyPerfil('operador', 'mapoteca'),
  schemaValidation({
    params: mapotecaSchema.pedidoId
  }),
  asyncHandler(async (req, res, next) => {
    const dados = await mapotecaCtrl.prepareDownloadImpressao(req.params.id, req.usuarioUuid)
    const msg = 'Download para impressão preparado com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

// Registra sessões de impressão (log operacional — qualquer usuário logado)
router.post(
  '/impressao',
  verifyPerfil('operador', 'mapoteca'),
  schemaValidation({
    body: mapotecaSchema.registroImpressao
  }),
  asyncHandler(async (req, res, next) => {
    await mapotecaCtrl.registrarImpressao(req.body.registros, req.usuarioUuid)
    const msg = 'Impressão registrada com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.Created)
  })
)

// Histórico de impressão de um item do pedido
router.get(
  '/produto_pedido/:id/impressao',
  verifyPerfil('consulta', 'mapoteca'),
  schemaValidation({
    params: mapotecaSchema.produtoPedidoId
  }),
  asyncHandler(async (req, res, next) => {
    const dados = await mapotecaCtrl.getImpressoesItem(req.params.id)
    const msg = 'Histórico de impressão retornado com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

// Remove registros de impressão (correções)
router.delete(
  '/impressao',
  verifyPerfil('gerente', 'mapoteca'),
  schemaValidation({
    body: mapotecaSchema.impressaoIds
  }),
  asyncHandler(async (req, res, next) => {
    await mapotecaCtrl.deleteImpressoes(req.body.impressao_ids, req.usuarioUuid)
    const msg = 'Registros de impressão deletados com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK)
  })
)

// Rotas para Produto do Pedido
router.post(
  '/produto_pedido',
  verifyPerfil('gerente', 'mapoteca'),
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
  verifyPerfil('gerente', 'mapoteca'),
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
  verifyPerfil('gerente', 'mapoteca'),
  schemaValidation({
    body: mapotecaSchema.produtoPedidoIds
  }),
  asyncHandler(async (req, res, next) => {
    await mapotecaCtrl.deleteProdutosPedido(req.body.produto_pedido_ids, req.usuarioUuid)
    const msg = 'Produtos do pedido deletados com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK)
  })
)

// Rotas para Plotter
router.get(
  '/plotter',
  verifyPerfil('consulta', 'mapoteca'),
  asyncHandler(async (req, res, next) => {
    const dados = await mapotecaCtrl.getPlotters()
    const msg = 'Plotters retornados com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.get(
  '/plotter/:id',
  verifyPerfil('consulta', 'mapoteca'),
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
  verifyPerfil('gerente', 'mapoteca'),
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
  verifyPerfil('gerente', 'mapoteca'),
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
  verifyPerfil('gerente', 'mapoteca'),
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
  verifyPerfil('consulta', 'mapoteca'),
  asyncHandler(async (req, res, next) => {
    const dados = await mapotecaCtrl.getManutencoesPlotter()
    const msg = 'Manutenções de plotter retornadas com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.get(
  '/manutencao_plotter/:id',
  verifyPerfil('consulta', 'mapoteca'),
  schemaValidation({
    params: mapotecaSchema.manutencaoPlotterId
  }),
  asyncHandler(async (req, res, next) => {
    const dados = await mapotecaCtrl.getManutencaoPlotterById(req.params.id)
    const msg = 'Manutenção de plotter retornada com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.post(
  '/manutencao_plotter',
  verifyPerfil('gerente', 'mapoteca'),
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
  verifyPerfil('gerente', 'mapoteca'),
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
  verifyPerfil('gerente', 'mapoteca'),
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
  verifyPerfil('consulta', 'mapoteca'),
  asyncHandler(async (req, res, next) => {
    const dados = await mapotecaCtrl.getTiposMaterial()
    const msg = 'Tipos de material retornados com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.get(
  '/tipo_material/:id',
  verifyPerfil('consulta', 'mapoteca'),
  schemaValidation({
    params: mapotecaSchema.tipoMaterialId
  }),
  asyncHandler(async (req, res, next) => {
    const { id } = req.params
    const dados = await mapotecaCtrl.getTipoMaterialById(id)
    const msg = 'Detalhes do tipo de material retornados com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.post(
  '/tipo_material',
  verifyPerfil('gerente', 'mapoteca'),
  schemaValidation({
    body: mapotecaSchema.tipoMaterial
  }),
  asyncHandler(async (req, res, next) => {
    const id = await mapotecaCtrl.criaTipoMaterial(req.body, req.usuarioUuid)
    const msg = 'Tipo de material criado com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.Created, { id })
  })
)

router.put(
  '/tipo_material',
  verifyPerfil('gerente', 'mapoteca'),
  schemaValidation({
    body: mapotecaSchema.tipoMaterialAtualizacao
  }),
  asyncHandler(async (req, res, next) => {
    await mapotecaCtrl.atualizaTipoMaterial(req.body, req.usuarioUuid)
    const msg = 'Tipo de material atualizado com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK)
  })
)

router.delete(
  '/tipo_material',
  verifyPerfil('gerente', 'mapoteca'),
  schemaValidation({
    body: mapotecaSchema.tipoMaterialIds
  }),
  asyncHandler(async (req, res, next) => {
    await mapotecaCtrl.deleteTiposMaterial(req.body.tipo_material_ids)
    const msg = 'Tipos de material deletados com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK)
  })
)

// Rotas para Estoque de Material
router.get(
  '/estoque_material',
  verifyPerfil('consulta', 'mapoteca'),
  asyncHandler(async (req, res, next) => {
    const dados = await mapotecaCtrl.getEstoqueMaterial()
    const msg = 'Estoque de material retornado com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.get(
  '/estoque_por_localizacao',
  verifyPerfil('consulta', 'mapoteca'),
  asyncHandler(async (req, res, next) => {
    const dados = await mapotecaCtrl.getEstoquePorLocalizacao()
    const msg = 'Estoque por localização retornado com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.post(
  '/estoque_material/transferir',
  verifyPerfil('operador', 'mapoteca'),
  schemaValidation({
    body: mapotecaSchema.transferenciaEstoque
  }),
  asyncHandler(async (req, res, next) => {
    await mapotecaCtrl.transferirMaterial(req.body, req.usuarioUuid)
    const msg = 'Transferência realizada com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK)
  })
)

router.get(
  '/estoque_material/:id',
  verifyPerfil('consulta', 'mapoteca'),
  schemaValidation({
    params: mapotecaSchema.estoqueMaterialId
  }),
  asyncHandler(async (req, res, next) => {
    const dados = await mapotecaCtrl.getEstoqueMaterialById(req.params.id)
    const msg = 'Estoque de material retornado com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.post(
  '/estoque_material',
  verifyPerfil('gerente', 'mapoteca'),
  schemaValidation({
    body: mapotecaSchema.estoqueMaterial
  }),
  asyncHandler(async (req, res, next) => {
    const id = await mapotecaCtrl.criaEstoqueMaterial(req.body, req.usuarioUuid)
    const msg = 'Estoque de material criado/atualizado com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.Created, { id })
  })
)

router.put(
  '/estoque_material',
  verifyPerfil('gerente', 'mapoteca'),
  schemaValidation({
    body: mapotecaSchema.estoqueMaterialAtualizacao
  }),
  asyncHandler(async (req, res, next) => {
    await mapotecaCtrl.atualizaEstoqueMaterial(req.body, req.usuarioUuid)
    const msg = 'Estoque de material atualizado com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK)
  })
)

router.delete(
  '/estoque_material',
  verifyPerfil('gerente', 'mapoteca'),
  schemaValidation({
    body: mapotecaSchema.estoqueMaterialIds
  }),
  asyncHandler(async (req, res, next) => {
    await mapotecaCtrl.deleteEstoqueMaterial(req.body.estoque_material_ids)
    const msg = 'Registros de estoque deletados com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK)
  })
)

// Rotas para Consumo de Material
//
// A LISTA de lancamentos e OPERADOR desde 2026-07-30 (chefe): consumo de material
// e a segunda tela do perfil de operador da mapoteca, junto do atendimento. Nao
// bastava esconder o item no menu, porque o perfil do client e so ergonomia: quem
// barra leitura e este verifyPerfil.
//
// O que fica em CONSULTA de proposito: '/consumo_mensal' (abaixo) e o
// '/dashboard/material_consumption', que sao o AGREGADO. O total do mes e
// informacao de gestao; a lista de lancamentos e trabalho de quem opera.
router.get(
  '/consumo_material',
  verifyPerfil('operador', 'mapoteca'),
  schemaValidation({
    query: mapotecaSchema.consumoMaterialFiltro
  }),
  asyncHandler(async (req, res, next) => {
    const dados = await mapotecaCtrl.getConsumoMaterial(req.query)
    const msg = 'Registros de consumo retornados com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.get(
  '/consumo_mensal',
  verifyPerfil('consulta', 'mapoteca'),
  schemaValidation({
    query: mapotecaSchema.anoQuery
  }),
  asyncHandler(async (req, res, next) => {
    const dados = await mapotecaCtrl.getConsumoMensalPorTipo(req.query.ano)
    const msg = 'Consumo mensal por tipo de material retornado com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.get(
  '/consumo_material/:id',
  verifyPerfil('operador', 'mapoteca'),
  schemaValidation({
    params: mapotecaSchema.consumoMaterialId
  }),
  asyncHandler(async (req, res, next) => {
    const dados = await mapotecaCtrl.getConsumoMaterialById(req.params.id)
    const msg = 'Consumo de material retornado com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.post(
  '/consumo_material',
  verifyPerfil('operador', 'mapoteca'),
  schemaValidation({
    body: mapotecaSchema.consumoMaterial
  }),
  asyncHandler(async (req, res, next) => {
    const id = await mapotecaCtrl.criaConsumoMaterial(req.body, req.usuarioUuid)
    const msg = 'Registro de consumo criado com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.Created, { id })
  })
)

router.put(
  '/consumo_material',
  verifyPerfil('operador', 'mapoteca'),
  schemaValidation({
    body: mapotecaSchema.consumoMaterialAtualizacao
  }),
  asyncHandler(async (req, res, next) => {
    await mapotecaCtrl.atualizaConsumoMaterial(req.body, req.usuarioUuid)
    const msg = 'Registro de consumo atualizado com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK)
  })
)

router.delete(
  '/consumo_material',
  verifyPerfil('gerente', 'mapoteca'),
  schemaValidation({
    body: mapotecaSchema.consumoMaterialIds
  }),
  asyncHandler(async (req, res, next) => {
    await mapotecaCtrl.deleteConsumoMaterial(req.body.consumo_material_ids)
    const msg = 'Registros de consumo deletados com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK)
  })
)

// Rotas de relatórios anuais (reproduzem as abas da planilha de controle).
// Aceitam ?ano= (default ano corrente) e ?formato=csv para download.
router.get(
  '/relatorio/pedidos_mil',
  verifyPerfil('consulta', 'mapoteca'),
  schemaValidation({
    query: mapotecaSchema.relatorioQuery
  }),
  asyncHandler(async (req, res, next) => {
    const { ano, formato } = req.query
    const dados = await relatorioCtrl.getRelatorioPedidosMil(ano)
    const msg = 'Relatório de pedidos militares retornado com sucesso'
    return csvExport.sendReport(res, formato, msg, dados, {
      filename: `pedidos_mil_${ano}.csv`,
      columns: relatorioCtrl.COLUNAS_MIL
    })
  })
)

router.get(
  '/relatorio/pedidos_detalhado',
  verifyPerfil('consulta', 'mapoteca'),
  schemaValidation({
    query: mapotecaSchema.relatorioQuery
  }),
  asyncHandler(async (req, res, next) => {
    const { ano, formato } = req.query
    const dados = await relatorioCtrl.getRelatorioPedidosDetalhado(ano)
    const msg = 'Relatório detalhado de pedidos retornado com sucesso'
    return csvExport.sendReport(res, formato, msg, dados, {
      filename: `pedidos_detalhado_${ano}.csv`,
      columns: relatorioCtrl.COLUNAS_DETALHADO
    })
  })
)

router.get(
  '/relatorio/pedidos_civ',
  verifyPerfil('consulta', 'mapoteca'),
  schemaValidation({
    query: mapotecaSchema.relatorioQuery
  }),
  asyncHandler(async (req, res, next) => {
    const { ano, formato } = req.query
    const dados = await relatorioCtrl.getRelatorioPedidosCiv(ano)
    const msg = 'Relatório de pedidos civis retornado com sucesso'
    return csvExport.sendReport(res, formato, msg, dados, {
      filename: `pedidos_civ_${ano}.csv`,
      columns: relatorioCtrl.COLUNAS_CIV
    })
  })
)

router.get(
  '/relatorio/tematicos',
  verifyPerfil('consulta', 'mapoteca'),
  schemaValidation({
    query: mapotecaSchema.relatorioQuery
  }),
  asyncHandler(async (req, res, next) => {
    const { ano, formato } = req.query
    const dados = await relatorioCtrl.getRelatorioTematicos(ano)
    const msg = 'Relatório de produção temática retornado com sucesso'
    return csvExport.sendReport(res, formato, msg, dados, {
      filename: `tematicos_${ano}.csv`,
      columns: relatorioCtrl.COLUNAS_TEMATICOS
    })
  })
)

// Impressão detalhada: mesmos dados do relatório Detalhado, recortados nas 15
// colunas da planilha de impressão.
router.get(
  '/relatorio/impressao_detalhada',
  verifyPerfil('consulta', 'mapoteca'),
  schemaValidation({
    query: mapotecaSchema.relatorioQuery
  }),
  asyncHandler(async (req, res, next) => {
    const { ano, formato } = req.query
    const dados = await relatorioCtrl.getRelatorioPedidosDetalhado(ano)
    const msg = 'Relatório de impressão detalhada retornado com sucesso'
    return csvExport.sendReport(res, formato, msg, dados, {
      filename: `impressao_detalhada_${ano}.csv`,
      columns: relatorioCtrl.COLUNAS_IMPRESSAO_DETALHADA
    })
  })
)

// Impressão detalhada em .ods, na FORMA da aba META4_DETALHADA do RTM.
//
// Rota SEPARADA da de cima, e não um ?formato=ods nela, de propósito: as duas
// não devolvem o mesmo conteúdo. O CSV traz o dado cru do banco ('Sulfite 90g',
// booleano); o .ods traz o vocabulário da aba ('sulfite', 'sim'/'não'), a data
// como DATA, a quantidade como NÚMERO e a ordem cronológica de entrega. Servir
// as duas coisas pelo mesmo endereço esconderia essa diferença.
//
// Sempre baixa (não tem ?formato=json): o corpo é um arquivo binário.
router.get(
  '/relatorio/impressao_detalhada_ods',
  verifyPerfil('consulta', 'mapoteca'),
  schemaValidation({
    query: mapotecaSchema.anoQuery
  }),
  asyncHandler(async (req, res, next) => {
    const { ano } = req.query
    const dados = await relatorioCtrl.getRelatorioPedidosDetalhado(ano)
    // MESMO gerador da rota /api/rpcmtec/rtm/ods, de proposito: dois caminhos
    // para o mesmo arquivo com formatos diferentes e a divergencia que a fusao
    // do RPCMTec existiu para acabar. Ele mora em `rpcmtec/` porque e onde ficam
    // as planilhas-semente; nao ha ciclo, o modulo dele so importa `utils`.
    const buffer = gerarRtmOds(relatorioCtrl.paraAbaMeta4(dados))
    res.setHeader('Content-Type', 'application/vnd.oasis.opendocument.spreadsheet')
    res.setHeader('Content-Disposition', `attachment; filename="META4_DETALHADA_${ano}.ods"`)
    res.setHeader('Content-Length', String(buffer.length))
    return res.end(buffer)
  })
)

// O Anuário Estatístico NÃO tem mais rota aqui. Ele saiu em 2026-08-01 para
// /api/rpcmtec/anuario, junto com o RPCMTec: os dois sobem para a DSG no mesmo
// envio mensal, e agora saem da mesma tela. O `anuario_ctrl` continua NESTE
// módulo, que é onde a entrega é registrada -- o que mudou de casa foi a rota e
// o desenho do arquivo, que passou a sair da planilha-semente da DSG em vez de
// ser redesenhado (ver server/src/rpcmtec/anuario_ods.js).

// Resumo de pedidos: uma linha por pedido (todos os clientes) com dados de envio
// e o consolidado de produtos entregues por tipo e escala.
router.get(
  '/relatorio/pedidos_resumo',
  verifyPerfil('consulta', 'mapoteca'),
  schemaValidation({
    query: mapotecaSchema.relatorioQuery
  }),
  asyncHandler(async (req, res, next) => {
    const { ano, formato } = req.query
    const dados = await relatorioCtrl.getRelatorioPedidosResumo(ano)
    const msg = 'Relatório-resumo de pedidos retornado com sucesso'
    return csvExport.sendReport(res, formato, msg, dados, {
      filename: `pedidos_resumo_${ano}.csv`,
      columns: relatorioCtrl.COLUNAS_PEDIDOS_RESUMO
    })
  })
)

// --- Anexos do pedido (documento de solicitação + arquivos) -----------------

// Lista os anexos (só metadados) de um pedido.
router.get(
  '/pedido/:id/anexos',
  verifyPerfil('consulta', 'mapoteca'),
  schemaValidation({ params: mapotecaSchema.anexoPedidoParams }),
  asyncHandler(async (req, res, next) => {
    const dados = await anexoPedidoCtrl.listarPorPedido(req.params.id)

    const msg = 'Anexos do pedido retornados com sucesso'

    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

// Anexa um arquivo a um pedido. O arquivo vem no campo multipart "arquivo";
// tipo_anexo_id e descricao (opcionais) vêm no corpo. Ordem: auth -> valida
// params -> multer -> valida corpo -> handler.
router.post(
  '/pedido/:id/anexos',
  verifyPerfil('gerente', 'mapoteca'),
  schemaValidation({ params: mapotecaSchema.anexoPedidoParams }),
  uploadAnexoPedido,
  schemaValidation({ body: mapotecaSchema.anexoUploadBody }),
  asyncHandler(async (req, res, next) => {
    if (!req.file) {
      throw new AppError(
        'Nenhum arquivo enviado (campo "arquivo")',
        httpCode.BadRequest
      )
    }

    const dados = await anexoPedidoCtrl.criar(
      req.params.id,
      req.file,
      req.body,
      req.usuarioUuid
    )

    const msg = 'Anexo do pedido cadastrado com sucesso'

    return res.sendJsonAndLog(true, msg, httpCode.Created, dados)
  })
)

// Baixa o arquivo de um anexo (bytes do banco) com o nome original.
router.get(
  '/pedido/anexo/:anexoId/download',
  verifyPerfil('consulta', 'mapoteca'),
  schemaValidation({ params: mapotecaSchema.anexoIdParams }),
  asyncHandler(async (req, res, next) => {
    const arquivo = await anexoPedidoCtrl.getParaDownload(req.params.anexoId)

    res.setHeader(
      'Content-Type',
      arquivo.mimetype || 'application/octet-stream'
    )
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(arquivo.nome_original)}`
    )

    return res.send(arquivo.conteudo)
  })
)

// Remove um anexo do pedido.
router.delete(
  '/pedido/anexo/:anexoId',
  verifyPerfil('gerente', 'mapoteca'),
  schemaValidation({ params: mapotecaSchema.anexoIdParams }),
  asyncHandler(async (req, res, next) => {
    await anexoPedidoCtrl.deletar(req.params.anexoId)

    const msg = 'Anexo do pedido excluído com sucesso'

    return res.sendJsonAndLog(true, msg, httpCode.OK)
  })
)

// --- Etiqueta de envio do pedido --------------------------------------------

// Etiqueta salva do pedido, ou dados nulo quando ainda não houver.
//
// Perfil de CONSULTA: quem lê o pedido lê a etiqueta dele, que é só o endereço
// já cadastrado, com a correção aplicada.
router.get(
  '/pedido/:id/etiqueta',
  verifyPerfil('consulta', 'mapoteca'),
  schemaValidation({ params: mapotecaSchema.etiquetaPedidoParams }),
  asyncHandler(async (req, res, next) => {
    const dados = await etiquetaEnvioCtrl.getPorPedido(req.params.id)

    const msg = 'Etiqueta de envio retornada com sucesso'

    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

// Grava a etiqueta do pedido (cria na primeira vez, substitui nas seguintes).
//
// Perfil de OPERADOR, e não gerente: quem embala o pacote é quem descobre que o
// endereço do DIEx está errado, e é ele quem corrige. Mesmo perfil das outras
// rotas do atendimento (imprimir, registrar impressão).
router.put(
  '/pedido/:id/etiqueta',
  verifyPerfil('operador', 'mapoteca'),
  schemaValidation({
    params: mapotecaSchema.etiquetaPedidoParams,
    body: mapotecaSchema.etiquetaEnvio
  }),
  asyncHandler(async (req, res, next) => {
    const dados = await etiquetaEnvioCtrl.salvar(
      req.params.id,
      req.body,
      req.usuarioUuid
    )

    const msg = 'Etiqueta de envio salva com sucesso'

    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

// --- Auditoria do pedido ----------------------------------------------------

// Histórico de quem alterou, adicionou e removeu o pedido e os itens dele.
// Perfil de CONSULTA: quem lê o pedido lê o histórico dele. Responde mesmo para
// pedido já apagado, que é justamente o caso que a auditoria existe para
// registrar (ver o comentário em auditoria_ctrl.listarPorPedido).
router.get(
  '/pedido/:id/auditoria',
  verifyPerfil('consulta', 'mapoteca'),
  schemaValidation({ params: mapotecaSchema.auditoriaPedidoParams }),
  asyncHandler(async (req, res, next) => {
    const dados = await auditoriaCtrl.listarPorPedido(req.params.id)

    const msg = 'Auditoria do pedido retornada com sucesso'

    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

module.exports = router