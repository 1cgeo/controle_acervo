'use strict'

const Joi = require('joi')

const models = {}

// SEM `ano_referencia`: o ano nao e configuracao do modulo, e sim filtro de cada
// tela. Quem enviar o campo recebe 400.
//
// O `schemaValidation` das rotas do orcamento e o ESTRITO
// (`utils/schema_validation_estrito.js`, escolhido por `orcamento/utils`), que
// RECUSA chave desconhecida com a sugestao do nome mais parecido. O irmao de
// mesmo nome em `utils/schema_validation.js`, que descarta em silencio, vale
// para o acervo e a mapoteca, e NAO para este arquivo.
models.atualizar = Joi.object().keys({
  uasg: Joi.string().max(10).allow(null, ''),
  codom: Joi.string().max(10).allow(null, '')
})

module.exports = models
