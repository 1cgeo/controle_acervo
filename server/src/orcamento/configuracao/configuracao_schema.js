'use strict'

const Joi = require('joi')

const models = {}

// O `ano_referencia` saiu em 2026-08-04: o ano deixou de ser configuracao do
// modulo e virou filtro de cada tela. Quem ainda enviar o campo recebe 200 com
// o aviso de descarte do `schemaValidation` (stripUnknown), e nada e gravado.
models.atualizar = Joi.object().keys({
  uasg: Joi.string().max(10).allow(null, ''),
  codom: Joi.string().max(10).allow(null, '')
})

module.exports = models
