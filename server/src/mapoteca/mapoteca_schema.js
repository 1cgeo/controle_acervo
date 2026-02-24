// Path: mapoteca\mapoteca_schema.js
'use strict'

const Joi = require('joi')

const models = {}

// Esquemas para Cliente
models.clienteId = Joi.object().keys({
  id: Joi.number().integer().required()
})

models.clienteIds = Joi.object().keys({
  cliente_ids: Joi.array()
    .items(Joi.number().integer().required())
    .min(1)
    .required()
})

models.cliente = Joi.object().keys({
  nome: Joi.string().required(),
  ponto_contato_principal: Joi.string().allow(null, ''),
  endereco_entrega_principal: Joi.string().allow(null, ''),
  tipo_cliente_id: Joi.number().integer().required()
})

models.clienteAtualizacao = Joi.object().keys({
  id: Joi.number().integer().required(),
  nome: Joi.string().required(),
  ponto_contato_principal: Joi.string().allow(null, ''),
  endereco_entrega_principal: Joi.string().allow(null, ''),
  tipo_cliente_id: Joi.number().integer().required()
})

// Esquemas para Pedido
models.pedidoId = Joi.object().keys({
  id: Joi.number().integer().required()
})

models.pedidoIds = Joi.object().keys({
  pedido_ids: Joi.array()
    .items(Joi.number().integer().required())
    .min(1)
    .required()
})

models.pedido = Joi.object().keys({
  data_pedido: Joi.date().required(),
  data_atendimento: Joi.date().allow(null),
  cliente_id: Joi.number().integer().required(),
  situacao_pedido_id: Joi.number().integer().required(),
  ponto_contato: Joi.string().allow(null, ''),
  documento_solicitacao: Joi.string().allow(null, ''),
  documento_solicitacao_nup: Joi.string().allow(null, ''),
  endereco_entrega: Joi.string().allow(null, ''),
  palavras_chave: Joi.array().items(Joi.string()).default([]),
  operacao: Joi.string().allow(null, ''),
  prazo: Joi.date().allow(null),
  observacao: Joi.string().allow(null, ''),
  localizador_envio: Joi.string().allow(null, ''),
  observacao_envio: Joi.string().allow(null, ''),
  motivo_cancelamento: Joi.string().allow(null, '')
})

models.pedidoAtualizacao = Joi.object().keys({
  id: Joi.number().integer().required(),
  data_pedido: Joi.date().required(),
  data_atendimento: Joi.date().allow(null),
  cliente_id: Joi.number().integer().required(),
  situacao_pedido_id: Joi.number().integer().required(),
  ponto_contato: Joi.string().allow(null, ''),
  documento_solicitacao: Joi.string().allow(null, ''),
  documento_solicitacao_nup: Joi.string().allow(null, ''),
  endereco_entrega: Joi.string().allow(null, ''),
  palavras_chave: Joi.array().items(Joi.string()).default([]),
  operacao: Joi.string().allow(null, ''),
  prazo: Joi.date().allow(null),
  observacao: Joi.string().allow(null, ''),
  localizador_envio: Joi.string().allow(null, ''),
  observacao_envio: Joi.string().allow(null, ''),
  motivo_cancelamento: Joi.string().allow(null, '')
})

models.pedidoLocalizador = Joi.object().keys({
  localizador: Joi.string().pattern(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/).required()
})

// Esquemas para Produto do Pedido
models.produtoPedidoIds = Joi.object().keys({
  produto_pedido_ids: Joi.array()
    .items(Joi.number().integer().required())
    .min(1)
    .required()
})

models.produtoPedido = Joi.object().keys({
  uuid_versao: Joi.string().guid().required(),
  pedido_id: Joi.number().integer().required(),
  quantidade: Joi.number().integer().min(1).required(),
  tipo_midia_id: Joi.number().integer().required(),
  producao_especifica: Joi.boolean().default(false)
})

models.produtoPedidoAtualizacao = Joi.object().keys({
  id: Joi.number().integer().required(),
  uuid_versao: Joi.string().guid().required(),
  pedido_id: Joi.number().integer().required(),
  quantidade: Joi.number().integer().min(1).required(),
  tipo_midia_id: Joi.number().integer().required(),
  producao_especifica: Joi.boolean().default(false)
})

