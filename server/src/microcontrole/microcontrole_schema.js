'use strict'

const Joi = require('joi')

const models = {}

// ---------------------------------------------------------------------------
// A TELEMETRIA QUE O PLUGIN GRAVA
// ---------------------------------------------------------------------------
//
// OS NOMES DE CAMPO SAO OS DO SAP 2.3.5, e nenhum foi traduzido nem renomeado.
// Quem monta este corpo e o plugin JA INSTALADO em cada maquina, e ele nao vai
// ser recompilado no dia da migracao: um `quantidade` que virasse `qtd` aqui
// derrubaria toda gravacao de telemetria com 400, e o operador nao veria nada --
// o plugin grava em segundo plano.
//
// A EXCECAO E `usuario_uuid`, QUE NAO ESTA AQUI: ele nunca veio do corpo, nem no
// SAP. Quem grava a autoria e o TOKEN (`req.usuarioUuid`), e aceitar essa chave
// no corpo deixaria qualquer operador lancar telemetria em nome de outro.

models.feicao = Joi.object().keys({
  atividade_id: Joi.number()
    .integer()
    .strict()
    .required(),
  dados: Joi.array()
    .items(
      Joi.object().keys({
        tipo_operacao_id: Joi.number()
          .integer()
          .strict()
          .required(),
        quantidade: Joi.number()
          .integer()
          .strict()
          .required(),
        // COMPRIMENTO E VERTICES SO SAO EXIGIDOS NA INSERCAO (tipo 1), e nao e
        // tolerancia: apagar uma feicao nao tem comprimento a medir, e alterar
        // um atributo nao mexe na geometria. Nas outras tres operacoes o
        // controlador grava 0, pelo `def` do ColumnSet -- a coluna e NOT NULL.
        comprimento: Joi.number()
          .strict()
          .when('tipo_operacao_id', { is: 1, then: Joi.required() }),
        vertices: Joi.number()
          .integer()
          .strict()
          .when('tipo_operacao_id', { is: 1, then: Joi.required() }),
        camada: Joi.string().required()
      })
    )
    .required()
    .min(1)
})

models.tela = Joi.object().keys({
  atividade_id: Joi.number()
    .integer()
    .strict()
    .required(),
  dados: Joi.array()
    .items(
      Joi.object().keys({
        // `Joi.date()` E O CERTO AQUI, e nao `Joi.date().iso().raw()` da regra da
        // casa. A regra vale para DIA DE CALENDARIO gravado em coluna `DATE`,
        // onde o fuso empurra a data para o dia anterior. Isto e um INSTANTE, em
        // coluna `timestamp with time zone`: o momento em que o quadro de tela
        // foi amostrado. O `.raw()` daria uma string crua onde o driver precisa
        // do instante, e o Postgres normaliza o fuso sozinho.
        data: Joi.date().required(),
        // A EXTENSAO VISIVEL NA TELA, em WGS 84. O controlador a transforma em
        // `ST_MakeEnvelope`; ela nao chega como geometria pronta porque o plugin
        // le quatro numeros do canvas do QGIS e nao monta WKT.
        x_min: Joi.number()
          .strict()
          .required(),
        x_max: Joi.number()
          .strict()
          .required(),
        y_min: Joi.number()
          .strict()
          .required(),
        y_max: Joi.number()
          .strict()
          .required(),
        zoom: Joi.number()
          .strict()
          .required()
      })
    )
    .required()
    .min(1)
})

// ---------------------------------------------------------------------------
// O PERFIL DE MONITORAMENTO (banco principal)
// ---------------------------------------------------------------------------
//
// EM LOTE, E NAO UM POR REQUISICAO: as tres rotas de escrita recebem ARRAY. E o
// contrato do SAP Gerente, que monta a configuracao inteira de um lote numa
// tela e salva de uma vez -- e e o que faz a operacao caber numa transacao so.
// Doze requisicoes deixariam o lote meio configurado quando a sexta falhasse.

models.perfilMonitoramento = Joi.object().keys({
  perfis_monitoramento: Joi.array()
    .items(
      Joi.object().keys({
        subfase_id: Joi.number().integer().strict().required(),
        lote_id: Joi.number().integer().strict().required(),
        tipo_monitoramento_id: Joi.number().integer().strict().required()
      })
    )
    .required()
    .min(1)
})

models.perfilMonitoramentoAtualizacao = Joi.object().keys({
  perfis_monitoramento: Joi.array()
    .items(
      Joi.object().keys({
        id: Joi.number().integer().strict().required(),
        subfase_id: Joi.number().integer().strict().required(),
        lote_id: Joi.number().integer().strict().required(),
        tipo_monitoramento_id: Joi.number().integer().strict().required()
      })
    )
    .required()
    .min(1)
})

models.perfilMonitoramentoIds = Joi.object().keys({
  perfis_monitoramento_ids: Joi.array()
    .items(Joi.number().integer().strict().required())
    .unique()
    .required()
    .min(1)
})

// ---------------------------------------------------------------------------
// OS FILTROS DAS TRES LEITURAS AGREGADAS
// ---------------------------------------------------------------------------
//
// SEM `.strict()` NOS NUMEROS, ao contrario de tudo acima, e a assimetria e
// deliberada. `req.query` do Express chega SEMPRE como string: com `.strict()`
// o Joi recusaria a coercao e todo filtro numerico responderia 400. E a mesma
// convencao das outras query schemas do repositorio.

models.resumoFeicaoQuery = Joi.object().keys({
  lote_id: Joi.number().integer(),
  data_inicio: Joi.date(),
  data_fim: Joi.date()
})

models.coberturaTelaQuery = Joi.object().keys({
  lote_id: Joi.number().integer(),
  // O UUID DA PESSOA, e nao um id inteiro: a identidade da casa e
  // `dgeo.usuario.uuid`, e e ele que a telemetria grava.
  usuario_uuid: Joi.string().uuid(),
  data_inicio: Joi.date(),
  data_fim: Joi.date()
})

models.aproveitamentoTelaQuery = Joi.object().keys({
  // OBRIGATORIO, e as outras duas leituras nao o exigem: aproveitamento e por
  // PESSOA e por DIA, e "o aproveitamento de todo mundo junto" nao quer dizer
  // nada -- somar o tempo de tela de cinco operadores num unico percentual
  // esconde exatamente a diferenca que se foi olhar.
  usuario_uuid: Joi.string().uuid().required(),
  data_inicio: Joi.date(),
  data_fim: Joi.date()
})

module.exports = models
