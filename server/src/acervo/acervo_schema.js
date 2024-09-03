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

models.versoesHistoricas = Joi.array().items(
  Joi.object().keys({
    uuid_versao: Joi.string().uuid().allow(null).required(),
    versao: Joi.string().required(),
    nome: Joi.string().allow(null).required(),  
    produto_id: Joi.number().integer().strict().required(),
    lote_id: Joi.number().integer().strict().allow(null).required(),
    metadado: Joi.object().required(),
    descricao: Joi.string().allow('').required(),
    data_criacao: Joi.date().required(),
    data_edicao: Joi.date().required()
  })
  .required()
  .min(1)
)

models.produtosVersoesHistoricas = Joi.array().items(
  Joi.object().keys({
    produto: Joi.object().keys({
      nome: Joi.string().allow(null).required(),
      mi: Joi.string().allow(null),
      inom: Joi.string().allow(null),
      tipo_escala_id: Joi.number().integer().strict().required(),
      denominador_escala_especial: Joi.number().integer().strict().allow(null).required(),
      tipo_produto_id: Joi.number().integer().strict().required(),
      descricao: Joi.string().allow('').required(),
      geom: Joi.string().required()
    }).required(),
    versao: Joi.object().keys({
      uuid_versao: Joi.string().uuid().allow(null).required(),
      versao: Joi.string().required(),
      nome: Joi.string().allow(null).required(),
      lote_id: Joi.number().integer().strict().allow(null).required(),
      metadado: Joi.object().required(),
      descricao: Joi.string().allow('').required(),
      data_criacao: Joi.date().required(),
      data_edicao: Joi.date().required()
    }).required()
  })
).required().min(1)

models.produtos = Joi.object().keys({
  produtos: Joi.array().items(
    Joi.object().keys({
      nome: Joi.string().allow(null).required(),
      mi: Joi.string().allow(null).required(),
      inom: Joi.string().allow(null).required(),
      tipo_escala_id: Joi.number().integer().strict().required(),
      denominador_escala_especial: Joi.number().integer().strict().allow(null).required(),
      tipo_produto_id: Joi.number().integer().required(),
      descricao: Joi.string().allow(null).required(),
      geom: Joi.string().required()
    })
  ).min(1).required()
})



module.exports = models
