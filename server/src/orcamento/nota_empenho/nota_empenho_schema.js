'use strict'

const Joi = require('joi')

const models = {}

// Parametro de rota: id da NE (BIGSERIAL). Coercao numerica (vem como string na URL).
models.idParams = Joi.object().keys({
  id: Joi.number().integer().required()
})

// Query da listagem: filtros opcionais por nota de credito e por ano.
models.listarQuery = Joi.object().keys({
  nota_credito_id: Joi.number().integer(),
  ano: Joi.number().integer()
})

// Item do rateio NE-NC (forma nova): uma NC e o valor empenhado contra ela.
const ncAlocacao = Joi.object().keys({
  nota_credito_id: Joi.number().integer().strict().required(),
  valor: Joi.number().positive().strict().required()
})

// Campos comuns de criacao/atualizacao da NE.
//
// Regras de negocio centrais (ver tambem o ctrl):
//   * a NE empenha contra uma ou mais NCs. A ND, o PI e o GND sao herdados da NC,
//     entao a NE nao tem esses campos nem licitacao. Por regra todas as NCs de
//     uma NE tem a mesma ND e classificacao (validado no ctrl).
//   * Duas formas de informar as NCs (exatamente uma):
//       - legada: nota_credito_id + valor_empenhado (uma NC); ou
//       - notas_credito: [{nota_credito_id, valor}] (uma ou varias), e o
//         valor_empenhado passa a ser a soma dos valores (calculado no ctrl).
//   * valor_anulado tem default 0 e nunca excede o empenhado total (no legado
//     checado aqui contra valor_empenhado; no array, contra a soma no ctrl);
//     o saldo a liquidar e valor_empenhado - valor_anulado - SUM(liquidado).
const camposBase = {
  numero: Joi.string().max(20).required(),
  ano: Joi.number().integer().strict().required(),
  // .raw() preserva 'YYYY-MM-DD' (sem Date UTC), senao grava o dia anterior em UTC-3.
  data_empenho: Joi.date().iso().raw().allow(null),
  finalidade: Joi.string().allow(null, ''),
  // forma legada (uma NC)
  nota_credito_id: Joi.number().integer().strict(),
  valor_empenhado: Joi.number().positive().strict(),
  // forma nova (uma ou varias NCs com valor por NC)
  notas_credito: Joi.array().items(ncAlocacao).min(1),
  valor_anulado: Joi.when('valor_empenhado', {
    is: Joi.exist(),
    then: Joi.number().min(0).strict().max(Joi.ref('valor_empenhado')).default(0),
    otherwise: Joi.number().min(0).strict().default(0)
  })
}

// Exatamente uma das formas; e nota_credito_id exige valor_empenhado junto.
const aplicarRegraNc = obj =>
  obj
    .oxor('nota_credito_id', 'notas_credito')
    .or('nota_credito_id', 'notas_credito')
    .with('nota_credito_id', 'valor_empenhado')

models.criar = aplicarRegraNc(Joi.object().keys({ ...camposBase }))

models.atualizar = aplicarRegraNc(Joi.object().keys({ ...camposBase }))

module.exports = models
