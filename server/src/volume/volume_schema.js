"use strict";

const Joi = require("joi");

const models = {};
models.volumeArmazenamento = Joi.object().keys({
  volume_armazenamento: Joi.array()
    .items(
      Joi.object().keys({
        volume: Joi.string().required(),
        capacidade_mb: Joi.number().strict().required()
      })
    )
    .required()
    .min(1)
})

models.volumeArmazenamentoAtualizacao = Joi.object().keys({
  volume_armazenamento: Joi.array()
    .items(
      Joi.object().keys({
        id: Joi.number().integer().strict().required(),
        volume: Joi.string().required(),
        capacidade_mb: Joi.number().strict().required()
      })
    )
    .required()
    .min(1)
})

models.volumeArmazenamentoIds = Joi.object().keys({
  volume_armazenamento_ids: Joi.array()
    .items(Joi.number().integer().strict().required())
    .unique()
    .required()
    .min(1)
})

models.volumeTipoProduto = Joi.object().keys({
  volume_tipo_produto: Joi.array()
    .items(
      Joi.object().keys({
        tipo_produto_id: Joi.number().integer().strict().required(),
        volume_armazenamento_id: Joi.number().integer().strict().required(),
        primario: Joi.boolean().strict().required()
      })
    )
    .required()
    .min(1)
})

models.volumeTipoProdutoAtualizacao = Joi.object().keys({
  volume_tipo_produto: Joi.array()
    .items(
      Joi.object().keys({
        id: Joi.number().integer().strict().required(),
        tipo_produto_id: Joi.number().integer().strict().required(),
        volume_armazenamento_id: Joi.number().integer().strict().required(),
        primario: Joi.boolean().strict().required()
      })
    )
    .required()
    .min(1)
})

models.volumeTipoProdutoIds = Joi.object().keys({
  volume_tipo_produto_ids: Joi.array()
    .items(Joi.number().integer().strict().required())
    .unique()
    .required()
    .min(1)
})

module.exports = models;
