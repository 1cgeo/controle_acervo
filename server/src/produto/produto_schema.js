// Path: produto\produto_schema.js
"use strict";

const Joi = require("joi");

const { TIPO_ESCALA } = require("../utils/domain_constants");

const models = {};

// Registros históricos aceitam o formato novo "X-YYYYY" ou o antigo "Xª Edição"
// (espelha o trigger acervo.validate_version)
const VERSAO_HISTORICA_REGEX = /^([0-9]+-[A-Z]{1,5}|[0-9]+ª Edição)$/;

// Espelha o CHECK de acervo.produto: denominador obrigatório apenas para
// escala personalizada (tipo 5), NULL nos demais
const denominadorEscalaEspecial = Joi.alternatives().conditional('tipo_escala_id', {
  is: TIPO_ESCALA.ESCALA_PERSONALIZADA,
  then: Joi.number().integer().strict().required(),
  otherwise: Joi.valid(null).required()
});

models.produtoAtualizacao = Joi.object().keys({
  id: Joi.number().integer().strict().required(),
  nome: Joi.string().required(),
  mi: Joi.string().allow(null, ''),
  inom: Joi.string().allow(null, ''),
  tipo_escala_id: Joi.number().integer().strict().required(),
  denominador_escala_especial: denominadorEscalaEspecial,
  tipo_produto_id: Joi.number().integer().strict().required(),
  descricao: Joi.string().allow('').required(),
  geom: Joi.string().allow(null)
})

models.versaoAtualizacao = Joi.object().keys({
  id: Joi.number().integer().strict().required(),
  uuid_versao: Joi.string().uuid(),
  versao: Joi.string().required(),
  nome: Joi.string().allow(null).required(),
  tipo_versao_id: Joi.number().integer().strict().required(),
  subtipo_produto_id: Joi.number().integer().strict().required(),
  descricao: Joi.string().allow('').required(),
  metadado: Joi.object().required(),
  lote_id: Joi.number().integer().strict().allow(null).required(),
  orgao_produtor: Joi.string().required(),
  palavras_chave: Joi.array().items(Joi.string()).allow(null).default([]),
  data_criacao: Joi.date().required(),
  // Espelha o CHECK data_edicao >= data_criacao de acervo.versao
  data_edicao: Joi.date().min(Joi.ref('data_criacao')).required()
});

models.produtoIds = Joi.object().keys({
  produto_ids: Joi.array()
    .items(Joi.number().integer().strict().required())
    .unique()
    .required()
    .min(1),
  motivo_exclusao: Joi.string().required()
})

models.versaoIds = Joi.object().keys({
  versao_ids: Joi.array()
    .items(Joi.number().integer().strict().required())
    .unique()
    .required()
    .min(1),
  motivo_exclusao: Joi.string().required()
});

// Mover arquivos de uma versao para outra, sem novo upload fisico.
// Usado para separar registros que bundlam duas edicoes: o arquivo da edicao
// errada vai para a versao (em geral historica) daquela edicao. Tambem usado para
// corrigir arquivo carregado no produto/tipo errado (permitir_entre_produtos=true).
models.moverArquivos = Joi.object().keys({
  arquivo_ids: Joi.array()
    .items(Joi.number().integer().strict().required())
    .unique()
    .required()
    .min(1),
  versao_id_destino: Joi.number().integer().strict().required(),
  permitir_entre_produtos: Joi.boolean().default(false),
  permitir_esvaziar_origem: Joi.boolean().default(false)
});

// Abre espaco de rotulo para uma edicao recem-descoberta que fica ANTES (ou entre)
// as edicoes ja cadastradas de um produto/subtipo. O rotulo ordinal impresso na carta
// (ou o numero de uma serie "N-SIGLA") nao e confiavel: a data_edicao e que prova que
// duas cartas sao edicoes diferentes, o rotulo e so uma etiqueta a acertar depois.
// A familia "EDICAO" desloca "Nª Edição"; qualquer outra string desloca "N-<familia>"
// (ex. familia="DSG" desloca "1-DSG"/"2-DSG"). As duas familias convivem no mesmo
// produto/subtipo sem interferir uma na outra (cada uma tem sua propria contagem).
models.renumeraVersoes = Joi.object().keys({
  produto_id: Joi.number().integer().strict().required(),
  subtipo_produto_id: Joi.number().integer().strict().required(),
  familia: Joi.string().pattern(/^([A-Z]{1,5}|EDICAO)$/).required(),
  nova_data_edicao: Joi.date().iso().required()
});

