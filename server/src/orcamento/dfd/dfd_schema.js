'use strict'

const Joi = require('joi')

const models = {}

models.idParams = Joi.object().keys({
  id: Joi.number().integer().required()
})

models.listarQuery = Joi.object().keys({
  ano: Joi.number().integer()
})

// Campos que o client web reenvia por vir do GET, e que o servidor ignora.
// O dialog de DFD (orcamento_client, dfd-dialog.js) carrega os itens de
// GET /dfd/:id e devolve cada item INTEIRO no PUT, incluindo a PK, a FK, o
// nome do tipo (que vem de JOIN) e as quatro colunas de auditoria. Recusar
// essas chaves deixaria a edição de qualquer DFD que já tenha item impossível,
// então elas são declaradas e descartadas com `.strip()`. É uma tolerância
// NOMEADA, não porta aberta: qualquer outra chave desconhecida no item ainda
// vira 400, então um `descrciao` errado continua sendo pego. O descarte é
// registrado no log pelo schemaValidation. Some daqui quando o client parar de
// reenviar o item inteiro.
const camposEcoDoClient = {
  id: Joi.any().strip(),
  dfd_id: Joi.any().strip(),
  tipo_item: Joi.any().strip(),
  data_cadastramento: Joi.any().strip(),
  usuario_cadastramento_uuid: Joi.any().strip(),
  data_modificacao: Joi.any().strip(),
  usuario_modificacao_uuid: Joi.any().strip()
}

const item = Joi.object().keys({
  tipo_item_id: Joi.number().integer().strict().required(),
  cod_catmat_catser: Joi.string().max(30).allow(null, ''),
  descricao: Joi.string().required(),
  quantidade: Joi.number().allow(null),
  valor_unitario: Joi.number().allow(null),
  valor_total: Joi.number().allow(null),
  ...camposEcoDoClient
})

models.criar = Joi.object().keys({
  numero: Joi.string().max(20).required(),
  ano: Joi.number().integer().strict().required(),
  rotulo: Joi.string().max(120).allow(null, ''),
  objeto: Joi.string().allow(null, ''),
  justificativa: Joi.string().allow(null, ''),
  area_requisitante: Joi.string().max(255).allow(null, ''),
  grau_prioridade_id: Joi.number().integer().strict().allow(null),
  data_prevista_conclusao: Joi.date().raw().allow(null),
  responsavel_cpf: Joi.string().max(14).allow(null, ''),
  vinculo_plano_gestao: Joi.string().max(60).allow(null, ''),
  consta_pca: Joi.boolean().strict().default(true),
  valor_estimado: Joi.number().allow(null),
  itens: Joi.array().items(item).default([])
})

models.atualizar = Joi.object().keys({
  numero: Joi.string().max(20).required(),
  ano: Joi.number().integer().strict().required(),
  rotulo: Joi.string().max(120).allow(null, ''),
  objeto: Joi.string().allow(null, ''),
  justificativa: Joi.string().allow(null, ''),
  area_requisitante: Joi.string().max(255).allow(null, ''),
  grau_prioridade_id: Joi.number().integer().strict().allow(null),
  data_prevista_conclusao: Joi.date().raw().allow(null),
  responsavel_cpf: Joi.string().max(14).allow(null, ''),
  vinculo_plano_gestao: Joi.string().max(60).allow(null, ''),
  consta_pca: Joi.boolean().strict().default(true),
  valor_estimado: Joi.number().allow(null),
  itens: Joi.array().items(item).default([])
})

module.exports = models
