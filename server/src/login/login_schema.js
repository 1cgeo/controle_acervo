'use strict'

const Joi = require('joi')

const models = {}

models.login = Joi.object().keys({
  usuario: Joi.string().required(),
  senha: Joi.string().required(),
  cliente: Joi.string().required().valid('sca_qgis', 'sca_web')
})

module.exports = models
