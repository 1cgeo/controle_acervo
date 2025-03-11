// Path: acervo\acervo_schema.js
'use strict'

const Joi = require('joi')

const models = {}

models.produtoByTipoParams = Joi.object().keys({
  tipo_produto_id: Joi.number().integer().strict().required()
});

models.produtoByTipoQuery = Joi.object().keys({
  projeto_id: Joi.number().integer().strict().optional(),
  lote_id: Joi.number().integer().strict().optional()
});

models.produtoByIdParams = Joi.object().keys({
  produto_id: Joi.number().integer().strict().required()
});

models.arquivosIds = Joi.object().keys({
  arquivos_ids: Joi.array()
    .items(
      Joi.number()
        .integer()
        .strict()
        .required()
    )
    .required()
    .min(1)
    .unique()
})

models.produtosIds = Joi.object().keys({
  produtos_ids: Joi.array()
    .items(
      Joi.number()
        .integer()
        .strict()
        .required()
    )
    .required()
    .min(1)
    .unique()
})

module.exports = models