// Esquemas para Plotter
models.plotterId = Joi.object().keys({
  id: Joi.number().integer().required()
})

models.plotterIds = Joi.object().keys({
  plotter_ids: Joi.array()
    .items(Joi.number().integer().required())
    .min(1)
    .required()
})

models.plotter = Joi.object().keys({
  ativo: Joi.boolean().default(true),
  nr_serie: Joi.string().required(),
  modelo: Joi.string().required(),
  data_aquisicao: Joi.date().allow(null),
  vida_util: Joi.number().integer().allow(null).description('Vida útil em meses')
})

models.plotterAtualizacao = Joi.object().keys({
  id: Joi.number().integer().required(),
  ativo: Joi.boolean().required(),
  nr_serie: Joi.string().required(),
  modelo: Joi.string().required(),
  data_aquisicao: Joi.date().allow(null),
  vida_util: Joi.number().integer().allow(null).description('Vida útil em meses')
})

// Esquemas para Manutenção de Plotter
models.manutencaoPlotterIds = Joi.object().keys({
  manutencao_ids: Joi.array()
    .items(Joi.number().integer().required())
    .min(1)
    .required()
})

models.manutencaoPlotter = Joi.object().keys({
  plotter_id: Joi.number().integer().required(),
  data_manutencao: Joi.date().required(),
  valor: Joi.number().precision(2).positive().required(),
  descricao: Joi.string().allow(null, '')
})

models.manutencaoPlotterAtualizacao = Joi.object().keys({
  id: Joi.number().integer().required(),
  plotter_id: Joi.number().integer().required(),
  data_manutencao: Joi.date().required(),
  valor: Joi.number().precision(2).positive().required(),
  descricao: Joi.string().allow(null, '')
})

// Esquemas para Tipo de Material
models.tipoMaterialIds = Joi.object().keys({
  tipo_material_ids: Joi.array()
    .items(Joi.number().integer().required())
    .min(1)
    .required()
})

models.tipoMaterial = Joi.object().keys({
  nome: Joi.string().required(),
  descricao: Joi.string().allow(null, '')
})

models.tipoMaterialAtualizacao = Joi.object().keys({
  id: Joi.number().integer().required(),
  nome: Joi.string().required(),
  descricao: Joi.string().allow(null, '')
})

// Esquemas para Estoque de Material
models.estoqueMaterialIds = Joi.object().keys({
  estoque_material_ids: Joi.array()
    .items(Joi.number().integer().required())
    .min(1)
    .required()
})

models.estoqueMaterial = Joi.object().keys({
  tipo_material_id: Joi.number().integer().required(),
  quantidade: Joi.number().precision(2).positive().required(),
  localizacao_id: Joi.number().integer().required()
})

models.estoqueMaterialAtualizacao = Joi.object().keys({
  id: Joi.number().integer().required(),
  tipo_material_id: Joi.number().integer().required(),
  quantidade: Joi.number().precision(2).positive().required(),
  localizacao_id: Joi.number().integer().required()
})

// Esquemas para Consumo de Material
models.consumoMaterialIds = Joi.object().keys({
  consumo_material_ids: Joi.array()
    .items(Joi.number().integer().required())
    .min(1)
    .required()
})

models.consumoMaterial = Joi.object().keys({
  tipo_material_id: Joi.number().integer().required(),
  quantidade: Joi.number().precision(2).positive().required(),
  data_consumo: Joi.date().required()
})

models.consumoMaterialAtualizacao = Joi.object().keys({
  id: Joi.number().integer().required(),
  tipo_material_id: Joi.number().integer().required(),
  quantidade: Joi.number().precision(2).positive().required(),
  data_consumo: Joi.date().required()
})

// Esquemas para GET by ID
models.manutencaoPlotterId = Joi.object().keys({
  id: Joi.number().integer().strict().required()
})

models.consumoMaterialId = Joi.object().keys({
  id: Joi.number().integer().strict().required()
})

models.estoqueMaterialId = Joi.object().keys({
  id: Joi.number().integer().strict().required()
})

// Esquemas para filtragem de consumo
models.consumoMaterialFiltro = Joi.object().keys({
  data_inicio: Joi.date(),
  data_fim: Joi.date(),
  tipo_material_id: Joi.number().integer()
})

module.exports = models