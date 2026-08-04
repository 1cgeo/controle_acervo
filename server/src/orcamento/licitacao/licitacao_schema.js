'use strict'

const Joi = require('joi')

const models = {}

// Parametro de rota: id da licitacao (BIGSERIAL). Coercao numerica (vem como string na URL).
models.idParams = Joi.object().keys({
  id: Joi.number().integer().required()
})

// Query da listagem: filtros opcionais por ano e por tipo de licitacao.
// tipo_id = 1 (GCALC DSG, subsecao 4.4 do RPCMTec), 2 (Propria, subsecao 4.5)
// ou 3 (Participante, sem subsecao no relatorio).
models.listarQuery = Joi.object().keys({
  ano: Joi.number().integer(),
  tipo_id: Joi.number().integer().valid(1, 2, 3)
})

// Campos comuns de criacao/atualizacao da licitacao.
//
// Regra de negocio (ver tambem o ctrl):
//   * tipo_id: 1 = GCALC DSG (subsecao 4.4), 2 = Propria (subsecao 4.5),
//     3 = Participante (licitacao conduzida por outra OM, da qual participamos;
//     o RPCMTec nao gera subsecao para ela).
//   * uma licitacao pode cobrir varios DFDs, entao nao ha vinculo direto a um DFD.
//   * objeto e obrigatorio; os valores e a fase sao acompanhados ao longo do processo.
const camposBase = {
  ano: Joi.number().integer().strict().required(),
  tipo_id: Joi.number().integer().strict().valid(1, 2, 3).required(),
  objeto: Joi.string().required(),
  fase_atual: Joi.string().allow(null, ''),
  // min(0), nao positive(): licitacao fracassada homologa em ZERO e o processo
  // continua existindo. positive() recusava o caso real e a UI ja oferecia
  // min: 0, entao o erro so aparecia no salvar.
  valor_total_estimado: Joi.number().min(0).strict().allow(null),
  valor_final_homologado: Joi.number().min(0).strict().allow(null),
  om_gestora: Joi.string().max(60).allow(null, '')
}

models.criar = Joi.object().keys({
  ...camposBase
})

models.atualizar = Joi.object().keys({
  ...camposBase
})

module.exports = models
