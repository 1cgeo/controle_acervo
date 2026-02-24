'use strict'

const acervoSchema = require('../../../acervo/acervo_schema')

describe('Acervo Schemas', () => {
  describe('arquivosIds', () => {
    it('should validate array of unique integer ids', () => {
      const { error } = acervoSchema.arquivosIds.validate({
        arquivos_ids: [1, 2, 3]
      })
      expect(error).toBeUndefined()
    })

    it('should reject empty array', () => {
      const { error } = acervoSchema.arquivosIds.validate({
        arquivos_ids: []
      })
      expect(error).toBeDefined()
    })

    it('should reject non-unique ids', () => {
      const { error } = acervoSchema.arquivosIds.validate({
        arquivos_ids: [1, 1]
      })
      expect(error).toBeDefined()
    })
  })

  describe('produtosIdsComTipos', () => {
    it('should validate products and file types arrays', () => {
      const { error } = acervoSchema.produtosIdsComTipos.validate({
        produtos_ids: [1, 2],
        tipos_arquivo: [1, 3]
      })
      expect(error).toBeUndefined()
    })

    it('should require both arrays', () => {
      const { error } = acervoSchema.produtosIdsComTipos.validate({
        produtos_ids: [1]
      })
      expect(error).toBeDefined()
    })
  })

  describe('downloadConfirmations', () => {
    it('should validate download confirmations', () => {
      const { error } = acervoSchema.downloadConfirmations.validate({
        confirmations: [{
          download_token: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
          success: true,
          error_message: null
        }]
      })
      expect(error).toBeUndefined()
    })

    it('should require valid UUID for download_token', () => {
      const { error } = acervoSchema.downloadConfirmations.validate({
        confirmations: [{
          download_token: 'not-a-uuid',
          success: true
        }]
      })
      expect(error).toBeDefined()
    })
  })

  describe('buscaProdutos', () => {
    it('should use defaults for page and limit', () => {
      const { error, value } = acervoSchema.buscaProdutos.validate({})
      expect(error).toBeUndefined()
      expect(value.page).toBe(1)
      expect(value.limit).toBe(20)
    })

    it('should reject limit > 100', () => {
      const { error } = acervoSchema.buscaProdutos.validate({ limit: 101 })
      expect(error).toBeDefined()
    })

    it('should reject page < 1', () => {
      const { error } = acervoSchema.buscaProdutos.validate({ page: 0 })
      expect(error).toBeDefined()
    })
  })

  describe('situacaoGeralQuery', () => {
    it('should default all scales to false', () => {
      const { error, value } = acervoSchema.situacaoGeralQuery.validate({})
      expect(error).toBeUndefined()
      expect(value.scale25k).toBe(false)
      expect(value.scale50k).toBe(false)
    })

    it('should accept boolean values', () => {
      const { error } = acervoSchema.situacaoGeralQuery.validate({
        scale25k: true, scale50k: false
      })
      expect(error).toBeUndefined()
    })
  })
})
