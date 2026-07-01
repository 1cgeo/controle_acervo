// Path: relatorio\relatorio_schema.js
'use strict'

const Joi = require('joi')

const models = {}

// Query do gerador do RPCMTec (seção acervo): ano e mês de corte. As tabelas
// sempre mostram mês e ano lado a lado (sem alternância "cumulativo").
models.rpcmtecQuery = Joi.object().keys({
  ano: Joi.number().integer().required(),
  mes: Joi.number().integer().min(1).max(12).required()
})

module.exports = models
