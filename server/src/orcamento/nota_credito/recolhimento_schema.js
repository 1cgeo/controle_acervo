'use strict'

const Joi = require('joi')

const models = {}

// Parametro de rota: id do recolhimento (BIGSERIAL). Coercao numerica (vem como
// string na URL).
models.idParams = Joi.object().keys({
  id: Joi.number().integer().required()
})

// Query da listagem: filtros opcionais por nota de credito e por ano. Os dois
// convivem porque as duas perguntas existem: a ficha de UMA NC quer as linhas
// dela, e o fechamento do exercicio quer o recolhido do ANO inteiro.
models.listarQuery = Joi.object().keys({
  nota_credito_id: Joi.number().integer(),
  ano: Joi.number().integer()
})

// Campos comuns de criacao e atualizacao do documento de recolhimento.
//
// Regra de negocio (ver tambem er/orcamento.sql e o ctrl):
//   * O recolhimento e um DOCUMENTO do SIAFI, e nao um numero digitado na NC.
//     Ate a 1.39.0 ele era a coluna `nota_credito.valor_recolhido`; o recolhido
//     de uma NC passou a ser a SOMA das linhas desta tabela.
//   * `nota_credito_id` e OBRIGATORIO: recolhimento que nao abate credito nenhum
//     nao e deste modulo.
//   * `numero` NAO e unico sozinho. Uma NC de recolhimento pode abater DUAS NCs
//     nossas, entrando uma vez por alvo com o valor rateado (caso medido: a
//     2026NC401316 recolhe R$ 0,98 da 400224 e R$ 0,99 da 400937). A unicidade e
//     (ano, numero, nota_credito_id), e a colisao volta 409.
//   * `cod_nd` e a ND da ANULACAO (339000, 449000), e nao a da NC alvo: e o que
//     o extrato mostra, e sem ela o documento nao se acha no SIAFI.
//   * `valor` e estritamente positivo, como o CHECK do banco cobra. Recolhimento
//     de zero nao e documento nenhum.
const camposBase = {
  nota_credito_id: Joi.number().integer().strict().required(),
  numero: Joi.string().max(20).required(),
  ano: Joi.number().integer().strict().required(),
  // .raw() preserva a string 'YYYY-MM-DD' (sem converter para Date UTC), senao
  // o Postgres (sessao em UTC-3) gravaria o dia anterior ao informado.
  data_emissao: Joi.date().iso().raw().allow(null),
  cod_nd: Joi.string().max(6).allow(null, ''),
  ug_emitente: Joi.string().max(10).allow(null, ''),
  valor: Joi.number().positive().strict().required(),
  finalidade_historico: Joi.string().allow(null, ''),
  observacao: Joi.string().allow(null, '')
}

models.criar = Joi.object().keys(camposBase)

models.atualizar = Joi.object().keys(camposBase)

module.exports = models
