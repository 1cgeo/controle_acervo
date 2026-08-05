'use strict'

const Joi = require('joi')

const { TIPO_LICITACAO } = require('../../utils/domain_constants')

const models = {}

// GCALC DSG (4.4), Propria e Participante (as duas na 4.5).
const TIPOS = Object.values(TIPO_LICITACAO)

// Parametro de rota: id da licitacao (BIGSERIAL). Coercao numerica (vem como string na URL).
models.idParams = Joi.object().keys({
  id: Joi.number().integer().required()
})

// Query da listagem: filtros opcionais por ano e por tipo de licitacao.
// tipo_id = 1 (GCALC DSG, subsecao 4.4 do RPCMTec), 2 (Propria, subsecao 4.5)
// ou 3 (Participante, tambem na 4.5).
models.listarQuery = Joi.object().keys({
  ano: Joi.number().integer(),
  tipo_id: Joi.number().integer().valid(...TIPOS)
})

// Campos comuns de criacao/atualizacao da licitacao.
//
// Regra de negocio (ver tambem o ctrl):
//   * tipo_id: 1 = GCALC DSG (subsecao 4.4), 2 = Propria e 3 = Participante
//     (licitacao conduzida por outra OM, da qual participamos). Os tipos 2 e 3
//     alimentam a subsecao 4.5, "Demais Licitacoes da atividade-fim".
//   * uma licitacao pode cobrir varios DFDs, entao nao ha vinculo direto a um DFD.
//   * objeto e obrigatorio; os valores e a fase sao acompanhados ao longo do processo.
//   * fase_id classifica e fase_atual narra. Os dois convivem: um registro real
//     guarda 103 caracteres explicando por que o pregao se tornou fracassado.
const camposBase = {
  ano: Joi.number().integer().strict().required(),
  tipo_id: Joi.number().integer().strict().valid(...TIPOS).required(),
  objeto: Joi.string().required(),
  // Limites conferidos no DDL (er/orcamento.sql, orcamento.licitacao).
  numero_pregao: Joi.string().max(20).allow(null, ''),
  nup: Joi.string().max(25).allow(null, ''),
  // SEM valid() com a lista de codigos, ao contrario de tipo_id: o dominio
  // dominio.fase_licitacao cresce quando o gestor pedir uma fase nova, e a
  // lista fixa aqui recusaria o codigo novo sem ninguem entender por que. A
  // chave estrangeira ja guarda o valor, e o ctrl traduz a violacao em 400.
  fase_id: Joi.number().integer().strict().allow(null),
  fase_atual: Joi.string().allow(null, ''),
  // min(0), nao positive(): licitacao fracassada homologa em ZERO e o processo
  // continua existindo. positive() recusava o caso real e a UI ja oferecia
  // min: 0, entao o erro so aparecia no salvar.
  valor_total_estimado: Joi.number().min(0).strict().allow(null),
  valor_final_homologado: Joi.number().min(0).strict().allow(null),
  // .raw() preserva a string 'YYYY-MM-DD' (sem converter para Date UTC), senao
  // o Postgres (sessao em UTC-3) gravaria o dia anterior ao informado.
  data_homologacao: Joi.date().iso().raw().allow(null),
  fornecedor: Joi.string().max(255).allow(null, ''),
  om_gestora: Joi.string().max(60).allow(null, '')
}

models.criar = Joi.object().keys({
  ...camposBase
})

models.atualizar = Joi.object().keys({
  ...camposBase
})

module.exports = models
