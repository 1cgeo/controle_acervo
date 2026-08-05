'use strict'

// As rotas de /api/integracao NAO tem autenticacao (decisao registrada no
// CLAUDE.md: o vault da DGEO as consome sem credencial). O schema e a UNICA
// porta dessas rotas, entao aqui a recusa de chave desconhecida nao e estilo:
// o `schema_validation` do SCA descarta chave desconhecida e responde 200, e
// estes schemas fecham essa porta de proposito.

const integracaoSchema = require('../../../integracao/integracao_schema')
const { recusaPor, aceita } = require('../../helpers/joi')

describe('Schemas da integracao (rotas publicas)', () => {
  describe('situacaoGeralQuery', () => {
    it('aceita escala conhecida e geom nasce false', () => {
      const value = aceita(integracaoSchema.situacaoGeralQuery.validate({ escala: '50k' }))
      expect(value.geom).toBe(false)
    })

    it('sem escala, varre todas', () => {
      aceita(integracaoSchema.situacaoGeralQuery.validate({}))
    })

    it('recusa escala que nao existe no dominio', () => {
      recusaPor(
        integracaoSchema.situacaoGeralQuery.validate({ escala: '500k' }),
        'escala',
        'any.only'
      )
    })

    // A query string entrega texto. Sem a conversao, `geom=true` seria a string
    // 'true', que e verdadeira em JS: a rota devolveria geometria SEMPRE, e o
    // vault baixaria o poligono de todo o acervo sem ter pedido.
    it('converte geom de texto para booleano', () => {
      const value = aceita(integracaoSchema.situacaoGeralQuery.validate({ geom: 'true' }))
      expect(value.geom).toBe(true)
    })

    it('aceita mi e inom como lista separada por virgula', () => {
      aceita(integracaoSchema.situacaoGeralQuery.validate({
        mi: '2753-1,2754-2', inom: 'SF-22-Y-C-I-1'
      }))
    })

    it('recusa chave desconhecida: e rota sem autenticacao', () => {
      recusaPor(
        integracaoSchema.situacaoGeralQuery.validate({ foo: 'bar' }),
        'foo',
        'object.unknown'
      )
    })
  })

  describe('produtosFinalizadosQuery', () => {
    // O default e o mes CORRENTE, e quem o calcula e o schema, no `validate`.
    // Sao portanto DUAS leituras de relogio: a do schema e a do teste. Na virada
    // do mes elas discordam e o caso reprovaria sem defeito nenhum, entao o
    // relogio fica CONGELADO num instante conhecido.
    it('sem parametro, ano e mes correntes e cumulativo ligado', () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-06-15T12:00:00Z'))
      try {
        const value = aceita(integracaoSchema.produtosFinalizadosQuery.validate({}))
        expect(value.ano).toBe(2026)
        expect(value.mes).toBe(6)
        expect(value.cumulativo).toBe(true)
      } finally {
        jest.useRealTimers()
      }
    })

    it('aceita ano, mes e cumulativo explicitos', () => {
      const value = aceita(integracaoSchema.produtosFinalizadosQuery.validate({
        ano: 2026, mes: 6, cumulativo: false
      }))
      expect(value).toMatchObject({ ano: 2026, mes: 6, cumulativo: false })
    })

    // As bordas VALIDAS entram no mesmo caso: sem elas, um schema que recusasse
    // qualquer mes passaria nos dois valores de fora.
    it('mes vai de 1 a 12, e as bordas de fora sao recusadas pelo limite', () => {
      expect(aceita(integracaoSchema.produtosFinalizadosQuery.validate({ mes: 1 })).mes).toBe(1)
      expect(aceita(integracaoSchema.produtosFinalizadosQuery.validate({ mes: 12 })).mes).toBe(12)

      recusaPor(
        integracaoSchema.produtosFinalizadosQuery.validate({ mes: 0 }),
        'mes',
        'number.min'
      )
      recusaPor(
        integracaoSchema.produtosFinalizadosQuery.validate({ mes: 13 }),
        'mes',
        'number.max'
      )
    })

    it('aceita os filtros de dominio', () => {
      aceita(integracaoSchema.produtosFinalizadosQuery.validate({
        tipo_produto_id: 2, tipo_escala_id: 2
      }))
    })
  })

  describe('atendimentosQuery', () => {
    it('sem parametro, mes corrente e cumulativo ligado', () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-06-15T12:00:00Z'))
      try {
        const value = aceita(integracaoSchema.atendimentosQuery.validate({}))
        expect(value.cumulativo).toBe(true)
        expect(value.mes).toBe(6)
      } finally {
        jest.useRealTimers()
      }
    })

    it('recusa chave desconhecida: e rota sem autenticacao', () => {
      recusaPor(
        integracaoSchema.atendimentosQuery.validate({ formato: 'csv' }),
        'formato',
        'object.unknown'
      )
    })
  })
})
