'use strict'

// O CONTRATO DAS OITO ROTAS DE `/api/distribuicao`, provado pelo MOTIVO da
// recusa.
//
// Cada caso abaixo prende o campo E a regra do Joi (`recusaPor` de
// `helpers/joi.js`): `expect(error).toBeDefined()` passaria com qualquer recusa
// acidental, e e exatamente esse acidente que estes testes existem para pegar.

const schema = require('../../../distribuicao/distribuicao_schema')
const { recusaPor, aceita } = require('../../helpers/joi')

const POLIGONO = 'SRID=4674;POLYGON((-43 -22,-43 -23,-44 -23,-44 -22,-43 -22))'

describe('Schema de /finaliza', () => {
  it('aceita o corpo minimo: so a atividade', () => {
    aceita(schema.finaliza.validate({ atividade_id: 12 }))
  })

  it('exige a atividade: sem ela nao ha o que finalizar', () => {
    recusaPor(schema.finaliza.validate({}), 'atividade_id', 'any.required')
  })

  // `.strict()` em toda a casa: '12' vindo de query string ou de JSON mal
  // montado nao vira 12 em silencio.
  it('recusa a atividade em texto, e nao a converte', () => {
    recusaPor(
      schema.finaliza.validate({ atividade_id: '12' }),
      'atividade_id',
      'number.base'
    )
  })

  // A lista de alteracoes de fluxo e FECHADA e vive no schema, porque
  // `producao.alteracao_fluxo.descricao` e TEXTO e nao chave estrangeira: se o
  // Joi aceitar qualquer frase, a tela de acompanhamento passa a mostrar o que
  // cada um digitou.
  it.each(schema.ALTERACOES_DE_FLUXO)('aceita a alteracao de fluxo "%s"', frase => {
    aceita(schema.finaliza.validate({ atividade_id: 1, alterar_fluxo: frase }))
  })

  it('recusa alteracao de fluxo fora do enum', () => {
    recusaPor(
      schema.finaliza.validate({ atividade_id: 1, alterar_fluxo: 'Refazer tudo' }),
      'alterar_fluxo',
      'any.only'
    )
  })

  // O METADADO APONTA `versao_id`, e NAO `produto_id`. No SAP o campo se chamava
  // `produto_id` e apontava `macrocontrole.produto`, que era a folha DAQUELE
  // lote; aqui `acervo.produto` e a folha ETERNA e quem a producao entrega e uma
  // `acervo.versao`. Os dois sao BIGINT, entao manter o nome antigo faria o
  // plugin mandar o id de uma coisa e o servidor gravar noutra, sem erro visivel.
  it('recusa o produto_id do SAP no lugar do versao_id', () => {
    recusaPor(
      schema.finaliza.validate({
        atividade_id: 1,
        info_edicao: [{ produto_id: 5, nome_produto: 'Petrópolis', palavras_chave: [] }]
      }),
      ['info_edicao', 0, 'versao_id'],
      'any.required'
    )
  })

  it('recusa a mesma versao duas vezes no info_edicao', () => {
    recusaPor(
      schema.finaliza.validate({
        atividade_id: 1,
        info_edicao: [
          { versao_id: 5, nome_produto: 'A', palavras_chave: [] },
          { versao_id: 5, nome_produto: 'B', palavras_chave: [] }
        ]
      }),
      ['info_edicao', 1],
      'array.unique'
    )
  })

  it('recusa a mesma palavra-chave duas vezes na mesma versao', () => {
    recusaPor(
      schema.finaliza.validate({
        atividade_id: 1,
        info_edicao: [{
          versao_id: 5,
          nome_produto: 'A',
          palavras_chave: [
            { nome: 'Petrópolis', tipo_palavra_chave_id: 1 },
            { nome: 'Petrópolis', tipo_palavra_chave_id: 2 }
          ]
        }]
      }),
      ['info_edicao', 0, 'palavras_chave', 1],
      'array.unique'
    )
  })

  // A lista pode ser VAZIA (a folha sem toponimo declarado), mas nao pode
  // FALTAR: ausencia e "nao mexi" e vazio e "apague todas", e a rota apaga e
  // reinsere. Sem o required, os dois casos chegariam iguais ao controller.
  it('exige a lista de palavras-chave, ainda que vazia', () => {
    aceita(schema.finaliza.validate({
      atividade_id: 1,
      info_edicao: [{ versao_id: 5, nome_produto: 'A', palavras_chave: [] }]
    }))

    recusaPor(
      schema.finaliza.validate({
        atividade_id: 1,
        info_edicao: [{ versao_id: 5, nome_produto: 'A' }]
      }),
      ['info_edicao', 0, 'palavras_chave'],
      'any.required'
    )
  })
})

