// Path: limites\limites_schema.js
'use strict'

const Joi = require('joi')

const models = {}

// O tipo vai na URL como PALAVRA, e nao como codigo: '/estado/43' e
// '/municipio/4314902' se leem no log e num link. Mesma escolha do download do
// ponto de controle ('/pacote', '/monografia').
//
// A FAIXA do id valida a forma do codigo do IBGE, e nao a lista que existe hoje:
// 2 digitos no estado, 7 no municipio. Codigo fora da forma para em 400, e o
// que existe mesmo quem decide e o banco, com 404.
models.limiteParams = Joi.object().keys({
  tipo: Joi.string().valid('estado', 'municipio').required(),
  id: Joi.number().integer().min(10).max(9999999).required()
})

module.exports = models
