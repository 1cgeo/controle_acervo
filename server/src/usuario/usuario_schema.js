"use strict";

const Joi = require("joi");

const models = {};

models.uuidParams = Joi.object().keys({
  uuid: Joi.string()
    .guid({ version: "uuidv4" })
    .required()
});

models.listaUsuario = Joi.object().keys({
  usuarios: Joi.array()
    .items(
      Joi.string()
        .guid({ version: "uuidv4" })
        .required()
    )
    .required()
    .min(1)
});

models.updateUsuario = Joi.object().keys({
  administrador: Joi.boolean().strict(),
  ativo: Joi.boolean().strict()
});

models.updateUsuarioLista = Joi.object().keys({
  usuarios: Joi.array()
    .items(
      Joi.object().keys({
        uuid: Joi.string()
          .guid({ version: "uuidv4" })
          .required(),
        administrador: Joi.boolean()
          .strict()
          .required(),
        ativo: Joi.boolean()
          .strict()
          .required()
      })
    )
    .required()
    .min(1)
});

module.exports = models;
