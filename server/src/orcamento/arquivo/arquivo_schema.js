'use strict'

const Joi = require('joi')

const models = {}

// Parametro de rota: id do arquivo (BIGSERIAL). Coercao numerica (vem da URL).
models.idParams = Joi.object().keys({
  id: Joi.number().integer().required()
})

// Query do vinculo (listagem e upload): EXATAMENTE um entre NC, DFD, PDR(ano) e
// recolhimento. oxor = no maximo um; or = pelo menos um => exatamente um. Os
// valores chegam como string na query e o Joi coerce para numero.
//
// O RECOLHIMENTO entrou na 1.40.0, com o CHECK `arquivo_um_vinculo` passando a
// ter seis parcelas no banco. Ele aceita VARIOS anexos, como o PDR: o extrato do
// SIAFI e o DIEx que pede a devolucao sao dois documentos, e limitar a um
// obrigaria a escolher qual guardar.
models.vinculoQuery = Joi.object()
  .keys({
    nota_credito_id: Joi.number().integer(),
    dfd_id: Joi.number().integer(),
    pdr_ano: Joi.number().integer().min(2000).max(2100),
    recolhimento_id: Joi.number().integer()
  })
  .oxor('nota_credito_id', 'dfd_id', 'pdr_ano', 'recolhimento_id')
  .or('nota_credito_id', 'dfd_id', 'pdr_ano', 'recolhimento_id')

module.exports = models