describe('Schema de /metadados_edicao', () => {
  it('aceita uma versao com palavras-chave', () => {
    aceita(schema.metadadoEdicao.validate({
      metadados: [{
        versao_id: 9,
        nome_produto: 'Petrópolis',
        palavras_chave: [{ nome: 'Petrópolis', tipo_palavra_chave_id: 1 }]
      }]
    }))
  })

  it('exige a lista de metadados', () => {
    recusaPor(schema.metadadoEdicao.validate({}), 'metadados', 'any.required')
  })

  // Lista vazia e chamada sem efeito: ou o cliente tem o que gravar, ou nao
  // chama a rota.
  it('recusa a lista vazia', () => {
    recusaPor(
      schema.metadadoEdicao.validate({ metadados: [] }),
      'metadados',
      'array.min'
    )
  })
})

describe('Schema de /problema_atividade', () => {
  const corpo = (extra = {}) => ({
    atividade_id: 3,
    tipo_problema_id: 1,
    descricao: 'Insumo faltando na porção norte',
    polygon_ewkt: POLIGONO,
    ...extra
  })

  it('aceita o corpo completo', () => {
    aceita(schema.problemaAtividade.validate(corpo()))
  })

  // 'Outros' e 99, e nao 8: a lacuna existe para o catalogo crescer pelo fim sem
  // que ele deixe de ser o ultimo da lista.
  it('aceita o code 99 (Outros), que nao e sequencial', () => {
    aceita(schema.problemaAtividade.validate(corpo({ tipo_problema_id: 99 })))
  })

  // O 8 nao existe em `dominio.tipo_problema_atividade`. Sem o `valid`, ele
  // passaria pelo Joi e morreria na chave estrangeira, como 500 em vez de 400.
  it('recusa o code 8, que a chave estrangeira recusaria como 500', () => {
    recusaPor(
      schema.problemaAtividade.validate(corpo({ tipo_problema_id: 8 })),
      'tipo_problema_id',
      'any.only'
    )
  })

  // A coluna e `geometry(POLYGON, 4674)` e a geometria chega na projecao de
  // EDICAO da unidade de trabalho. Sem o SRID no EWKT o `ST_GeomFromEWKT`
  // produz SRID 0 e o INSERT morre com "Geometry SRID (0) does not match column
  // SRID (4674)" -- um 500 onde a resposta certa e 400.
  it('recusa o EWKT sem SRID, que viraria erro de SRID no INSERT', () => {
    recusaPor(
      schema.problemaAtividade.validate(
        corpo({ polygon_ewkt: 'POLYGON((-43 -22,-43 -23,-44 -23,-44 -22,-43 -22))' })
      ),
      'polygon_ewkt',
      'string.pattern.base'
    )
  })

  it('exige a geometria: "ha um problema nesta folha" nao ajuda ninguem', () => {
    const semGeom = corpo()
    delete semGeom.polygon_ewkt
    recusaPor(
      schema.problemaAtividade.validate(semGeom),
      'polygon_ewkt',
      'any.required'
    )
  })

  it('exige a descricao', () => {
    const semDescricao = corpo()
    delete semDescricao.descricao
    recusaPor(
      schema.problemaAtividade.validate(semDescricao),
      'descricao',
      'any.required'
    )
  })
})

describe('Schema de /finalizacao_incorreta', () => {
  it('aceita a descricao', () => {
    aceita(schema.finalizacaoIncorreta.validate({ descricao: 'Cliquei sem querer' }))
  })

  it('exige a descricao', () => {
    recusaPor(
      schema.finalizacaoIncorreta.validate({}),
      'descricao',
      'any.required'
    )
  })
})
