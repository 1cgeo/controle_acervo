// Path: dashboard\dashboard_schema.js
'use strict'

const Joi = require('joi')

const models = {}

models.totalQuery = Joi.object().keys({
  total: Joi.number()
    .integer()
})

models.totalMaxQuery = Joi.object().keys({
  total: Joi.number()
    .integer(),
  max: Joi.number()
    .integer()
})

// New schemas for dashboard extensions
models.timelineParams = Joi.object().keys({
  months: Joi.number()
    .integer()
    .min(1)
    .max(60)
    .default(12)
})

models.limitParam = Joi.object().keys({
  limit: Joi.number()
    .integer()
    .min(1)
    .max(100)
    .default(10)
})

module.exports = models