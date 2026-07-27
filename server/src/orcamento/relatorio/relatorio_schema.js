// Path: orcamento\relatorio\relatorio_schema.js
'use strict'

const Joi = require('joi')

const models = {}

// Parametro de rota: id da edicao mensal do RPCMTec (BIGSERIAL).
// Coercao numerica (vem como string na URL).
models.idParams = Joi.object().keys({
  id: Joi.number().integer().required()
})

// Query da listagem da edicao mensal: filtro opcional por ano.
models.listarQuery = Joi.object().keys({
  ano: Joi.number().integer()
})

// Campos comuns de criacao/atualizacao da edicao mensal do RPCMTec.
// A UNIQUE (ano, mes) e tratada no ctrl como 409 (ja existe edicao do mes).
const camposBase = {
  ano: Joi.number().integer().strict().required(),
  mes: Joi.number().integer().min(1).max(12).required(),
  assinante: Joi.string().max(255).allow(null, ''),
  // .raw() preserva 'YYYY-MM-DD' (sem Date UTC), senao grava o dia anterior em UTC-3.
  data_assinatura: Joi.date().raw().allow(null)
}

models.criar = Joi.object().keys({ ...camposBase })

models.atualizar = Joi.object().keys({ ...camposBase })

// Query do gerador da secao 3 e do export Markdown.
//   * ano: exercicio do relatorio (obrigatorio).
//   * mes: mes de corte 1..12 (obrigatorio); define o ultimo dia (:cutoff).
//   * cumulativo: true (default) acumula desde 01-jan do ano; false recorta
//     apenas o proprio mes. Coercao de boolean a partir da string da query.
models.secao3Query = Joi.object().keys({
  ano: Joi.number().integer().required(),
  mes: Joi.number().integer().min(1).max(12).required(),
  cumulativo: Joi.boolean().default(true)
})

module.exports = models
