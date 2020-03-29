"use strict";

const Joi = require("joi");

const models = {};

models.idParams = Joi.object().keys({
  id: Joi.number()
    .integer()
    .required()
});

models.produtos = Joi.object().keys({
  produtos: Joi.array()
    .items(
      Joi.object().keys({
        uuid: Joi.string()
          .guid({ version: "uuidv4" })
          .required()
          .allow(""),
        nome: Joi.string()
          .required()
          .allow(""),
        mi: Joi.string()
          .required()
          .allow(""),
        inom: Joi.string()
          .required()
          .allow(""),
        denominador_escala: Joi.string()
          .required()
          .allow(""),
        data_produto: Joi.date().required(),
        orgao_produtor: Joi.string().required(),
        observacao: Joi.string()
          .required()
          .allow(""),
        tipo_produto_id: Joi.number()
          .integer()
          .required(),
        situacao_bdgex_id: Joi.number()
          .integer()
          .required(),
        geom: Joi.string().required(),
        arquivos: Joi.array()
          .items(
            Joi.object().keys({
              nome: Joi.string()
                .required()
                .allow(""),
              extensao: Joi.string()
                .required()
                .allow(""),
              tamanho_mb: Joi.number().required(),
              metadado: Joi.boolean().required()
            })
          )
          .required()
          .min(1)
      })
    )
    .required()
    .min(1)
});

module.exports = models;