models.versaoRelacionamento = Joi.object().keys({
  versao_relacionamento: Joi.array()
    .items(
      Joi.object().keys({
        versao_id_1: Joi.number().integer().strict().required(),
        versao_id_2: Joi.number().integer().strict().required(),
        tipo_relacionamento_id: Joi.number().integer().strict().required()
      })
    )
    .required()
    .min(1)
});

models.versaoRelacionamentoAtualizacao = Joi.object().keys({
  versao_relacionamento: Joi.array()
    .items(
      Joi.object().keys({
        id: Joi.number().integer().strict().required(),
        versao_id_1: Joi.number().integer().strict().required(),
        versao_id_2: Joi.number().integer().strict().required(),
        tipo_relacionamento_id: Joi.number().integer().strict().required(),
      })
    )
    .required()
    .min(1)
});

models.versaoRelacionamentoIds = Joi.object().keys({
  versao_relacionamento_ids: Joi.array()
    .items(Joi.number().integer().strict().required())
    .unique()
    .required()
    .min(1)
});

// .required().min(1) no ARRAY (no objeto-item, min(1) validaria número de chaves
// e um array vazio passaria, quebrando depois no insert)
models.versoesHistoricas = Joi.array().items(
  Joi.object().keys({
    uuid_versao: Joi.string().uuid().allow(null).required(),
    versao: Joi.string().pattern(VERSAO_HISTORICA_REGEX).required(),
    nome: Joi.string().allow(null).required(),
    produto_id: Joi.number().integer().strict().required(),
    subtipo_produto_id: Joi.number().integer().strict().required(),
    lote_id: Joi.number().integer().strict().allow(null).required(),
    metadado: Joi.object().required(),
    descricao: Joi.string().allow('').required(),
    orgao_produtor: Joi.string().required(),
    palavras_chave: Joi.array().items(Joi.string()).allow(null).default([]),
    data_criacao: Joi.date().required(),
    data_edicao: Joi.date().min(Joi.ref('data_criacao')).required()
  })
).required().min(1)

models.produtosVersoesHistoricas = Joi.array().items(
  Joi.object().keys({
    nome: Joi.string().allow(null).required(),
    mi: Joi.string().allow(null),
    inom: Joi.string().allow(null),
    tipo_escala_id: Joi.number().integer().strict().required(),
    denominador_escala_especial: denominadorEscalaEspecial,
    tipo_produto_id: Joi.number().integer().strict().required(),
    descricao: Joi.string().allow('').required(),
    geom: Joi.string().required(),
    versoes: Joi.array().items(
      Joi.object().keys({
        uuid_versao: Joi.string().uuid().allow(null).required(),
        versao: Joi.string().pattern(VERSAO_HISTORICA_REGEX).required(),
        nome: Joi.string().allow(null).required(),
        subtipo_produto_id: Joi.number().integer().strict().required(),
        lote_id: Joi.number().integer().strict().allow(null).required(),
        metadado: Joi.object().required(),
        descricao: Joi.string().allow('').required(),
        orgao_produtor: Joi.string().required(),
        palavras_chave: Joi.array().items(Joi.string()).allow(null).default([]),
        data_criacao: Joi.date().required(),
        data_edicao: Joi.date().min(Joi.ref('data_criacao')).required()
      })
    ).min(1).required()
  })
).required().min(1);

models.produtos = Joi.object().keys({
  produtos: Joi.array().items(
    Joi.object().keys({
      nome: Joi.string().allow(null).required(),
      mi: Joi.string().allow(null, '').required(),
      inom: Joi.string().allow(null, '').required(),
      tipo_escala_id: Joi.number().integer().strict().required(),
      denominador_escala_especial: denominadorEscalaEspecial,
      tipo_produto_id: Joi.number().integer().required(),
      descricao: Joi.string().allow(null, '').required(),
      geom: Joi.string().required()
    })
  ).min(1).required()
})

module.exports = models;
