'use strict'

const Joi = require('joi')

const models = {}

// Parametro de rota: id da liquidacao (BIGSERIAL). Coercao numerica.
models.idParams = Joi.object().keys({
  id: Joi.number().integer().required()
})

// Query da listagem: filtro opcional por nota de empenho.
models.listarQuery = Joi.object().keys({
  nota_empenho_id: Joi.number().integer()
})

// Campos comuns de criacao/atualizacao da liquidacao.
//
// Regra de negocio (validada no ctrl, em transacao): a soma das liquidacoes
// da NE nao pode exceder valor_empenhado - valor_anulado.
const camposBase = {
  nota_empenho_id: Joi.number().integer().strict().required(),
  valor_liquidado: Joi.number().positive().strict().required(),
  // .raw() preserva 'YYYY-MM-DD' (sem Date UTC), senao grava o dia anterior em UTC-3.
  data: Joi.date().iso().raw().allow(null),
  documento_ns: Joi.string().max(20).allow(null, '')
}

models.criar = Joi.object().keys({
  ...camposBase
})

models.atualizar = Joi.object().keys({
  ...camposBase
})

module.exports = models
