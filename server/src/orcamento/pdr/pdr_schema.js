'use strict'

const Joi = require('joi')

const models = {}

models.idParams = Joi.object().keys({
  id: Joi.number().integer().required()
})

models.listarQuery = Joi.object().keys({
  ano: Joi.number().integer()
})

// Um item do PDR (o PDR e o conjunto dos itens do ano; nao ha cabeçalho).
const campos = {
  ano: Joi.number().integer().strict().required(),
  cod_nd: Joi.string().max(6).required(),
  meta_pit_id: Joi.number().integer().strict().allow(null),
  item_label: Joi.string().max(10).allow(null, ''),
  descricao: Joi.string().allow(null, ''),
  gnd: Joi.number().integer().strict().valid(3, 4).allow(null),
  valor_solicitado: Joi.number().allow(null),
  valor_autorizado: Joi.number().allow(null),
  observacao: Joi.string().allow(null, '')
}

models.criar = Joi.object().keys(campos)
models.atualizar = Joi.object().keys(campos)

module.exports = models
