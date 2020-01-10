'use strict'

const Joi = require('joi')

const models = {}

models.idParams = Joi.object().keys({
  id: Joi.number()
    .integer()
    .required()
})

models.volume = Joi.object().keys({
  tipo_produto_id: Joi.number().integer().strict().required(),
  volume: Joi.string().required(),
  primario: Joi.boolean().strict()
})

module.exports = models
