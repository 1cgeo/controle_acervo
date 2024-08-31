'use strict'

const Joi = require('joi')

const models = {}

models.produtoByTipoParams = Joi.object().keys({
  tipo_produto_id: Joi.number().integer().strict().required()
});

models.produtoByTipoQuery = Joi.object().keys({
  projeto_id: Joi.number().integer().strict().optional(),
  lote_id: Joi.number().integer().strict().optional()
});

models.produtoByIdParams = Joi.object().keys({
  produto_id: Joi.number().integer().strict().required()
});

models.arquivosIds = Joi.object().keys({
  arquivos_ids: Joi.array()
    .items(
      Joi.number()
        .integer()
        .strict()
        .required()
    )
    .required()
    .min(1)
    .unique()
})

models.produtosIds = Joi.object().keys({
  produtos_ids: Joi.array()
    .items(
      Joi.number()
        .integer()
        .strict()
        .required()
    )
    .required()
    .min(1)
    .unique()
})

models.versoesHistoricas = Joi.array().items(
  Joi.object().keys({
    uuid_versao: Joi.string().uuid().allow(null).required(),
    versao: Joi.string().required(),
    nome: Joi.string().allow(null).required(),  
    produto_id: Joi.number().integer().strict().required(),
    lote_id: Joi.number().integer().strict().allow(null).required(),
    metadado: Joi.object().required(),
    descricao: Joi.string().allow('').required(),
    data_criacao: Joi.date().required(),
    data_edicao: Joi.date().required()
  })
  .required()
  .min(1)
)

models.produtosVersoesHistoricas = Joi.array().items(
  Joi.object().keys({
    produto: Joi.object().keys({
      nome: Joi.string().allow(null).required(),
      mi: Joi.string().allow(null),
      inom: Joi.string().allow(null),
      denominador_escala: Joi.number().integer().strict().required(),
      tipo_produto_id: Joi.number().integer().strict().required(),
      descricao: Joi.string().allow('').required(),
      geom: Joi.string().required()
    }).required(),
    versao: Joi.object().keys({
      uuid_versao: Joi.string().uuid().allow(null).required(),
      versao: Joi.string().required(),
      nome: Joi.string().allow(null).required(),
      lote_id: Joi.number().integer().strict().allow(null).required(),
      metadado: Joi.object().required(),
      descricao: Joi.string().allow('').required(),
      data_criacao: Joi.date().required(),
      data_edicao: Joi.date().required()
    }).required()
  })
).required().min(1)

const fileSchema = Joi.object().keys({
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
  metadado: Joi.object().allow(null).required(),
  situacao_bdgex_id: Joi.number().integer().required(),
  orgao_produtor: Joi.string().required(),
  descricao: Joi.string().allow(null).required()
});

models.produtosMultiplosArquivos = Joi.object().keys({
  produtos: Joi.array().items(
    Joi.object().keys({
      produto: Joi.object().keys({
        nome: Joi.string().allow(null).required(),
        mi: Joi.string().allow(null).required(),
        inom: Joi.string().allow(null).required(),
        denominador_escala: Joi.number().integer().required(),
        tipo_produto_id: Joi.number().integer().required(),
        descricao: Joi.string().allow(null).required(),
        geom: Joi.string().required()
      }).required(),
      versao: Joi.object().keys({
        uuid_versao: Joi.string().uuid().allow(null).required(),
        versao: Joi.string().required(),
        nome: Joi.string().allow(null).required(),
        tipo_versao_id: Joi.number().integer().required(),
        lote_id: Joi.number().integer().allow(null).required(),
        metadado: Joi.object().allow(null).required(),
        descricao: Joi.string().allow(null).required(),
        data_criacao: Joi.date().iso().required(),
        data_edicao: Joi.date().iso().required()
      }).required(),
      arquivos: Joi.array().items(fileSchema).min(1).required()
    })
  ).min(1).required()
})

models.versoesMultiplosArquivos = Joi.object().keys({
  versoes: Joi.array().items(
    Joi.object().keys({
      produto_id: Joi.number().integer().required(),
      versao: Joi.object().keys({
        uuid_versao: Joi.string().uuid().allow(null).required(),
        versao: Joi.string().required(),
        nome: Joi.string().allow(null).required(),
        tipo_versao_id: Joi.number().integer().required(),
        lote_id: Joi.number().integer().allow(null).required(),
        metadado: Joi.object().allow(null).required(),
        descricao: Joi.string().allow(null).required(),
        data_criacao: Joi.date().iso().required(),
        data_edicao: Joi.date().iso().required()
      }).required(),
      arquivos: Joi.array().items(fileSchema).min(1).required()
    })
  ).min(1).required()
})

models.multiplosArquivos = Joi.object().keys({
  arquivos_por_versao: Joi.array().items(
    Joi.object().keys({
      versao_id: Joi.number().integer().required(),
      arquivos: Joi.array().items(fileSchema).min(1).required()
    })
  ).min(1).required()
})

models.produtos = Joi.object().keys({
  produtos: Joi.array().items(
    Joi.object().keys({
      nome: Joi.string().allow(null).required(),
      mi: Joi.string().allow(null).required(),
      inom: Joi.string().allow(null).required(),
      denominador_escala: Joi.number().integer().required(),
      tipo_produto_id: Joi.number().integer().required(),
      descricao: Joi.string().allow(null).required(),
      geom: Joi.string().required()
    })
  ).min(1).required()
})



module.exports = models
