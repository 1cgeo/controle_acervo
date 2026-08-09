'use strict'

// O CONTRATO DE ENTRADA DAS 23 ROTAS DE ACOMPANHAMENTO.
//
// Toda recusa aqui prova o MOTIVO, e nao so que houve recusa: `recusaPor` do
// `helpers/joi.js` prende o CAMPO e a REGRA do primeiro erro do Joi. Sem isso um
// caso passaria com qualquer outro campo quebrado, e a regra que o titulo anuncia
// poderia ser removida sem ninguem notar.

const schema = require('../../../acompanhamento_producao/acompanhamento_producao_schema')
const { recusaPor, aceita } = require('../../helpers/joi')

describe('loteParams e loteSubfaseParams', () => {
  it('aceita id de lote e de subfase como texto do caminho', () => {
    // O Express entrega `req.params` sempre como STRING. Um schema que exigisse
    // number sem conversao recusaria toda requisicao legitima.
    const valor = aceita(schema.loteSubfaseParams.validate({ lote: '42', subfase: '7' }))

    expect(valor).toEqual({ lote: 42, subfase: 7 })
  })

  it('recusa lote zero', () => {
    // SERIAL e BIGSERIAL comecam em 1: `/informacoes/0` e erro de quem chamou, e
    // nao um 404 depois de ir ao banco.
    recusaPor(schema.loteParams.validate({ lote: '0' }), 'lote', 'number.positive')
  })

  it('recusa lote que nao e numero', () => {
    recusaPor(schema.loteParams.validate({ lote: 'abc' }), 'lote', 'number.base')
  })

  it('exige a subfase quando o caminho a declara', () => {
    recusaPor(
      schema.loteSubfaseParams.validate({ lote: '42' }), 'subfase', 'any.required'
    )
  })
})

describe('anoParams', () => {
  it('aceita o ano corrente', () => {
    expect(aceita(schema.anoParams.validate({ ano: '2026' }))).toEqual({ ano: 2026 })
  })

  it('recusa ano com cinco digitos', () => {
    // O teto existe para o `/pit/20260` morrer no Joi, e nao dentro de um
    // `generate_series` de mil e cem linhas.
    recusaPor(schema.anoParams.validate({ ano: '20260' }), 'ano', 'number.max')
  })

  it('recusa ano anterior a 1900', () => {
    recusaPor(schema.anoParams.validate({ ano: '1899' }), 'ano', 'number.min')
  })

  it('recusa ano fracionario', () => {
    recusaPor(schema.anoParams.validate({ ano: '2026.5' }), 'ano', 'number.integer')
  })
})

describe('nomeParams: o nome da camada de acompanhamento', () => {
  // AS VIEWS DESTE SCHEMA SAO GERADAS EM TEMPO DE EXECUCAO, e o nome delas e o
  // unico texto que o modulo interpola no SQL. Esta e a primeira das duas
  // peneiras; a segunda e a existencia em `pg_matviews`, no controlador.

  it.each([
    ['bloco'],
    ['lote_1_linha_2'],
    ['lote_102_subfase_37']
  ])('aceita %s', nome => {
    expect(aceita(schema.nomeParams.validate({ nome }))).toEqual({ nome })
  })

  it.each([
    ['lote_1_linha', 'sem o id da linha'],
    ['lote__linha_2', 'sem o id do lote'],
    ['lote_1_fase_2', 'família de view que não existe'],
    ['LOTE_1_LINHA_2', 'em maiúscula, que não é o nome gerado'],
    ['bloco; DROP TABLE acervo.versao', 'com comando colado'],
    ['pg_matviews', 'nome de catálogo do Postgres'],
    ['lote_1_linha_2 ', 'com espaço no fim']
  ])('recusa %s (%s)', nome => {
    recusaPor(schema.nomeParams.validate({ nome }), 'nome', 'string.pattern.base')
  })

  it('a mensagem de recusa diz quais nomes existem', () => {
    // Quem errou o nome tem de descobrir a forma certa pela resposta, e nao
    // lendo o DDL do gerador de views.
    const { error } = schema.nomeParams.validate({ nome: 'qualquer_coisa' })

    expect(error.message).toContain('lote_<lote>_linha_<linha_producao>')
    expect(error.message).toContain('lote_<lote>_subfase_<subfase>')
  })
})

describe('mvtParams: a grade XYZ da tile', () => {
  it('aceita a tile raiz', () => {
    expect(aceita(schema.mvtParams.validate({ id: '3', z: '0', x: '0', y: '0' })))
      .toEqual({ id: 3, z: 0, x: 0, y: 0 })
  })

  it('aceita o canto do nivel 4', () => {
    aceita(schema.mvtParams.validate({ id: '3', z: '4', x: '15', y: '15' }))
  })

  it('recusa zoom acima de 22', () => {
    // Fora da faixa o `ST_TileEnvelope` recusa com erro de PostGIS, que viraria
    // 500 -- e a tela diria "erro no servidor" para uma URL malformada.
    recusaPor(schema.mvtParams.validate({ id: '3', z: '23', x: '0', y: '0' }), 'z', 'number.max')
  })

  it('recusa coordenada fora da grade do zoom', () => {
    // O teto de `x` e `y` DEPENDE de `z` (2^z - 1). Um teto fixo aceitaria
    // (z=1, x=1000), que nao existe em mapa nenhum.
    recusaPor(
      schema.mvtParams.validate({ id: '3', z: '1', x: '2', y: '0' }), '', 'any.invalid'
    )
  })

  it('recusa coordenada negativa', () => {
    recusaPor(schema.mvtParams.validate({ id: '3', z: '2', x: '-1', y: '0' }), 'x', 'number.min')
  })
})

describe('finalizadoQuery', () => {
  it('aceita a ausencia do filtro', () => {
    expect(aceita(schema.finalizadoQuery.validate({}))).toEqual({})
  })

  it('converte o texto da query em booleano', () => {
    expect(aceita(schema.finalizadoQuery.validate({ finalizado: 'true' })))
      .toEqual({ finalizado: true })
  })

  it('recusa valor que nao e booleano', () => {
    recusaPor(
      schema.finalizadoQuery.validate({ finalizado: 'talvez' }),
      'finalizado',
      'boolean.base'
    )
  })
})
