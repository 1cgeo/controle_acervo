// Path: acervo\acervo_schema.js
'use strict'

const Joi = require('joi')

const models = {}

models.produtoByIdParams = Joi.object().keys({
  produto_id: Joi.number().integer().strict().required()
});

models.versaoByIdParams = Joi.object().keys({
  versao_id: Joi.number().integer().strict().required()
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

models.situacaoGeralQuery = Joi.object().keys({
  scale25k: Joi.boolean().default(false),
  scale50k: Joi.boolean().default(false),
  scale100k: Joi.boolean().default(false),
  scale250k: Joi.boolean().default(false)
});

models.buscaProdutos = Joi.object().keys({
  termo: Joi.string().allow(''),
  tipo_produto_id: Joi.number().integer(),
  tipo_escala_id: Joi.number().integer(),
  projeto_id: Joi.number().integer(),
  lote_id: Joi.number().integer(),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20)
});

module.exports = models
