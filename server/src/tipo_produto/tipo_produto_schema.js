'use strict'

const Joi = require('joi')

const models = {}

models.idParams = Joi.object().keys({
  id: Joi.number()
    .integer()
    .required()
})

models.produto = Joi.object().keys({
  nome: Joi.string().required()
})

module.exports = models
