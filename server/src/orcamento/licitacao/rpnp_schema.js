'use strict'

const Joi = require('joi')

const models = {}

// Parametro de rota: id do RPNP (BIGSERIAL). Coercao numerica (vem como string na URL).
models.idParams = Joi.object().keys({
  id: Joi.number().integer().required()
})

// Query da listagem: filtro opcional por ano.
models.listarQuery = Joi.object().keys({
  ano: Joi.number().integer()
})

// Campos comuns de criacao/atualizacao do RPNP (restos a pagar nao processados).
//
// Regra de negocio (ver tambem o ctrl):
//   * RPNP e carregamento anual de restos a pagar nao processados. Alimenta a
//     subsecao 4.3 do RPCMTec.
//   * nota_empenho_id e opcional: quando o empenho de origem nao esta cadastrado
//     em orcamento.nota_empenho, empenho_label (texto livre, ex.:
//     '2023NE000261 (PI K1PDMGCDEGE - DCT)') serve de identificacao. Exigimos ao
//     menos um dos dois para o registro nao ficar sem identificacao.
const camposBase = {
  ano: Joi.number().integer().strict().required(),
  nota_empenho_id: Joi.number().integer().strict().allow(null),
  empenho_label: Joi.string().max(60).allow(null, ''),
  finalidade: Joi.string().allow(null, ''),
  // min(0) pelo mesmo motivo do valor_a_liquidar abaixo: o empenho anulado por
  // inteiro carrega zero e continua sendo um resto a pagar do exercicio.
  valor_empenhado: Joi.number().min(0).strict().allow(null),
  // pode ser 0: um RPNP totalmente liquidado nao tem mais saldo a liquidar, e
  // continua CADASTRADO. Por isso min(0), e nao positive(). O que ele nao faz
  // mais e aparecer na subsecao 4.3, que desde 2026-08-31 so lista o resto com
  // saldo (ver `gerarRpnp` em rpcmtec_ctrl.js) -- e o corte de la usa o saldo
  // CALCULADO no mes, nao este campo, que guarda o saldo de hoje.
  valor_a_liquidar: Joi.number().min(0).strict().allow(null)
}

// Exige nota_empenho_id ou empenho_label (um identifica o resto a pagar).
const identificacao = Joi.object()
  .keys(camposBase)
  .or('nota_empenho_id', 'empenho_label')
  .messages({
    'object.missing':
      'Informe a nota de empenho (nota_empenho_id) ou um rotulo de empenho (empenho_label)'
  })

models.criar = identificacao

models.atualizar = identificacao

module.exports = models
