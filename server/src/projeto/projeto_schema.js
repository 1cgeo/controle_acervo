// Path: projeto\projeto_schema.js
"use strict";

const Joi = require("joi");

const models = {};

models.projeto = Joi.object().keys({
  nome: Joi.string().required(),
  descricao: Joi.string().allow('').required(),
  data_inicio: Joi.date().required(),
  data_fim: Joi.date().allow(null).required(),
  status_execucao_id: Joi.number().integer().strict().required()
});

models.projetoAtualizacao = Joi.object().keys({
  id: Joi.number().integer().strict().required(),
  nome: Joi.string().required(),
  descricao: Joi.string().allow('').required(),
  data_inicio: Joi.date().required(),
  data_fim: Joi.date().allow(null).required(),
  status_execucao_id: Joi.number().integer().strict().required()
});

models.projetoIds = Joi.object().keys({
  projeto_ids: Joi.array()
    .items(Joi.number().integer().strict().required())
    .unique()
    .required()
    .min(1)
});

models.lote = Joi.object().keys({
  projeto_id: Joi.number().integer().strict().required(),
  pit: Joi.string().required(),
  nome: Joi.string().required(),
  descricao: Joi.string().allow('').optional(),
  data_inicio: Joi.date().required(),
  data_fim: Joi.date().allow(null).required(),
  status_execucao_id: Joi.number().integer().strict().required()
});

models.loteAtualizacao = Joi.object().keys({
  id: Joi.number().integer().strict().required(),
  projeto_id: Joi.number().integer().strict().required(),
  pit: Joi.string().required(),
  nome: Joi.string().required(),
  descricao: Joi.string().allow('').optional(),
  data_inicio: Joi.date().required(),
  data_fim: Joi.date().allow(null).required(),
  status_execucao_id: Joi.number().integer().strict().required()
});

models.loteIds = Joi.object().keys({
  lote_ids: Joi.array()
    .items(Joi.number().integer().strict().required())
    .unique()
    .required()
    .min(1)
});

module.exports = models;
