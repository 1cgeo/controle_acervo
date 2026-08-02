'use strict'

const Joi = require('joi')

const models = {}

// O RECORTE DO PERIODO E O TETO DA LISTA SAO INTEIROS POSITIVOS COM TETO.
//
// No Auth Server (`dashboard/dashboard_schema.ts`) estes dois numeros eram
// validados pelo Zod e depois COLADOS no texto do SQL, como
// `interval '$<total:raw> day'` e `LIMIT $<max:raw>`. O `:raw` do pg-promise
// desliga o formatador: o que estiver na variavel entra no SQL como esta.
// Aqui eles voltaram a ser parametro de verdade (ver `acessos_ctrl.js`), e a
// validacao deixou de ser a UNICA coisa entre a query string e o banco.
//
// O teto continua existindo, por outro motivo: `total` vira o tamanho de um
// `generate_series`, ou seja, a quantidade de linhas que a consulta MONTA antes
// de agrupar. Sem teto, `?total=999999999` e um pedido de varredura que ninguem
// precisou fazer.
//
// O DEFAULT MORA SO AQUI, e nao tambem no controlador. Dois lugares declarando
// "sao 14 dias" divergem no primeiro ajuste, e o que a tela recebe passa a
// depender de a query ter vindo vazia ou nao.
const janela = (padrao, teto) =>
  Joi.number().integer().min(1).max(teto).default(padrao)

// 366 dias: um ano bissexto inteiro. Alem disso a pergunta e outra, e a resposta
// e a serie mensal.
const TETO_DIAS = 366

// 120 meses: dez anos. O SCA nao tem historico de acesso mais antigo do que a
// propria fusao da autenticacao (2026-08-02), entao isto e folga, nao limite.
const TETO_MESES = 120

// 100 linhas de ranking. Acima disso ninguem le, e a tela pagina.
const TETO_RANKING = 100

models.loginsDiaQuery = Joi.object().keys({
  total: janela(14, TETO_DIAS)
})

models.loginsMesQuery = Joi.object().keys({
  total: janela(12, TETO_MESES)
})

models.loginsUsuariosQuery = Joi.object().keys({
  total: janela(30, TETO_DIAS),
  max: janela(10, TETO_RANKING)
})

models.loginsClientesQuery = Joi.object().keys({
  total: janela(30, TETO_DIAS)
})

module.exports = models
