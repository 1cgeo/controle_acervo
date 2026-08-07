'use strict'

const Joi = require('joi')

const { CLASSIFICACAO_NC } = require('../../utils/domain_constants')

const models = {}

// Parametro de rota: id da NC (BIGSERIAL). Coercao numerica (vem como string na URL).
models.idParams = Joi.object().keys({
  id: Joi.number().integer().required()
})

// Query da listagem: filtros opcionais por ano e por classificacao.
models.listarQuery = Joi.object().keys({
  ano: Joi.number().integer(),
  classificacao_id: Joi.number()
    .integer()
    .valid(...Object.values(CLASSIFICACAO_NC))
})

// Campos comuns de criacao/atualizacao da NC.
//
// Regra de negocio central (ver tambem o ctrl):
//   * valor_nc e o valor RECEBIDO. Nunca muda por devolucao: a devolucao
//     reduz o empenhado/liquidado (nota_empenho.valor_anulado), e nao a NC.
//     Por isso valor_nc e obrigatorio e estritamente > 0.
//   * NAO HA `valor_recolhido`. Ate a 1.39.0 ele era um numero digitado nesta
//     linha, e o documento que produziu a devolucao nao existia em lugar nenhum.
//     Desde a 1.40.0 cada devolucao e um DOCUMENTO em
//     `orcamento.nota_credito_recolhimento` (numero, ano, data, ND, UG emitente,
//     historico e PDF), gravado por POST /api/orcamento/recolhimentos. O
//     recolhido da NC e a SOMA dessas linhas, e continua SAINDO na leitura com o
//     mesmo nome de campo, porque a tela, o CLI e o RPCMTec o exibem.
//     O campo tambem nao entra aqui com `.strip()`, pelo mesmo motivo do
//     `meta_pit_id`: quem continuar mandando `valor_recolhido` cai no validador
//     estrito do modulo e recebe 400 dizendo o nome certo, em vez de achar que
//     gravou.
//   * classificacao_id e regra de negocio ("esta previsto no PDR autorizado?"),
//     NAO a celula orcamentaria. 1 = PDR (acao 3.2), 2 = Extra-PDR (acao 3.7).
//     Quando classificacao = PDR, pdr_item_id casa o item previsto (rotulo 1D/1E...);
//     quando Extra-PDR, pdr_item_id obrigatoriamente fica null.
//   * O ITEM DO PDR E O UNICO ELO COM O PIT. A meta que a NC financia e a meta do
//     item dela, lida por JOIN. A NC Extra-PDR nao tem item, logo nao tem meta:
//     ela e o credito que o PDR nao previu, e o vinculo dela com o PIT nunca
//     passou pelo PDR.
const camposBase = {
  numero: Joi.string().max(20).required(),
  ano: Joi.number().integer().strict().required(),
  // .raw() preserva a string 'YYYY-MM-DD' (sem converter para Date UTC), senao
  // o Postgres (sessao em UTC-3) gravaria o dia anterior ao informado.
  data_emissao: Joi.date().iso().raw().allow(null),
  cod_nd: Joi.string().max(6).required(),
  ptres: Joi.string().max(10).allow(null, ''),
  fonte: Joi.string().max(15).allow(null, ''),
  cod_pi: Joi.string().max(20).allow(null, ''),
  ug_emitente: Joi.string().max(10).allow(null, ''),
  finalidade_historico: Joi.string().allow(null, ''),
  // NAO HA `meta_pit_id`. A NC nao declara meta desde a 1.31.0: ela declara o
  // item do PDR, e a meta se le por ele. Enquanto os dois campos existiam lado a
  // lado, o cliente podia mandar uma meta que o item nao financia, e nada
  // acusava. Estava acontecendo: 4 das 29 NCs que tinham os dois discordavam.
  // O campo tambem nao entra com `.strip()`, e nao precisa: quem continuar
  // mandando `meta_pit_id` cai no stripUnknown de `utils/schema_validation.js`,
  // que descarta a chave, registra no log e a devolve em `avisos` no envelope da
  // resposta. O cliente antigo fica sabendo que o dado nao foi gravado, em vez
  // de achar que gravou. Declara-lo aqui so para descartar seria uma segunda
  // regra dizendo o que a primeira ja diz.
  // valor recebido; ver comentario acima sobre devolucao
  valor_nc: Joi.number().positive().strict().required(),
  doc_ro: Joi.string().max(20).allow(null, ''),
  prazo_empenho: Joi.date().iso().raw().allow(null),
  classificacao_id: Joi.number()
    .integer()
    .strict()
    .valid(...Object.values(CLASSIFICACAO_NC))
    .required(),
  // pdr_item_id e condicional a classificacao_id (ver alternatives abaixo)
  nc_complementada_id: Joi.number().integer().strict().allow(null),
  marcador: Joi.string().max(8).allow(null, ''),
  observacao: Joi.string().allow(null, '')
}

// pdr_item_id so e aceito quando classificacao_id = 1 (PDR); quando = 2 (Extra-PDR),
// o valor e forcado a null. Modelado com alternatives().conditional sobre o irmao
// classificacao_id: e o schema que garante o invariante, antes mesmo do banco.
const pdrItemIdCondicional = Joi.alternatives().conditional(
  Joi.ref('classificacao_id'),
  {
    is: CLASSIFICACAO_NC.PDR,
    // PDR: pdr_item_id e recomendado, porem opcional (pode chegar depois).
    then: Joi.number().integer().strict().allow(null).default(null),
    // Extra-PDR (ou qualquer outro valor): forca null, descartando o que vier.
    otherwise: Joi.any().strip()
  }
)

models.criar = Joi.object().keys({
  ...camposBase,
  pdr_item_id: pdrItemIdCondicional
})

models.atualizar = Joi.object().keys({
  ...camposBase,
  pdr_item_id: pdrItemIdCondicional
})

module.exports = models
