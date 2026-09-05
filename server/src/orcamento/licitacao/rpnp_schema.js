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
  // `.trim()` NAO E ENFEITE: sem ele, um rotulo so de espacos passava pelo
  // `.custom()` abaixo (que ja trata o branco como ausencia PARA RECUSAR) quando
  // havia nota de empenho, e `dados.empenho_label || null` o GRAVAVA -- '   ' e
  // truthy. A listagem monta `COALESCE(rp.empenho_label, ne.numero)`, entao os
  // espacos apareciam no lugar de '2023NE000261' e a busca da tabela deixava de
  // achar o resto a pagar pelo numero. Com o trim (o validador roda com
  // `convert: true`), '   ' vira '' e o `|| null` do controlador o normaliza.
  empenho_label: Joi.string().trim().max(60).allow(null, ''),
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
//
// `.or()` SOZINHO NAO SERVE AQUI, e a diferenca custava a regra inteira: o `.or`
// do Joi cobra PRESENCA da chave, e nao valor. O formulario do RPNP monta o corpo com
// as duas chaves SEMPRE (`rpnp-dialog.js`: `nota_empenho_id: paraId(...)` e
// `empenho_label: ... || null`), entao um RPNP salvo com os DOIS campos em
// branco chegava com `{nota_empenho_id: null, empenho_label: null}`, satisfazia
// o `.or` e gravava. A linha nascia sem identificacao nenhuma, e a lista a
// mostrava como '-' na coluna Empenho, sem jeito de descobrir de que resto a
// pagar ela fala.
//
// A conferencia e por VALOR, e trata o texto vazio como ausencia, porque o
// controlador ja o converte para nulo (`dados.empenho_label || null`).
//
// O `.or()` FICA AO LADO do `.custom()`, e nao no lugar dele: ele nao recusa
// nada a mais (so cobra presenca), mas e o que publica a regra em
// `describe().dependencies`, que o `orcamento_cli` le para imprimir "regras
// entre campos" no contrato vivo. Sem ele, o agente que le o contrato antes de
// montar o corpo nao ve a regra, e `orcamento_cli/__tests__/schema.test.js`
// fica vermelho.
const MSG_IDENTIFICACAO =
  'Informe a nota de empenho (nota_empenho_id) ou um rótulo de empenho (empenho_label)'

const identificacao = Joi.object()
  .keys(camposBase)
  .or('nota_empenho_id', 'empenho_label')
  .custom((valor, helpers) => {
    const semNota = valor.nota_empenho_id == null
    const semRotulo =
      valor.empenho_label == null || String(valor.empenho_label).trim() === ''
    if (semNota && semRotulo) {
      return helpers.message(MSG_IDENTIFICACAO)
    }
    return valor
  })

models.criar = identificacao

models.atualizar = identificacao

module.exports = models
