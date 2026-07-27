// Path: orcamento\configuracao\configuracao_schema.js
'use strict'

const Joi = require('joi')

const models = {}

models.atualizar = Joi.object().keys({
  uasg: Joi.string().max(10).allow(null, ''),
  codom: Joi.string().max(10).allow(null, ''),
  ano_referencia: Joi.number().integer().strict().allow(null)
})

module.exports = models
