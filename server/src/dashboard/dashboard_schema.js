'use strict'

const Joi = require('joi')

const models = {}

// Quantas linhas as listas "ultimos/ultimas" devolvem. O DEFAULT 10 e o valor
// que as tres consultas ja tinham fixo no SQL, entao quem nao manda `total`
// continua recebendo o mesmo. O teto existe porque a lista e de tela e de CLI, e
// LIMIT sem teto vindo da URL e varredura de tabela a pedido de quem chamar.
models.totalQuery = Joi.object().keys({
  total: Joi.number()
    .integer()
    .min(1)
    .max(100)
    .default(10)
})

models.timelineParams = Joi.object().keys({
  months: Joi.number()
    .integer()
    .min(1)
    .max(60)
    .default(12)
})

models.limitParam = Joi.object().keys({
  limit: Joi.number()
    .integer()
    .min(1)
    .max(100)
    .default(10)
})

module.exports = models