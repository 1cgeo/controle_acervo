// Path: arquivo\arquivo_schema.js
'use strict'

const Joi = require('joi')

const { TIPO_ARQUIVO, TIPO_ESCALA, TIPO_VERSAO } = require('../utils/domain_constants')

const models = {}

// Espelha o trigger acervo.validate_version: aceita o formato moderno "X-YYYYY"
// e o legado "Xª Edição". As cartas antigas (acervo legado) são cadastradas como
// versões regulares usando "Xª Edição", portanto ambos os tipos aceitam os dois
// formatos (o trigger no banco aplica as regras mais profundas de sequência).
const VERSAO_HISTORICA_REGEX = /^([0-9]+-[A-Z]{1,5}|[0-9]+ª Edição)$/

const versaoSchema = Joi.alternatives().conditional('tipo_versao_id', {
  is: TIPO_VERSAO.REGISTRO_HISTORICO,
  then: Joi.string().pattern(VERSAO_HISTORICA_REGEX).required(),
  otherwise: Joi.string().pattern(VERSAO_HISTORICA_REGEX).required()
})

// Campos comuns de arquivo, espelhando os CHECKs de acervo.arquivo:
// para Tileserver (tipo 9) nome_arquivo deve ser URL http(s) e
// extensao/tamanho_mb/checksum devem ser NULL; para os demais são obrigatórios
const arquivoCampos = {
  uuid_arquivo: Joi.string().uuid().allow(null),
  nome: Joi.string().required(),
  nome_arquivo: Joi.alternatives().conditional('tipo_arquivo_id', {
    is: TIPO_ARQUIVO.TILESERVER,
    then: Joi.string().pattern(/^https?:\/\//).required(),
    otherwise: Joi.string().required()
  }),
  tipo_arquivo_id: Joi.number().integer().required(),
  extensao: Joi.alternatives().conditional('tipo_arquivo_id', {
    is: TIPO_ARQUIVO.TILESERVER,
    then: Joi.valid(null),
    otherwise: Joi.string().required()
  }),
  tamanho_mb: Joi.alternatives().conditional('tipo_arquivo_id', {
    is: TIPO_ARQUIVO.TILESERVER,
    then: Joi.valid(null),
    otherwise: Joi.number().required()
  }),
  checksum: Joi.alternatives().conditional('tipo_arquivo_id', {
    is: TIPO_ARQUIVO.TILESERVER,
    then: Joi.valid(null),
    otherwise: Joi.string().required()
  }),
  metadado: Joi.object().allow(null),
  situacao_carregamento_id: Joi.number().integer(),
  descricao: Joi.string().allow(null, ''),
  crs_original: Joi.string().max(10).allow(null, '')
}

const fileSchema = Joi.object().keys({
  ...arquivoCampos,
  versao_id: Joi.number().integer().required() // Required versao_id for each file
});

models.arquivoAtualizacao = Joi.object().keys({
  id: Joi.number().integer().strict().required(),
  nome: Joi.string().required(),
  tipo_arquivo_id: Joi.number().integer().strict().required(),
  volume_armazenamento_id: Joi.alternatives().conditional('tipo_arquivo_id', {
    is: TIPO_ARQUIVO.TILESERVER,
    then: Joi.valid(null).required(),
    otherwise: Joi.number().integer().strict().required()
  }),
  metadado: Joi.object().required(),
  tipo_status_id: Joi.number().integer().strict().required(),
  situacao_carregamento_id: Joi.number().integer().strict().required(),
  descricao: Joi.string().allow('').required(),
  crs_original: Joi.string().max(10).allow(null, '')
});

models.arquivoIds = Joi.object().keys({
  arquivo_ids: Joi.array()
    .items(Joi.number().integer().strict().required())
    .unique()
    .required()
    .min(1),
  motivo_exclusao: Joi.string().required()
});

models.prepareAddFiles = Joi.object().keys({
  arquivos: Joi.array().items(fileSchema).min(1).required()
});

// Substituicao de conteudo de arquivos de versoes EXISTENTES, sem criar nova
// versao: mesmo corpo do add-files (cada arquivo com versao_id), mas a semantica
// e "upsert por slot" -- substitui (soft-delete + insert atomico no confirm) o
// arquivo que ocupa o slot (versao_id, nome_arquivo, extensao), ou insere se vazio.
models.prepareReplaceFiles = Joi.object().keys({
  arquivos: Joi.array().items(fileSchema).min(1).required()
});

models.prepareAddVersion = Joi.object().keys({
  versoes: Joi.array().items(
    Joi.object().keys({
      produto_id: Joi.number().integer().required(),
      versao: Joi.object().keys({
        uuid_versao: Joi.string().uuid().allow(null),
        versao: versaoSchema,
        nome: Joi.string().allow(null).required(),
        tipo_versao_id: Joi.number().integer().required(),
        subtipo_produto_id: Joi.number().integer().required(),
        lote_id: Joi.number().integer().allow(null),
        metadado: Joi.object().allow(null),
        descricao: Joi.string().allow(null, ''),
        orgao_produtor: Joi.string().required(),
        palavras_chave: Joi.array().items(Joi.string()).allow(null).default([]),
        data_criacao: Joi.date().iso().required(),
        // Espelha o CHECK data_edicao >= data_criacao de acervo.versao
        data_edicao: Joi.date().iso().min(Joi.ref('data_criacao')).required()
      }).required(),
      arquivos: Joi.array().items(
        Joi.object().keys(arquivoCampos)
      ).min(1).required()
    })
  ).min(1).required()
});

models.prepareAddProduct = Joi.object().keys({
  produtos: Joi.array().items(
    Joi.object().keys({
      produto: Joi.object().keys({
        nome: Joi.string().allow(null).required(),
        mi: Joi.string().allow(null).required(),
        inom: Joi.string().allow(null).required(),
        tipo_escala_id: Joi.number().integer().strict().required(),
        // Espelha o CHECK de acervo.produto: denominador obrigatório
        // apenas para escala personalizada (tipo 5), NULL nos demais
        denominador_escala_especial: Joi.alternatives().conditional('tipo_escala_id', {
          is: TIPO_ESCALA.ESCALA_PERSONALIZADA,
          then: Joi.number().integer().strict().required(),
          otherwise: Joi.valid(null)
        }),
        tipo_produto_id: Joi.number().integer().required(),
        // Subtipo que define a identidade do produto (ex.: 24 = Carta Topografica
        // Militar); NULL = produto comum, identidade so por (mi, escala, tipo).
        subtipo_produto_id: Joi.number().integer().allow(null).default(null),
        descricao: Joi.string().allow(null, ''),
        geom: Joi.string().required()
      }).required(),
      versoes: Joi.array().items(
        Joi.object().keys({
          uuid_versao: Joi.string().uuid().allow(null),
          versao: versaoSchema,
          nome: Joi.string().allow(null).required(),
          tipo_versao_id: Joi.number().integer().required(),
          subtipo_produto_id: Joi.number().integer().required(),
          lote_id: Joi.number().integer().allow(null),
          metadado: Joi.object().allow(null),
          descricao: Joi.string().allow(null, ''),
          orgao_produtor: Joi.string().required(),
          palavras_chave: Joi.array().items(Joi.string()).allow(null).default([]),
          data_criacao: Joi.date().iso().required(),
          data_edicao: Joi.date().iso().min(Joi.ref('data_criacao')).required(),
          arquivos: Joi.array().items(
            Joi.object().keys(arquivoCampos)
          ).min(1).required()
        })
      ).min(1).required()
    })
  ).min(1).required()
});

models.confirmUpload = Joi.object().keys({
  session_uuid: Joi.string().uuid().required()
});

models.cancelUpload = Joi.object().keys({
  session_uuid: Joi.string().uuid().required()
});

module.exports = models
