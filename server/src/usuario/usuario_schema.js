// Path: usuario\usuario_schema.js
'use strict'

const Joi = require('joi')

const models = {}

models.uuidParams = Joi.object().keys({
  uuid: Joi.string().guid().required()
})

models.listaUsuario = Joi.object().keys({
  usuarios: Joi.array()
    .items(Joi.string().guid().required())
    .unique()
    .required()
    .min(1)
})

// Mapa modulo -> nivel (1 consulta, 2 operador, 3 gerente). null REMOVE o
// acesso da pessoa aquele modulo. Modulo omitido fica como esta.
const perfisPorModulo = Joi.object().pattern(
  Joi.string(),
  Joi.number().integer().min(1).max(3).allow(null)
)

models.updateUsuario = Joi.object().keys({
  administrador: Joi.boolean().strict().required(),
  ativo: Joi.boolean().strict().required(),
  perfis: perfisPorModulo
})

models.updateUsuarioLista = Joi.object().keys({
  usuarios: Joi.array()
    .items(
      Joi.object().keys({
        uuid: Joi.string().guid().required(),
        administrador: Joi.boolean().strict().required(),
        ativo: Joi.boolean().strict().required(),
        perfis: perfisPorModulo
      })
    )
    .unique('uuid')
    .required()
    .min(1)
})

module.exports = models
