'use strict'

const produtoSchema = require('../../../produto/produto_schema')

describe('Produto Schemas', () => {
  describe('produtoAtualizacao', () => {
    const validProduto = {
      id: 1,
      nome: 'Carta Teste',
      tipo_escala_id: 2,
      denominador_escala_especial: null,
      tipo_produto_id: 1,
      descricao: ''
    }

    it('should validate correct product update', () => {
      const { error } = produtoSchema.produtoAtualizacao.validate(validProduto)
      expect(error).toBeUndefined()
    })

    it('should require id as integer', () => {
      const { error } = produtoSchema.produtoAtualizacao.validate({
        ...validProduto, id: 'abc'
      })
      expect(error).toBeDefined()
    })

    it('should require nome', () => {
      const { error } = produtoSchema.produtoAtualizacao.validate({
        ...validProduto, nome: undefined
      })
      expect(error).toBeDefined()
    })

    it('should allow optional geom', () => {
      const { error } = produtoSchema.produtoAtualizacao.validate({
        ...validProduto, geom: 'SRID=4674;POLYGON((-50 -25, -49 -25, -49 -24, -50 -24, -50 -25))'
      })
      expect(error).toBeUndefined()
    })

    it('should allow null geom', () => {
      const { error } = produtoSchema.produtoAtualizacao.validate({
        ...validProduto, geom: null
      })
      expect(error).toBeUndefined()
    })
  })

  describe('produtoIds', () => {
    it('should validate array of unique integer ids with motivo', () => {
      const { error } = produtoSchema.produtoIds.validate({
        produto_ids: [1, 2, 3],
        motivo_exclusao: 'Dados incorretos'
      })
      expect(error).toBeUndefined()
    })

    it('should reject empty array', () => {
      const { error } = produtoSchema.produtoIds.validate({
        produto_ids: [],
        motivo_exclusao: 'motivo'
      })
      expect(error).toBeDefined()
    })

    it('should reject duplicate ids', () => {
      const { error } = produtoSchema.produtoIds.validate({
        produto_ids: [1, 1],
        motivo_exclusao: 'motivo'
      })
      expect(error).toBeDefined()
    })

    it('should require motivo_exclusao', () => {
      const { error } = produtoSchema.produtoIds.validate({
        produto_ids: [1]
      })
      expect(error).toBeDefined()
    })
  })

  describe('versaoRelacionamento', () => {
    it('should validate correct relationship creation', () => {
      const { error } = produtoSchema.versaoRelacionamento.validate({
        versao_relacionamento: [
          { versao_id_1: 1, versao_id_2: 2, tipo_relacionamento_id: 1 }
        ]
      })
      expect(error).toBeUndefined()
    })

    it('should reject non-integer versao ids', () => {
      const { error } = produtoSchema.versaoRelacionamento.validate({
        versao_relacionamento: [
          { versao_id_1: 'a', versao_id_2: 2, tipo_relacionamento_id: 1 }
        ]
      })
      expect(error).toBeDefined()
    })

    it('should require at least one relationship', () => {
      const { error } = produtoSchema.versaoRelacionamento.validate({
        versao_relacionamento: []
      })
      expect(error).toBeDefined()
    })
  })

  describe('produtos (bulk create)', () => {
    it('should validate bulk create with valid data', () => {
      const { error } = produtoSchema.produtos.validate({
        produtos: [{
          nome: 'Carta 1',
          mi: 'MI-001',
          inom: 'SF-22',
          tipo_escala_id: 2,
          denominador_escala_especial: null,
          tipo_produto_id: 1,
          descricao: null,
          geom: 'SRID=4674;POLYGON((-50 -25, -49 -25, -49 -24, -50 -24, -50 -25))'
        }]
      })
      expect(error).toBeUndefined()
    })

    it('should require geom for each product', () => {
      const { error } = produtoSchema.produtos.validate({
        produtos: [{
          nome: 'Carta 1',
          mi: 'MI-001',
          inom: 'SF-22',
          tipo_escala_id: 2,
          denominador_escala_especial: null,
          tipo_produto_id: 1,
          descricao: null
        }]
      })
      expect(error).toBeDefined()
    })
  })
})
