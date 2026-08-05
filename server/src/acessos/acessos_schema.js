'use strict'

const Joi = require('joi')

const models = {}

// O RECORTE DO PERIODO E O TETO DA LISTA SAO INTEIROS POSITIVOS COM TETO.
//
// O teto existe porque `total` vira o tamanho de um `generate_series`, ou seja,
// a quantidade de linhas que a consulta MONTA antes de agrupar: sem ele,
// `?total=999999999` e um pedido de varredura que ninguem precisou fazer.
//
// O DEFAULT MORA SO AQUI, e nao tambem no controlador. Dois lugares declarando
// "sao 14 dias" divergem no primeiro ajuste, e o que a tela recebe passa a
// depender de a query ter vindo vazia ou nao.
const janela = (padrao, teto) =>
  Joi.number().integer().min(1).max(teto).default(padrao)

// 366 dias: um ano bissexto inteiro.
const TETO_DIAS = 366

// 100 linhas de ranking. Acima disso ninguem le, e a tela pagina.
const TETO_RANKING = 100

models.loginsDiaQuery = Joi.object().keys({
  total: janela(14, TETO_DIAS)
})

models.loginsUsuariosQuery = Joi.object().keys({
  total: janela(30, TETO_DIAS),
  max: janela(10, TETO_RANKING)
})

module.exports = models
