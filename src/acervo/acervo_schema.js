'use strict'

const Joi = require('joi')

const models = {}

models.arquivosIds = Joi.object().keys({
  arquivos_id: Joi.array()
    .items(
      Joi.number()
        .integer()
        .strict()
        .required()
    )
    .required()
})

models.mvtParams = Joi.object().keys({
  produto_id: Joi.string().required(),
  x: Joi.number()
    .integer()
    .required(),
  y: Joi.number()
    .integer()
    .required(),
  z: Joi.number()
    .integer()
    .required()
})

module.exports = models
