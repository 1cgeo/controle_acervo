// Path: orcamento\dominio\dominio_schema.js
'use strict'

const Joi = require('joi')

const models = {}

// O `code` e a chave dos dominios editaveis (informado pelo usuario).
models.codeParams = Joi.object().keys({
  code: Joi.string().max(20).required()
})

// Natureza de Despesa: grupo (custeio/capital) e derivado do GND no controller.
models.naturezaDespesaCriar = Joi.object().keys({
  code: Joi.string().max(6).required(),
  nome: Joi.string().max(255).required(),
  gnd: Joi.number().integer().strict().valid(3, 4).required()
})

models.naturezaDespesaAtualizar = Joi.object().keys({
  nome: Joi.string().max(255).required(),
  gnd: Joi.number().integer().strict().valid(3, 4).required()
})

// Plano Interno.
models.planoInternoCriar = Joi.object().keys({
  code: Joi.string().max(20).required(),
  nome: Joi.string().max(255).required(),
  alinea: Joi.string().length(1).allow(null, '')
})

models.planoInternoAtualizar = Joi.object().keys({
  nome: Joi.string().max(255).required(),
  alinea: Joi.string().length(1).allow(null, '')
})

// Unidade Gestora emitente.
models.ugCriar = Joi.object().keys({
  code: Joi.string().max(10).required(),
  nome: Joi.string().max(255).required()
})

models.ugAtualizar = Joi.object().keys({
  nome: Joi.string().max(255).required()
})

module.exports = models
