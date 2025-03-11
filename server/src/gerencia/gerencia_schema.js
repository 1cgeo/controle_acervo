// Path: gerencia\gerencia_schema.js
'use strict'

const Joi = require('joi')

const models = {}

models.paginationParams = Joi.object().keys({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20)
  });  

module.exports = models
