"use strict";

const Joi = require("joi");

const models = {};

models.produtoAtualizacao = Joi.object().keys({
  id: Joi.number().integer().strict().required(),
  nome: Joi.string().required(),
  mi: Joi.string(),
  inom: Joi.string(),
  denominador_escala: Joi.number().integer(),
  tipo_produto_id: Joi.number().integer().required(),
  descricao: Joi.string().allow('').optional()
})

models.versaoAtualizacao = Joi.object().keys({
  id: Joi.number().integer().strict().required(),
  versao: Joi.string().required(),
  descricao: Joi.string().allow('').optional(),
  data_criacao: Joi.date().required(),
  data_edicao: Joi.date().required()
});

models.arquivoAtualizacao = Joi.object().keys({
  id: Joi.number().integer().strict().required(),
  nome: Joi.string().required(),
  tipo_arquivo_id: Joi.number().integer().required(),
  volume_armazenamento_id: Joi.number().integer().required(),
  metadata: Joi.object().optional(),
  situacao_bdgex_id: Joi.number().integer().required(),
  orgao_produtor: Joi.string().required(),
  descricao: Joi.string().allow('').optional()
});

models.produtoIds = Joi.object().keys({
  produto_ids: Joi.array()
    .items(Joi.number().integer().strict().required())
    .unique()
    .required()
    .min(1),
  motivo_exclusao: Joi.string().required()
})

models.versaoIds = Joi.object().keys({
  versao_ids: Joi.array()
    .items(Joi.number().integer().strict().required())
    .unique()
    .required()
    .min(1),
  motivo_exclusao: Joi.string().required()
});

models.arquivoIds = Joi.object().keys({
  arquivo_ids: Joi.array()
    .items(Joi.number().integer().strict().required())
    .unique()
    .required()
    .min(1),
  motivo_exclusao: Joi.string().required()
});

module.exports = models;
