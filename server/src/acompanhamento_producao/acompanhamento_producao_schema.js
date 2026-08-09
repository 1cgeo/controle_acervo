'use strict'

const Joi = require('joi')

const models = {}

// O id de rota. `.positive()` porque SERIAL e BIGSERIAL comecam em 1, e um `/0`
// ou um `/-3` sao erro de quem chamou, nao um 404 depois de ir ao banco.
const id = () => Joi.number().integer().positive()

// O ANO do plano. NAO e `Joi.date()`: aqui o valor e um inteiro de quatro
// digitos que vai para `EXTRACT(YEAR FROM ...)`, e nao um dia de calendario.
// O piso de 1900 e o teto de 2100 existem para o `/pit/abc` e o `/pit/20260`
// morrerem no Joi, e nao num `generate_series` de mil e cem linhas.
const ano = () => Joi.number().integer().min(1900).max(2100)

models.loteParams = Joi.object().keys({
  lote: id().required()
})

models.loteSubfaseParams = Joi.object().keys({
  lote: id().required(),
  subfase: id().required()
})

models.anoParams = Joi.object().keys({
  ano: ano().required()
})

models.projetoParams = Joi.object().keys({
  id: id().required()
})

models.projetoAnoParams = Joi.object().keys({
  id: id().required(),
  ano: ano().required()
})

models.finalizadoQuery = Joi.object().keys({
  finalizado: Joi.boolean()
})

// O NOME DA CAMADA DE ACOMPANHAMENTO, e ele e o unico texto deste modulo que
// chega perto de ser interpolado no SQL.
//
// As views do schema `acompanhamento` sao GERADAS em tempo de execucao pelos
// gatilhos de `er/acompanhamento_producao.sql`, uma por par (lote, linha de
// producao) e outra por (lote, subfase), mais a `bloco`, que e unica. Nao ha
// catalogo de nomes a consultar: o nome se monta por concatenacao dos ids.
//
// Por isso a forma e cobrada AQUI, com uma expressao regular ancorada, antes de
// qualquer ida ao banco. O controlador ainda confere a EXISTENCIA em
// `pg_matviews` -- as duas conferencias respondem perguntas diferentes, e
// nenhuma substitui a outra: esta impede um identificador arbitrario de chegar
// ao `$<...:raw>`, e a de la impede o 500 de "relation does not exist" quando o
// nome e valido mas a view ainda nao nasceu.
const NOME_CAMADA = /^(bloco|lote_[0-9]+_linha_[0-9]+|lote_[0-9]+_subfase_[0-9]+)$/

models.nomeParams = Joi.object().keys({
  nome: Joi.string()
    .pattern(NOME_CAMADA)
    .required()
    .messages({
      'string.pattern.base':
        'Nome de camada de acompanhamento inválido. São aceitos "bloco", ' +
        '"lote_<lote>_linha_<linha_producao>" e "lote_<lote>_subfase_<subfase>"'
    })
})

// A TILE VECTORIAL. `z`, `x` e `y` sao a grade XYZ padrao, e o `y` chega com a
// extensao `.pbf` colada pelo caminho da rota -- quem a retira e o Express, que
// casa `.pbf` como texto literal depois do parametro.
//
// O TETO DE ZOOM E 22, e o piso 0: fora disso `ST_TileEnvelope` recusa com erro
// de PostGIS, que viraria 500. `x` e `y` nao tem teto declarado aqui porque o
// teto deles DEPENDE de `z` (2^z - 1), e essa e a conferencia do proximo
// paragrafo -- declarar um teto fixo aceitaria (z=1, x=1000) e recusaria nada.
models.mvtParams = Joi.object()
  .keys({
    id: id().required(),
    z: Joi.number().integer().min(0).max(22).required(),
    x: Joi.number().integer().min(0).required(),
    y: Joi.number().integer().min(0).required()
  })
  .custom((valor, helpers) => {
    const limite = Math.pow(2, valor.z)
    if (valor.x >= limite || valor.y >= limite) {
      return helpers.error('any.invalid')
    }
    return valor
  })
  .messages({
    'any.invalid': 'Coordenada de tile fora da grade do nível de zoom informado'
  })

module.exports = models
