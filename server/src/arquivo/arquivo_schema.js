// Path: arquivo\arquivo_schema.js
'use strict'

const Joi = require('joi')

const models = {}

const fileSchema = Joi.object().keys({
  uuid_arquivo: Joi.string().uuid().allow(null),
  nome: Joi.string().required(),
  nome_arquivo: Joi.string().required(),
  tipo_arquivo_id: Joi.number().integer().required(),
  extensao: Joi.alternatives().conditional('tipo_arquivo_id', {
    is: 9,
    then: Joi.string().allow(null),
    otherwise: Joi.string().required()
  }),
  tamanho_mb: Joi.alternatives().conditional('tipo_arquivo_id', {
    is: 9,
    then: Joi.number().allow(null),
    otherwise: Joi.number().required()
  }),
  checksum: Joi.alternatives().conditional('tipo_arquivo_id', {
    is: 9,
    then: Joi.string().allow(null),
    otherwise: Joi.string().required()
  }),
  metadado: Joi.object().allow(null),
  situacao_carregamento_id: Joi.number().integer(),
  descricao: Joi.string().allow(null, ''),
  crs_original: Joi.string().max(10).allow(null, ''),
  versao_id: Joi.number().integer().required() // Required versao_id for each file
});

models.arquivoAtualizacao = Joi.object().keys({
  id: Joi.number().integer().strict().required(),
  nome: Joi.string().required(),
  tipo_arquivo_id: Joi.number().integer().strict().required(),
  volume_armazenamento_id: Joi.number().integer().strict().required(),
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

models.prepareAddVersion = Joi.object().keys({
  versoes: Joi.array().items(
    Joi.object().keys({
      produto_id: Joi.number().integer().required(),
      versao: Joi.object().keys({
        uuid_versao: Joi.string().uuid().allow(null),
        versao: Joi.string().required(),
        nome: Joi.string().allow(null).required(),
        tipo_versao_id: Joi.number().integer().required(),
        subtipo_produto_id: Joi.number().integer().required(),
        lote_id: Joi.number().integer().allow(null),
        metadado: Joi.object().allow(null),
        descricao: Joi.string().allow(null, ''),
        orgao_produtor: Joi.string().required(),
        palavras_chave: Joi.array().items(Joi.string()).allow(null).default([]),
        data_criacao: Joi.date().iso().required(),
        data_edicao: Joi.date().iso().required()
      }).required(),
      arquivos: Joi.array().items(
        Joi.object().keys({
          uuid_arquivo: Joi.string().uuid().allow(null),
          nome: Joi.string().required(),
          nome_arquivo: Joi.string().required(),
          tipo_arquivo_id: Joi.number().integer().required(),
          extensao: Joi.alternatives().conditional('tipo_arquivo_id', {
            is: 9,
            then: Joi.string().allow(null),
            otherwise: Joi.string().required()
          }),
          tamanho_mb: Joi.alternatives().conditional('tipo_arquivo_id', {
            is: 9,
            then: Joi.number().allow(null),
            otherwise: Joi.number().required()
          }),
          checksum: Joi.alternatives().conditional('tipo_arquivo_id', {
            is: 9,
            then: Joi.string().allow(null),
            otherwise: Joi.string().required()
          }),
          metadado: Joi.object().allow(null),
          situacao_carregamento_id: Joi.number().integer(),
          descricao: Joi.string().allow(null, ''),
          crs_original: Joi.string().max(10).allow(null, '')
        })
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
        denominador_escala_especial: Joi.number().integer().strict().allow(null),
        tipo_produto_id: Joi.number().integer().required(),
        descricao: Joi.string().allow(null, ''),
        geom: Joi.string().required()
      }).required(),
      versoes: Joi.array().items(
        Joi.object().keys({
          uuid_versao: Joi.string().uuid().allow(null),
          versao: Joi.string().required(),
          nome: Joi.string().allow(null).required(),
          tipo_versao_id: Joi.number().integer().required(),
          subtipo_produto_id: Joi.number().integer().required(),
          lote_id: Joi.number().integer().allow(null),
          metadado: Joi.object().allow(null),
          descricao: Joi.string().allow(null, ''),
          orgao_produtor: Joi.string().required(),
          palavras_chave: Joi.array().items(Joi.string()).allow(null).default([]),
          data_criacao: Joi.date().iso().required(),
          data_edicao: Joi.date().iso().required(),
          arquivos: Joi.array().items(
            Joi.object().keys({
              uuid_arquivo: Joi.string().uuid().allow(null),
              nome: Joi.string().required(),
              nome_arquivo: Joi.string().required(),
              tipo_arquivo_id: Joi.number().integer().required(),
              extensao: Joi.alternatives().conditional('tipo_arquivo_id', {
                is: 9,
                then: Joi.string().allow(null),
                otherwise: Joi.string().required()
              }),
              tamanho_mb: Joi.alternatives().conditional('tipo_arquivo_id', {
                is: 9,
                then: Joi.number().allow(null),
                otherwise: Joi.number().required()
              }),
              checksum: Joi.alternatives().conditional('tipo_arquivo_id', {
                is: 9,
                then: Joi.string().allow(null),
                otherwise: Joi.string().required()
              }),
              metadado: Joi.object().allow(null),
              situacao_carregamento_id: Joi.number().integer(),
              descricao: Joi.string().allow(null, ''),
              crs_original: Joi.string().max(10).allow(null, '')
            })
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