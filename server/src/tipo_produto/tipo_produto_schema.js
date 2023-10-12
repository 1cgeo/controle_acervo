'use strict'

const Joi = require('joi')

const models = {}

models.tipoProduto = Joi.object().keys({
  tipo_produto: Joi.array()
    .items(
      Joi.object().keys({
        nome: Joi.string().required()
      })
    )
    .required()
    .min(1)
})

models.tipoProdutoAtualizacao = Joi.object().keys({
  tipo_produto: Joi.array()
    .items(
      Joi.object().keys({
        id: Joi.number().integer().strict().required(),
        nome: Joi.string().required()
      })
    )
    .required()
    .min(1)
})

models.tipoProdutoIds = Joi.object().keys({
  tipo_produto_ids: Joi.array()
    .items(Joi.number().integer().strict().required())
    .unique()
    .required()
    .min(1)
})

module.exports = models
