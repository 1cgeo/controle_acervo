// Path: produto\produto_schema.js
"use strict";

const Joi = require("joi");

const models = {};

models.produtoAtualizacao = Joi.object().keys({
  id: Joi.number().integer().strict().strict().required(),
  nome: Joi.string().required(),
  mi: Joi.string(),
  inom: Joi.string(),
  tipo_escala_id: Joi.number().integer().strict().required(),
  denominador_escala_especial: Joi.number().integer().strict().allow(null).required(),
  tipo_produto_id: Joi.number().integer().strict().required(),
  descricao: Joi.string().allow('').required()
})

models.versaoAtualizacao = Joi.object().keys({
  id: Joi.number().integer().strict().required(),
  uuid_versao: Joi.string().uuid().required(),
  versao: Joi.string().required(),
  descricao: Joi.string().allow('').required(),
  metadado: Joi.object().required(),
  lote_id: Joi.number().integer().strict().required(),
  data_criacao: Joi.date().required(),
  data_edicao: Joi.date().required()
});

models.arquivoAtualizacao = Joi.object().keys({
  id: Joi.number().integer().strict().required(),
  nome: Joi.string().required(),
  tipo_arquivo_id: Joi.number().integer().strict().required(),
  volume_armazenamento_id: Joi.number().integer().strict().required(),
  metadado: Joi.object().required(),
  situacao_bdgex_id: Joi.number().integer().strict().required(),
  orgao_produtor: Joi.string().required(),
  descricao: Joi.string().allow('').required()
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

models.versaoRelacionamento = Joi.object().keys({
  versao_relacionamento: Joi.array()
    .items(
      Joi.object().keys({
        versao_id_1: Joi.number().integer().strict().required(),
        versao_id_2: Joi.number().integer().strict().required(),
        tipo_relacionamento_id: Joi.number().integer().strict().required()
      })
    )
    .required()
    .min(1)
});

models.versaoRelacionamentoAtualizacao = Joi.object().keys({
  versao_relacionamento: Joi.array()
    .items(
      Joi.object().keys({
        id: Joi.number().integer().strict().required(),
        versao_id_1: Joi.number().integer().strict().required(),
        versao_id_2: Joi.number().integer().strict().required(),
        tipo_relacionamento_id: Joi.number().integer().strict().required(),
      })
    )
    .required()
    .min(1)
});

models.versaoRelacionamentoIds = Joi.object().keys({
  versao_relacionamento_ids: Joi.array()
    .items(Joi.number().integer().strict().required())
    .unique()
    .required()
    .min(1)
});

module.exports = models;
