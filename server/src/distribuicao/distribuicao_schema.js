'use strict'

const Joi = require('joi')

const { domainConstants } = require('../utils')

const { TIPO_PROBLEMA_ATIVIDADE } = domainConstants

const models = {}

// A lista fechada de alteracoes de fluxo. Ela e TEXTO em
// `producao.alteracao_fluxo.descricao`, e nao chave estrangeira: quem diz quais
// frases existem e este enum, exatamente como o SAP fazia. Sao as duas decisoes
// que o revisor toma ao encontrar um problema de fluxo, e o texto vai para a
// tela de acompanhamento como esta escrito aqui.
const ALTERACOES_DE_FLUXO = [
  'Necessita nova revisão',
  'Não é necessário uma nova revisão'
]

// O METADADO POR FOLHA aponta `acervo.versao`, e NAO `acervo.produto`.
//
// No SAP o campo se chamava `produto_id` e apontava `macrocontrole.produto`, que
// era um produto POR LOTE -- a folha DAQUELE lote. Aqui `acervo.produto` e a
// folha ETERNA, a mesma em todas as edicoes dela, e o que uma corrida de
// producao entrega e uma `acervo.versao`. Manter o nome antigo faria o plugin
// mandar o id de uma coisa e o servidor gravar noutra, sem erro visivel: os dois
// sao BIGINT.
const versaoEditada = Joi.object().keys({
  versao_id: Joi.number().integer().strict().required(),
  nome_produto: Joi.string().required(),
  palavras_chave: Joi.array()
    .items(
      Joi.object().keys({
        nome: Joi.string().required(),
        tipo_palavra_chave_id: Joi.number().integer().strict().required()
      })
    )
    .unique('nome')
    .required()
})

models.finaliza = Joi.object().keys({
  atividade_id: Joi.number().integer().strict().required(),
  sem_correcao: Joi.boolean().strict(),
  alterar_fluxo: Joi.string().valid(...ALTERACOES_DE_FLUXO),
  info_edicao: Joi.array().items(versaoEditada).unique('versao_id').min(1),
  observacao_proxima_atividade: Joi.string(),
  observacao_atividade: Joi.string()
})

models.metadadoEdicao = Joi.object().keys({
  metadados: Joi.array()
    .items(versaoEditada)
    .unique('versao_id')
    .min(1)
    .required()
})

models.problemaAtividade = Joi.object().keys({
  atividade_id: Joi.number().integer().strict().required(),
  // O CODE, e nao o indice: 'Outros' e 99, e nao 8, para o catalogo crescer pelo
  // fim sem que ele deixe de ser o ultimo da lista. O nome do campo continua
  // sendo o do SAP (`tipo_problema_id`), e nao o da coluna
  // (`tipo_problema_atividade_id`), porque o plugin ja instalado escreve assim.
  tipo_problema_id: Joi.number()
    .integer()
    .strict()
    .valid(...Object.values(TIPO_PROBLEMA_ATIVIDADE))
    .required(),
  descricao: Joi.string().required(),
  // O PREFIXO `SRID=` E OBRIGATORIO, e a exigencia e nova. A coluna
  // `producao.problema_atividade.geom` e `geometry(POLYGON, 4674)`, e a
  // geometria chega na projecao de EDICAO da unidade de trabalho: sem SRID o
  // `ST_GeomFromEWKT` produz SRID 0, e o INSERT morreria com "Geometry SRID (0)
  // does not match column SRID (4674)" -- um 500 onde a resposta certa e 400.
  // No SAP a coluna era 4326 e o cliente ja mandava em 4326, entao o EWKT cru
  // bastava.
  polygon_ewkt: Joi.string()
    .pattern(/^SRID=\d+;/)
    .required()
    .messages({
      'string.pattern.base':
        '"polygon_ewkt" precisa começar com o SRID (por exemplo SRID=4674;POLYGON((...)))'
    })
})

models.finalizacaoIncorreta = Joi.object().keys({
  descricao: Joi.string().required()
})

module.exports = models
module.exports.ALTERACOES_DE_FLUXO = ALTERACOES_DE_FLUXO
