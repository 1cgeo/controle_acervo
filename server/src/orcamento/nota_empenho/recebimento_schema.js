// Path: orcamento\nota_empenho\recebimento_schema.js
'use strict'

const Joi = require('joi')

const models = {}

// Parametro de rota: id do recebimento (BIGSERIAL). Coercao numerica.
models.idParams = Joi.object().keys({
  id: Joi.number().integer().required()
})

// Query da listagem: filtro opcional por nota de empenho.
models.listarQuery = Joi.object().keys({
  nota_empenho_id: Joi.number().integer()
})

// Campos comuns de criacao/atualizacao do recebimento de material.
const camposBase = {
  nota_empenho_id: Joi.number().integer().strict().required(),
  material: Joi.string().required(),
  prazo_entrega: Joi.string().max(60).allow(null, ''),
  situacao: Joi.string().allow(null, ''),
  // Ano em que o material foi recebido (em que RPCMTec/3.6 deve constar). Quando
  // omitido/null, a 3.6 usa o ano da NE. Serve para itens de RPNP (empenho de ano
  // anterior) recebidos no ano corrente aparecerem na 3.6 do ano do recebimento.
  ano_referencia: Joi.number().integer().strict().allow(null)
}

models.criar = Joi.object().keys({
  ...camposBase
})

models.atualizar = Joi.object().keys({
  ...camposBase
})

module.exports = models
