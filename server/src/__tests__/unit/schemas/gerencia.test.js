'use strict'

const gerenciaSchema = require('../../../gerencia/gerencia_schema')

describe('Gerencia Schemas', () => {
  describe('paginationParams', () => {
    it('should use defaults', () => {
      const { error, value } = gerenciaSchema.paginationParams.validate({})
      expect(error).toBeUndefined()
      expect(value.page).toBe(1)
      expect(value.limit).toBe(20)
    })

    it('should reject page < 1', () => {
      const { error } = gerenciaSchema.paginationParams.validate({ page: 0 })
      expect(error).toBeDefined()
    })

    it('should reject negative page', () => {
      const { error } = gerenciaSchema.paginationParams.validate({ page: -1 })
      expect(error).toBeDefined()
    })

    it('should reject limit > 100', () => {
      const { error } = gerenciaSchema.paginationParams.validate({ limit: 200 })
      expect(error).toBeDefined()
    })

    it('should reject limit < 1', () => {
      const { error } = gerenciaSchema.paginationParams.validate({ limit: 0 })
      expect(error).toBeDefined()
    })

    it('should accept valid page and limit', () => {
      const { error, value } = gerenciaSchema.paginationParams.validate({ page: 5, limit: 50 })
      expect(error).toBeUndefined()
      expect(value.page).toBe(5)
      expect(value.limit).toBe(50)
    })

    it('should accept limit at max boundary (100)', () => {
      const { error } = gerenciaSchema.paginationParams.validate({ limit: 100 })
      expect(error).toBeUndefined()
    })

    it('should reject non-integer page', () => {
      const { error } = gerenciaSchema.paginationParams.validate({ page: 1.5 })
      expect(error).toBeDefined()
    })

    it('should reject non-integer limit', () => {
      const { error } = gerenciaSchema.paginationParams.validate({ limit: 10.5 })
      expect(error).toBeDefined()
    })
  })
})
