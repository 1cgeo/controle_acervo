"use strict";

const Joi = require("joi");

const models = {};

models.idParams = Joi.object().keys({
  id: Joi.number()
    .integer()
    .required()
});

models.volume = Joi.object().keys({
  volume: Joi.string().required()
});

models.volumeTipoProduto = Joi.object().keys({
  tipo_produto_id: Joi.number()
    .integer()
    .strict()
    .required(),
  volume_armazenamento_id: Joi.number()
    .integer()
    .strict()
    .required(),
  primario: Joi.boolean()
    .strict()
    .required()
});

module.exports = models;
