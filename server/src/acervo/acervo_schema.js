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
    .min(1)
})

models.produtosId = Joi.object().keys({
  produtos_id: Joi.array()
    .items(
      Joi.number()
        .integer()
        .strict()
        .required()
    )
    .required()
    .min(1)
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

models.paginacaoQuery = Joi.object().keys({
  pagina: Joi.number().integer().min(1),
  total_pagina: Joi.number().integer().min(5),
  coluna_ordem: Joi.string().allow(''),
  direcao_ordem: Joi.string().valid('asc', 'desc', ''),
  filtro: Joi.string().allow('')
})

module.exports = models
