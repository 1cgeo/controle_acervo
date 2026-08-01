// Path: orcamento\dashboard\dashboard_schema.js
'use strict'

const Joi = require('joi')

const models = {}

// Ano de contexto e mês de corte. SEM a chave `cumulativo` que a rota antiga
// (/orcamento/relatorio/secao3) aceitava: o painel só faz uma pergunta,
// "quanto do crédito do ANO já foi executado até este mês", e nenhuma tela
// mandava `cumulativo: false`. Uma chave que só tem um valor usado é uma porta
// aberta para um painel que ninguém sabe explicar.
models.execucaoNdQuery = Joi.object().keys({
  ano: Joi.number().integer().required(),
  mes: Joi.number().integer().min(1).max(12).required()
})

module.exports = models
