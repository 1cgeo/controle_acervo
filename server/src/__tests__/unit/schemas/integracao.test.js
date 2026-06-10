'use strict'

const integracaoSchema = require('../../../integracao/integracao_schema')

describe('Integracao Schemas', () => {
  describe('situacaoGeralQuery', () => {
    it('should accept a valid escala and default geom to false', () => {
      const { error, value } = integracaoSchema.situacaoGeralQuery.validate({ escala: '50k' })
      expect(error).toBeUndefined()
      expect(value.geom).toBe(false)
    })

    it('should accept no escala (varre todas)', () => {
      const { error } = integracaoSchema.situacaoGeralQuery.validate({})
      expect(error).toBeUndefined()
    })

    it('should reject an invalid escala', () => {
      const { error } = integracaoSchema.situacaoGeralQuery.validate({ escala: '500k' })
      expect(error).toBeDefined()
    })

    it('should coerce geom from string', () => {
      const { error, value } = integracaoSchema.situacaoGeralQuery.validate({ geom: 'true' })
      expect(error).toBeUndefined()
      expect(value.geom).toBe(true)
    })

    it('should accept mi/inom csv strings', () => {
      const { error } = integracaoSchema.situacaoGeralQuery.validate({ mi: '2753-1,2754-2', inom: 'SF-22-Y-C-I-1' })
      expect(error).toBeUndefined()
    })

    it('should reject unknown query keys', () => {
      const { error } = integracaoSchema.situacaoGeralQuery.validate({ foo: 'bar' })
      expect(error).toBeDefined()
    })
  })

  describe('produtosFinalizadosQuery', () => {
    it('should apply defaults: ano/mes corrente e cumulativo true', () => {
      const { error, value } = integracaoSchema.produtosFinalizadosQuery.validate({})
      expect(error).toBeUndefined()
      expect(value.ano).toBe(new Date().getFullYear())
      expect(value.mes).toBe(new Date().getMonth() + 1)
      expect(value.cumulativo).toBe(true)
    })

    it('should accept ano, mes e cumulativo explicitos', () => {
      const { error, value } = integracaoSchema.produtosFinalizadosQuery.validate({ ano: 2026, mes: 6, cumulativo: false })
      expect(error).toBeUndefined()
      expect(value.cumulativo).toBe(false)
    })

    it('should reject mes fora de 1..12', () => {
      expect(integracaoSchema.produtosFinalizadosQuery.validate({ mes: 0 }).error).toBeDefined()
      expect(integracaoSchema.produtosFinalizadosQuery.validate({ mes: 13 }).error).toBeDefined()
    })

    it('should accept optional tipo_produto_id/tipo_escala_id', () => {
      const { error } = integracaoSchema.produtosFinalizadosQuery.validate({ tipo_produto_id: 2, tipo_escala_id: 2 })
      expect(error).toBeUndefined()
    })
  })

  describe('atendimentosQuery', () => {
    it('should apply defaults', () => {
      const { error, value } = integracaoSchema.atendimentosQuery.validate({})
      expect(error).toBeUndefined()
      expect(value.cumulativo).toBe(true)
      expect(value.mes).toBe(new Date().getMonth() + 1)
    })

    it('should reject unknown keys', () => {
      const { error } = integracaoSchema.atendimentosQuery.validate({ formato: 'csv' })
      expect(error).toBeDefined()
    })
  })
})
