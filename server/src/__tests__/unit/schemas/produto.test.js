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

  describe('renumeraVersoes', () => {
    const valido = {
      produto_id: 1,
      subtipo_produto_id: 2,
      familia: 'EDICAO',
      nova_data_edicao: '1957-01-01'
    }

    it('should validate correct request with familia EDICAO', () => {
      const { error } = produtoSchema.renumeraVersoes.validate(valido)
      expect(error).toBeUndefined()
    })

    it('should validate correct request with familia sigla (ex. DSG)', () => {
      const { error } = produtoSchema.renumeraVersoes.validate({
        ...valido, familia: 'DSG'
      })
      expect(error).toBeUndefined()
    })

    it('should reject lowercase familia', () => {
      const { error } = produtoSchema.renumeraVersoes.validate({
        ...valido, familia: 'dsg'
      })
      expect(error).toBeDefined()
    })

    it('should reject familia longer than 5 letters', () => {
      const { error } = produtoSchema.renumeraVersoes.validate({
        ...valido, familia: 'ABCDEF'
      })
      expect(error).toBeDefined()
    })

    it('should require produto_id', () => {
      const { error } = produtoSchema.renumeraVersoes.validate({
        ...valido, produto_id: undefined
      })
      expect(error).toBeDefined()
    })

    it('should require nova_data_edicao as a valid ISO date', () => {
      const { error } = produtoSchema.renumeraVersoes.validate({
        ...valido, nova_data_edicao: 'nao e uma data'
      })
      expect(error).toBeDefined()
    })
  })

  // Numa atualização, default silencioso é perda de dado: a chave ausente passa
  // a valer o default e sobrescreve o que está gravado. A ausência tem que
  // chegar ao controller como ausência, para ele preservar o valor atual.
  describe('atualização sem default silencioso', () => {
    it('produtoAtualizacao não inventa subtipo_produto_id quando a chave falta', () => {
      const { error, value } = produtoSchema.produtoAtualizacao.validate({
        id: 1,
        nome: 'Carta',
        mi: 'MI-001',
        inom: 'SF-22',
        tipo_escala_id: 2,
        denominador_escala_especial: null,
        tipo_produto_id: 1,
        descricao: ''
      })

      expect(error).toBeUndefined()
      expect('subtipo_produto_id' in value).toBe(false)
    })

    it('produtoAtualizacao continua aceitando subtipo_produto_id null explícito', () => {
      const { error, value } = produtoSchema.produtoAtualizacao.validate({
        id: 1,
        nome: 'Carta',
        mi: 'MI-001',
        inom: 'SF-22',
        tipo_escala_id: 2,
        denominador_escala_especial: null,
        tipo_produto_id: 1,
        subtipo_produto_id: null,
        descricao: ''
      })

      expect(error).toBeUndefined()
      expect(value.subtipo_produto_id).toBeNull()
    })

    it('versaoAtualizacao não zera palavras_chave quando a chave falta', () => {
      const { error, value } = produtoSchema.versaoAtualizacao.validate({
        id: 1,
        versao: '1-DSG',
        nome: 'Folha',
        tipo_versao_id: 1,
        subtipo_produto_id: 2,
        descricao: '',
        metadado: {},
        lote_id: null,
        orgao_produtor: 'DSG',
        data_criacao: '2024-01-01',
        data_edicao: '2024-01-02'
      })

      expect(error).toBeUndefined()
      expect('palavras_chave' in value).toBe(false)
    })
  })

  // A correção do uuid_versao para o identificador que o BDGEx já publicou.
  // Vive numa rota própria porque no PUT de versão o uuid_versao é IMUTÁVEL.
  describe('versaoUuidCorrecao', () => {
    const valido = {
      correcoes: [
        { versao_id: 6653, uuid_versao: '4fe8d788-dc4b-2f73-22c8-8d5e6090f06d' },
        { versao_id: 6654, uuid_versao: '02e6980b-c052-4f1a-91b8-a2e839565b39' }
      ],
      motivo: 'Identificador lido do BDGEx Op'
    }

    it('aceita um lote de correções com motivo', () => {
      const { error } = produtoSchema.versaoUuidCorrecao.validate(valido)
      expect(error).toBeUndefined()
    })

    it('exige o motivo: correção sem procedência é número trocado sem história', () => {
      const { error } = produtoSchema.versaoUuidCorrecao.validate({
        ...valido, motivo: undefined
      })
      expect(error).toBeDefined()
    })

    it('recusa lote vazio', () => {
      const { error } = produtoSchema.versaoUuidCorrecao.validate({
        ...valido, correcoes: []
      })
      expect(error).toBeDefined()
    })

    it('recusa o mesmo uuid para duas versões (a UNIQUE do banco não permitiria)', () => {
      const mesmo = '4fe8d788-dc4b-2f73-22c8-8d5e6090f06d'
      const { error } = produtoSchema.versaoUuidCorrecao.validate({
        ...valido,
        correcoes: [
          { versao_id: 6653, uuid_versao: mesmo },
          { versao_id: 6654, uuid_versao: mesmo }
        ]
      })
      expect(error).toBeDefined()
    })

    it('recusa a mesma versão duas vezes no lote', () => {
      const { error } = produtoSchema.versaoUuidCorrecao.validate({
        ...valido,
        correcoes: [
          { versao_id: 6653, uuid_versao: '4fe8d788-dc4b-2f73-22c8-8d5e6090f06d' },
          { versao_id: 6653, uuid_versao: '02e6980b-c052-4f1a-91b8-a2e839565b39' }
        ]
      })
      expect(error).toBeDefined()
    })

    it('recusa o que não é uuid', () => {
      const { error } = produtoSchema.versaoUuidCorrecao.validate({
        ...valido,
        correcoes: [{ versao_id: 6653, uuid_versao: 'nao-e-uuid' }]
      })
      expect(error).toBeDefined()
    })
  })
})
