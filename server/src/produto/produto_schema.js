"use strict";

const Joi = require("joi");

const models = {};

models.produto = Joi.object().keys({
  nome: Joi.string().required(),
  uuid_produto: Joi.string().uuid(),
  uuid_versao: Joi.string().uuid(),
  data_criacao: Joi.date().iso().required(),
  data_edicao: Joi.date().iso().required(),
  mi: Joi.string(),
  inom: Joi.string(),
  denominador_escala: Joi.number().integer(),
  tipo_produto_id: Joi.number().integer().required(),
  situacao_bdgex_id: Joi.number().integer().required(),
  orgao_produtor: Joi.string().required(),
  descricao: Joi.string().allow('').optional(),
  geom: Joi.string().required(),
  arquivos: Joi.array().items(
    Joi.object().keys({
      volume_armazenamento_id: Joi.number().integer().required(),
      nome: Joi.string().required(),
      descricao: Joi.string().allow('').optional(),
      extensao: Joi.string().required(),
      tamanho_mb: Joi.number().required()
    })
  )
})

models.produtoAtualizacao = Joi.object().keys({
  id: Joi.number().integer().strict().required(),
  nome: Joi.string().required(),
  uuid_produto: Joi.string().uuid(),
  uuid_versao: Joi.string().uuid(),
  data_criacao: Joi.date().iso().required(),
  data_edicao: Joi.date().iso().required(),
  mi: Joi.string(),
  inom: Joi.string(),
  denominador_escala: Joi.number().integer(),
  tipo_produto_id: Joi.number().integer().required(),
  situacao_bdgex_id: Joi.number().integer().required(),
  orgao_produtor: Joi.string().required(),
  descricao: Joi.string().allow('').optional(),
  geom: Joi.string().required()
})

models.produtoIds = Joi.object().keys({
  produto_ids: Joi.array()
    .items(Joi.number().integer().strict().required())
    .unique()
    .required()
    .min(1)
})

models.arquivoIds = Joi.object().keys({
  arquivo_ids: Joi.array()
    .items(Joi.number().integer().strict().required())
    .unique()
    .required()
    .min(1)
})

module.exports = models;
