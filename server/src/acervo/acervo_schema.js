// Path: acervo\acervo_schema.js
'use strict'

const Joi = require('joi')

const models = {}

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

models.produtosIdsComTipos = Joi.object().keys({
  produtos_ids: Joi.array()
    .items(
      Joi.number()
        .integer()
        .strict()
        .required()
    )
    .required()
    .min(1)
    .unique(),
  tipos_arquivo: Joi.array()
    .items(
      Joi.number()
        .integer()
        .strict()
        .required()
    )
    .required()
    .min(1)
    .unique()
});

models.downloadConfirmations = Joi.object().keys({
  confirmations: Joi.array()
    .items(
      Joi.object().keys({
        download_token: Joi.string().uuid().required(),
        success: Joi.boolean().required(),
        error_message: Joi.string().allow(null, '')
      })
    )
    .required()
    .min(1)
});

module.exports = models
