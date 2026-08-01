'use strict'

const Joi = require('joi')

const models = {}

// Query do gerador: ano e mês de corte, sempre os dois.
//
// SEM a chave `cumulativo` que a antiga rota do orçamento tinha. Ela oferecia
// escolher entre "só o mês" e "acumulado no ano", e o RPCMTec não tem essa
// escolha: cada subseção já sabe qual dos dois recortes é o seu (a 2.4 lista o
// MÊS, a 3.1 mostra os dois lado a lado, a 4.1 é sempre acumulada no ano). Uma
// chave global sobrepondo isso só conseguia gerar um relatório que não fecha
// com nenhuma edição real.
models.gerarQuery = Joi.object().keys({
  ano: Joi.number().integer().required(),
  mes: Joi.number().integer().min(1).max(12).required()
})

// Parâmetro de rota: id da edição mensal (BIGSERIAL). Coerção numérica, que na
// URL o valor chega como string.
models.idParams = Joi.object().keys({
  id: Joi.number().integer().required()
})

// Listagem da edição mensal: filtro opcional por ano.
models.listarQuery = Joi.object().keys({
  ano: Joi.number().integer()
})

// Criação e atualização da edição mensal. A UNIQUE (ano, mes) vira 409 no ctrl.
const camposBase = {
  ano: Joi.number().integer().strict().required(),
  mes: Joi.number().integer().min(1).max(12).required(),
  assinante: Joi.string().max(255).allow(null, ''),
  // .raw() preserva 'YYYY-MM-DD' sem passar por Date UTC; sem ele, grava o dia
  // anterior em UTC-3.
  data_assinatura: Joi.date().raw().allow(null)
}

models.criar = Joi.object().keys({ ...camposBase })
models.atualizar = Joi.object().keys({ ...camposBase })

module.exports = models
