// Path: mapoteca\mapoteca_schema.js
'use strict'

const Joi = require('joi')

const { SITUACAO_PEDIDO, TIPO_LOCALIZACAO, TIPO_CLIENTE, TIPO_MIDIA, FORMA_ENTREGA, TIPO_ANEXO_PEDIDO, CANAL_RECEBIMENTO } = require('../utils/domain_constants')

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
  nome: Joi.string().max(255).required(),
  ponto_contato_principal: Joi.string().max(255).allow(null, ''),
  endereco_entrega_principal: Joi.string().max(255).allow(null, ''),
  tipo_cliente_id: Joi.number().integer().valid(...Object.values(TIPO_CLIENTE)).required()
})

models.clienteAtualizacao = Joi.object().keys({
  id: Joi.number().integer().required(),
  nome: Joi.string().max(255).required(),
  ponto_contato_principal: Joi.string().max(255).allow(null, ''),
  endereco_entrega_principal: Joi.string().max(255).allow(null, ''),
  tipo_cliente_id: Joi.number().integer().valid(...Object.values(TIPO_CLIENTE)).required()
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

// Campos compartilhados entre criação e atualização de pedido.
// RN02: pedido concluído exige data_atendimento.
// RN03: pedido cancelado exige motivo_cancelamento.
const pedidoBase = {
  // raw(): 'YYYY-MM-DD' interpretado no fuso local pelo Postgres (sem shift D-1)
  data_pedido: Joi.date().raw().required(),
  data_atendimento: Joi.when('situacao_pedido_id', {
    is: SITUACAO_PEDIDO.CONCLUIDO,
    then: Joi.date().raw().min(Joi.ref('data_pedido')).required(),
    otherwise: Joi.date().raw().min(Joi.ref('data_pedido')).allow(null)
  }),
  cliente_id: Joi.number().integer().required(),
  situacao_pedido_id: Joi.number().integer().valid(...Object.values(SITUACAO_PEDIDO)).required(),
  ponto_contato: Joi.string().max(255).allow(null, ''),
  documento_solicitacao: Joi.string().max(255).allow(null, ''),
  documento_solicitacao_nup: Joi.string().max(255).allow(null, ''),
  endereco_entrega: Joi.string().allow(null, ''),
  palavras_chave: Joi.array().items(Joi.string()).default([]),
  operacao: Joi.string().allow(null, ''),
  prazo: Joi.date().raw().allow(null),
  demandante: Joi.string().max(255).allow(null, ''),
  omds: Joi.string().max(255).allow(null, ''),
  previsto_pit: Joi.boolean().default(false),
  // Campos de pedido de CIVIL (opcionais; NULL para OM)
  canal_recebimento_id: Joi.number().integer().valid(...Object.values(CANAL_RECEBIMENTO)).allow(null),
  municipio: Joi.string().max(255).allow(null, ''),
  qtd_imagens: Joi.number().integer().min(0).allow(null),
  observacao: Joi.string().allow(null, ''),
  localizador_envio: Joi.string().allow(null, ''),
  observacao_envio: Joi.string().allow(null, ''),
  motivo_cancelamento: Joi.when('situacao_pedido_id', {
    is: SITUACAO_PEDIDO.CANCELADO,
    then: Joi.string().required(),
    otherwise: Joi.string().allow(null, '')
  })
}

models.pedido = Joi.object().keys(pedidoBase)

models.pedidoAtualizacao = Joi.object().keys({
  id: Joi.number().integer().required(),
  ...pedidoBase
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

// RN08: todo item de pedido referencia uma versão do acervo (uuid_versao obrigatório)
const produtoPedidoBase = {
  uuid_versao: Joi.string().guid().required(),
  pedido_id: Joi.number().integer().required(),
  quantidade: Joi.number().integer().min(1).required(),
  quantidade_fornecida: Joi.number().integer().min(0).allow(null),
  tipo_midia_id: Joi.number().integer().valid(...Object.values(TIPO_MIDIA)).required(),
  tipo_midia_fornecida_id: Joi.number().integer().valid(...Object.values(TIPO_MIDIA)).allow(null),
  forma_entrega_id: Joi.number().integer().valid(...Object.values(FORMA_ENTREGA)).allow(null),
  // raw(): preserva a string da data para evitar shift de fuso na coluna DATE
  data_entrega: Joi.date().raw().allow(null),
  observacao: Joi.string().allow(null, ''),
  producao_especifica: Joi.boolean().default(false)
}

models.produtoPedido = Joi.object().keys(produtoPedidoBase)

models.produtoPedidoAtualizacao = Joi.object().keys({
  id: Joi.number().integer().required(),
  ...produtoPedidoBase
})

models.produtoPedidoId = Joi.object().keys({
  id: Joi.number().integer().required()
})

// Esquemas para Impressão (plugin QGIS da mapoteca)
models.registroImpressao = Joi.object().keys({
  registros: Joi.array()
    .items(
      Joi.object().keys({
        produto_pedido_id: Joi.number().integer().required(),
        quantidade: Joi.number().integer().min(1).required(),
        observacao: Joi.string().allow(null, '')
      })
    )
    .min(1)
    .required()
})

models.impressaoIds = Joi.object().keys({
  impressao_ids: Joi.array()
    .items(Joi.number().integer().required())
    .min(1)
    .required()
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
  nr_serie: Joi.string().max(255).required(),
  modelo: Joi.string().max(255).required(),
  data_aquisicao: Joi.date().raw().allow(null),
  vida_util: Joi.number().integer().allow(null).description('Vida útil em meses')
})

models.plotterAtualizacao = Joi.object().keys({
  id: Joi.number().integer().required(),
  ativo: Joi.boolean().required(),
  nr_serie: Joi.string().max(255).required(),
  modelo: Joi.string().max(255).required(),
  data_aquisicao: Joi.date().raw().allow(null),
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
  data_manutencao: Joi.date().raw().required(),
  valor: Joi.number().precision(2).positive().required(),
  descricao: Joi.string().allow(null, '')
})

models.manutencaoPlotterAtualizacao = Joi.object().keys({
  id: Joi.number().integer().required(),
  plotter_id: Joi.number().integer().required(),
  data_manutencao: Joi.date().raw().required(),
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

const tipoMaterialBase = {
  nome: Joi.string().max(100).required(),
  descricao: Joi.string().allow(null, ''),
  estoque_minimo: Joi.number().min(0).allow(null),
  meta_anual: Joi.number().min(0).allow(null),
  ativo: Joi.boolean().default(true)
}

models.tipoMaterial = Joi.object().keys(tipoMaterialBase)

models.tipoMaterialAtualizacao = Joi.object().keys({
  id: Joi.number().integer().required(),
  ...tipoMaterialBase
})

// Esquemas para Estoque de Material
models.estoqueMaterialIds = Joi.object().keys({
  estoque_material_ids: Joi.array()
    .items(Joi.number().integer().required())
    .min(1)
    .required()
})

// quantidade aceita 0 (CHECK do banco é >= 0; consumo/transferência podem
// zerar o estoque e correções manuais precisam poder registrar zero)
models.estoqueMaterial = Joi.object().keys({
  tipo_material_id: Joi.number().integer().required(),
  quantidade: Joi.number().precision(2).min(0).required(),
  localizacao_id: Joi.number().integer().valid(...Object.values(TIPO_LOCALIZACAO)).required()
})

models.estoqueMaterialAtualizacao = Joi.object().keys({
  id: Joi.number().integer().required(),
  tipo_material_id: Joi.number().integer().required(),
  quantidade: Joi.number().precision(2).min(0).required(),
  localizacao_id: Joi.number().integer().valid(...Object.values(TIPO_LOCALIZACAO)).required()
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
  data_consumo: Joi.date().raw().required()
})

models.consumoMaterialAtualizacao = Joi.object().keys({
  id: Joi.number().integer().required(),
  tipo_material_id: Joi.number().integer().required(),
  quantidade: Joi.number().precision(2).positive().required(),
  data_consumo: Joi.date().raw().required()
})

// Esquemas para GET by ID (sem .strict(): params de URL chegam como string
// e dependem da coerção do Joi)
models.manutencaoPlotterId = Joi.object().keys({
  id: Joi.number().integer().required()
})

models.consumoMaterialId = Joi.object().keys({
  id: Joi.number().integer().required()
})

models.estoqueMaterialId = Joi.object().keys({
  id: Joi.number().integer().required()
})

models.tipoMaterialId = Joi.object().keys({
  id: Joi.number().integer().required()
})

// Esquemas para filtragem de consumo
models.consumoMaterialFiltro = Joi.object().keys({
  data_inicio: Joi.date().raw(),
  data_fim: Joi.date().raw(),
  tipo_material_id: Joi.number().integer()
})

// Esquema para transferência de material entre localizações
models.transferenciaEstoque = Joi.object()
  .keys({
    tipo_material_id: Joi.number().integer().required(),
    origem_id: Joi.number()
      .integer()
      .valid(...Object.values(TIPO_LOCALIZACAO))
      .required(),
    destino_id: Joi.number()
      .integer()
      .valid(...Object.values(TIPO_LOCALIZACAO))
      .required(),
    quantidade: Joi.number().positive().required()
  })
  .custom((value, helpers) => {
    if (value.origem_id === value.destino_id) {
      return helpers.message('Origem e destino não podem ser iguais')
    }
    return value
  })

// Esquemas de query para dashboards legados
models.mesesQuery = Joi.object().keys({
  meses: Joi.number().integer().min(1).max(60)
})

models.limiteQuery = Joi.object().keys({
  limite: Joi.number().integer().min(1).max(100)
})

// Esquema de query para consultas anuais (dashboards sem export)
models.anoQuery = Joi.object().keys({
  ano: Joi.number()
    .integer()
    .min(2000)
    .max(2100)
    .default(() => new Date().getFullYear())
})

// Esquema de query para relatórios e dashboards anuais com export
// formato=csv retorna text/csv para download
models.relatorioQuery = models.anoQuery.keys({
  formato: Joi.string().valid('json', 'csv').default('json')
})

// --- Anexos do pedido -------------------------------------------------------

// Parâmetro de rota do pedido (id) para listar/anexar anexos.
models.anexoPedidoParams = Joi.object().keys({
  id: Joi.number().integer().required()
})

// Parâmetro de rota do próprio anexo (download/remoção).
models.anexoIdParams = Joi.object().keys({
  anexoId: Joi.number().integer().required()
})

// Campos de texto do multipart no upload (validados após o multer). O arquivo
// vem no campo "arquivo"; aqui só os metadados opcionais.
models.anexoUploadBody = Joi.object().keys({
  tipo_anexo_id: Joi.number()
    .integer()
    .valid(...Object.values(TIPO_ANEXO_PEDIDO))
    .default(TIPO_ANEXO_PEDIDO.OUTROS),
  descricao: Joi.string().max(1000).allow(null, '')
})

module.exports = models