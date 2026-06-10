// Path: integracao\integracao_schema.js
'use strict'

const Joi = require('joi')

const models = {}

// Cobertura por folha (situação geral). Sem escala, varre as quatro.
// mi/inom: lista separada por vírgula (filtra às folhas pedidas).
models.situacaoGeralQuery = Joi.object().keys({
  escala: Joi.string().valid('25k', '50k', '100k', '250k'),
  geom: Joi.boolean().default(false),
  mi: Joi.string(),
  inom: Joi.string()
})

// Período mensal de um ano, com modo cumulativo (acumulado até o mês).
// ano/mes default: data corrente. cumulativo default: true (RPCMTec é cumulativo).
const periodoBase = {
  ano: Joi.number()
    .integer()
    .min(2000)
    .max(2100)
    .default(() => new Date().getFullYear()),
  mes: Joi.number()
    .integer()
    .min(1)
    .max(12)
    .default(() => new Date().getMonth() + 1),
  cumulativo: Joi.boolean().default(true)
}

// Produtos finalizados no mês (RPCMTec 2.2). Filtra por data_edicao (finalização).
models.produtosFinalizadosQuery = Joi.object().keys({
  ...periodoBase,
  tipo_produto_id: Joi.number().integer(),
  tipo_escala_id: Joi.number().integer()
})

// Atendimentos da mapoteca no mês (RPCMTec 2.4 e 2.7).
models.atendimentosQuery = Joi.object().keys({
  ...periodoBase
})

module.exports = models
