// Path: orcamento\arquivo\arquivo_schema.js
'use strict'

const Joi = require('joi')

const models = {}

// Parametro de rota: id do arquivo (BIGSERIAL). Coercao numerica (vem da URL).
models.idParams = Joi.object().keys({
  id: Joi.number().integer().required()
})

// Query do vinculo (listagem e upload): EXATAMENTE um entre NC, DFD e PDR(ano).
// oxor = no maximo um; or = pelo menos um => exatamente um. Os valores chegam
// como string na query e o Joi coerce para numero.
models.vinculoQuery = Joi.object()
  .keys({
    nota_credito_id: Joi.number().integer(),
    dfd_id: Joi.number().integer(),
    pdr_ano: Joi.number().integer().min(2000).max(2100)
  })
  .oxor('nota_credito_id', 'dfd_id', 'pdr_ano')
  .or('nota_credito_id', 'dfd_id', 'pdr_ano')

module.exports = models
