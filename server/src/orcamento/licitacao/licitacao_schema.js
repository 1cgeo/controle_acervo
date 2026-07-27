// Path: orcamento\licitacao\licitacao_schema.js
'use strict'

const Joi = require('joi')

const models = {}

// Parametro de rota: id da licitacao (BIGSERIAL). Coercao numerica (vem como string na URL).
models.idParams = Joi.object().keys({
  id: Joi.number().integer().required()
})

// Query da listagem: filtros opcionais por ano e por tipo de licitacao.
// tipo_id = 1 (GCALC DSG, tabela 3.4 do RPCMTec) ou 2 (Propria, tabela 3.5).
models.listarQuery = Joi.object().keys({
  ano: Joi.number().integer(),
  tipo_id: Joi.number().integer().valid(1, 2, 3)
})

// Campos comuns de criacao/atualizacao da licitacao.
//
// Regra de negocio (ver tambem o ctrl):
//   * tipo_id: 1 = GCALC DSG (tabela 3.4), 2 = Propria (tabela 3.5),
//     3 = Participante (licitacao conduzida por outra OM, da qual participamos).
//   * uma licitacao pode cobrir varios DFDs, entao nao ha vinculo direto a um DFD.
//   * objeto e obrigatorio; os valores e a fase sao acompanhados ao longo do processo.
const camposBase = {
  ano: Joi.number().integer().strict().required(),
  tipo_id: Joi.number().integer().strict().valid(1, 2, 3).required(),
  objeto: Joi.string().required(),
  fase_atual: Joi.string().allow(null, ''),
  valor_total_estimado: Joi.number().positive().strict().allow(null),
  valor_final_homologado: Joi.number().positive().strict().allow(null),
  om_gestora: Joi.string().max(60).allow(null, '')
}

models.criar = Joi.object().keys({
  ...camposBase
})

models.atualizar = Joi.object().keys({
  ...camposBase
})

module.exports = models
