'use strict'

const arquivoSchema = require('../../../arquivo/arquivo_schema')

describe('Arquivo Schemas', () => {
  describe('arquivoAtualizacao', () => {
    const valid = {
      id: 1,
      nome: 'arquivo_1',
      tipo_arquivo_id: 1,
      volume_armazenamento_id: 1,
      metadado: {},
      tipo_status_id: 1,
      situacao_carregamento_id: 1,
      descricao: ''
    }

    it('should validate correct file update', () => {
      const { error } = arquivoSchema.arquivoAtualizacao.validate(valid)
      expect(error).toBeUndefined()
    })

    it('should require id', () => {
      const { id, ...noId } = valid
      const { error } = arquivoSchema.arquivoAtualizacao.validate(noId)
      expect(error).toBeDefined()
    })

    it('should require id as strict integer', () => {
      const { error } = arquivoSchema.arquivoAtualizacao.validate({
        ...valid, id: 'abc'
      })
      expect(error).toBeDefined()
    })

    it('should require nome', () => {
      const { error } = arquivoSchema.arquivoAtualizacao.validate({
        ...valid, nome: undefined
      })
      expect(error).toBeDefined()
    })

    it('should require metadado as object', () => {
      const { error } = arquivoSchema.arquivoAtualizacao.validate({
        ...valid, metadado: 'not-object'
      })
      expect(error).toBeDefined()
    })

    it('should allow empty descricao', () => {
      const { error } = arquivoSchema.arquivoAtualizacao.validate({
        ...valid, descricao: ''
      })
      expect(error).toBeUndefined()
    })

    it('should allow optional crs_original', () => {
      const { error } = arquivoSchema.arquivoAtualizacao.validate({
        ...valid, crs_original: 'EPSG:4674'
      })
      expect(error).toBeUndefined()
    })

    it('should reject crs_original longer than 10 chars', () => {
      const { error } = arquivoSchema.arquivoAtualizacao.validate({
        ...valid, crs_original: 'EPSG:467412345'
      })
      expect(error).toBeDefined()
    })
  })

  describe('arquivoIds', () => {
    it('should validate with motivo_exclusao', () => {
      const { error } = arquivoSchema.arquivoIds.validate({
        arquivo_ids: [1, 2],
        motivo_exclusao: 'Substituicao'
      })
      expect(error).toBeUndefined()
    })

    it('should reject without motivo_exclusao', () => {
      const { error } = arquivoSchema.arquivoIds.validate({
        arquivo_ids: [1]
      })
      expect(error).toBeDefined()
    })

    it('should reject empty arquivo_ids array', () => {
      const { error } = arquivoSchema.arquivoIds.validate({
        arquivo_ids: [],
        motivo_exclusao: 'motivo'
      })
      expect(error).toBeDefined()
    })

    it('should reject duplicate ids', () => {
      const { error } = arquivoSchema.arquivoIds.validate({
        arquivo_ids: [1, 1],
        motivo_exclusao: 'motivo'
      })
      expect(error).toBeDefined()
    })

    it('should require strict integer ids', () => {
      const { error } = arquivoSchema.arquivoIds.validate({
        arquivo_ids: ['abc'],
        motivo_exclusao: 'motivo'
      })
      expect(error).toBeDefined()
    })
  })

  describe('prepareAddFiles', () => {
    const validFile = {
      nome: 'test',
      nome_arquivo: 'test_file',
      tipo_arquivo_id: 1,
      extensao: 'gpkg',
      tamanho_mb: 50,
      checksum: 'abc123',
      versao_id: 1
    }

    it('should validate files with required fields', () => {
      const { error } = arquivoSchema.prepareAddFiles.validate({
        arquivos: [validFile]
      })
      expect(error).toBeUndefined()
    })

    it('should allow null extensao/tamanho/checksum for tipo_arquivo_id=9 (Tileserver)', () => {
      const { error } = arquivoSchema.prepareAddFiles.validate({
        arquivos: [{
          nome: 'tiles',
          nome_arquivo: 'https://tiles.example.com',
          tipo_arquivo_id: 9,
          extensao: null,
          tamanho_mb: null,
          checksum: null,
          versao_id: 1
        }]
      })
      expect(error).toBeUndefined()
    })

    it('should require extensao for non-tileserver types', () => {
      const { error } = arquivoSchema.prepareAddFiles.validate({
        arquivos: [{
          nome: 'test',
          nome_arquivo: 'test_file',
          tipo_arquivo_id: 1,
          tamanho_mb: 50,
          checksum: 'abc',
          versao_id: 1
        }]
      })
      expect(error).toBeDefined()
    })

    it('should require tamanho_mb for non-tileserver types', () => {
      const { error } = arquivoSchema.prepareAddFiles.validate({
        arquivos: [{
          nome: 'test',
          nome_arquivo: 'test_file',
          tipo_arquivo_id: 1,
          extensao: 'gpkg',
          checksum: 'abc',
          versao_id: 1
        }]
      })
      expect(error).toBeDefined()
    })

    it('should require checksum for non-tileserver types', () => {
      const { error } = arquivoSchema.prepareAddFiles.validate({
        arquivos: [{
          nome: 'test',
          nome_arquivo: 'test_file',
          tipo_arquivo_id: 1,
          extensao: 'gpkg',
          tamanho_mb: 50,
          versao_id: 1
        }]
      })
      expect(error).toBeDefined()
    })

    it('should require at least one arquivo', () => {
      const { error } = arquivoSchema.prepareAddFiles.validate({
        arquivos: []
      })
      expect(error).toBeDefined()
    })

    it('should require versao_id for each file', () => {
      const { error } = arquivoSchema.prepareAddFiles.validate({
        arquivos: [{
          nome: 'test',
          nome_arquivo: 'test_file',
          tipo_arquivo_id: 1,
          extensao: 'gpkg',
          tamanho_mb: 50,
          checksum: 'abc'
        }]
      })
      expect(error).toBeDefined()
    })

    it('should allow optional uuid_arquivo', () => {
      const { error } = arquivoSchema.prepareAddFiles.validate({
        arquivos: [{
          ...validFile,
          uuid_arquivo: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'
        }]
      })
      expect(error).toBeUndefined()
    })

    it('should allow null metadado', () => {
      const { error } = arquivoSchema.prepareAddFiles.validate({
        arquivos: [{
          ...validFile,
          metadado: null
        }]
      })
      expect(error).toBeUndefined()
    })
  })

  describe('confirmUpload', () => {
    it('should validate UUID session', () => {
      const { error } = arquivoSchema.confirmUpload.validate({
        session_uuid: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'
      })
      expect(error).toBeUndefined()
    })

    it('should reject non-UUID', () => {
      const { error } = arquivoSchema.confirmUpload.validate({
        session_uuid: 'not-uuid'
      })
      expect(error).toBeDefined()
    })

    it('should require session_uuid', () => {
      const { error } = arquivoSchema.confirmUpload.validate({})
      expect(error).toBeDefined()
    })
  })

  describe('cancelUpload', () => {
    it('should validate UUID session', () => {
      const { error } = arquivoSchema.cancelUpload.validate({
        session_uuid: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'
      })
      expect(error).toBeUndefined()
    })

    it('should reject non-UUID', () => {
      const { error } = arquivoSchema.cancelUpload.validate({
        session_uuid: 'invalid'
      })
      expect(error).toBeDefined()
    })
  })

  describe('prepareAddVersion', () => {
    const validVersion = {
      versoes: [{
        produto_id: 1,
        versao: {
          uuid_versao: null,
          versao: '1.0.0',
          nome: 'Versao teste',
          tipo_versao_id: 1,
          subtipo_produto_id: 1,
          lote_id: null,
          metadado: null,
          descricao: '',
          orgao_produtor: 'DSG',
          palavras_chave: [],
          data_criacao: '2024-01-01T00:00:00.000Z',
          data_edicao: '2024-01-01T00:00:00.000Z'
        },
        arquivos: [{
          nome: 'test',
          nome_arquivo: 'test_file',
          tipo_arquivo_id: 1,
          extensao: 'gpkg',
          tamanho_mb: 50,
          checksum: 'abc123'
        }]
      }]
    }

    it('should validate correct version data', () => {
      const { error } = arquivoSchema.prepareAddVersion.validate(validVersion)
      expect(error).toBeUndefined()
    })

    it('should require at least one versao', () => {
      const { error } = arquivoSchema.prepareAddVersion.validate({ versoes: [] })
      expect(error).toBeDefined()
    })

    it('should require produto_id', () => {
      const { error } = arquivoSchema.prepareAddVersion.validate({
        versoes: [{
          versao: validVersion.versoes[0].versao,
          arquivos: validVersion.versoes[0].arquivos
        }]
      })
      expect(error).toBeDefined()
    })
  })

  describe('prepareAddProduct', () => {
    const validProduct = {
      produtos: [{
        produto: {
          nome: 'Carta Teste',
          mi: 'MI-001',
          inom: 'SF-22',
          tipo_escala_id: 2,
          denominador_escala_especial: null,
          tipo_produto_id: 1,
          descricao: '',
          geom: 'SRID=4674;POLYGON((-50 -25, -49 -25, -49 -24, -50 -24, -50 -25))'
        },
        versoes: [{
          uuid_versao: null,
          versao: '1.0.0',
          nome: 'Versao 1',
          tipo_versao_id: 1,
          subtipo_produto_id: 1,
          lote_id: null,
          metadado: null,
          descricao: '',
          orgao_produtor: 'DSG',
          palavras_chave: [],
          data_criacao: '2024-01-01T00:00:00.000Z',
          data_edicao: '2024-01-01T00:00:00.000Z',
          arquivos: [{
            nome: 'arquivo1',
            nome_arquivo: 'arquivo1.gpkg',
            tipo_arquivo_id: 1,
            extensao: 'gpkg',
            tamanho_mb: 100,
            checksum: 'hash123'
          }]
        }]
      }]
    }

    it('should validate correct product data', () => {
      const { error } = arquivoSchema.prepareAddProduct.validate(validProduct)
      expect(error).toBeUndefined()
    })

    it('should require geom in produto', () => {
      const invalid = JSON.parse(JSON.stringify(validProduct))
      delete invalid.produtos[0].produto.geom
      const { error } = arquivoSchema.prepareAddProduct.validate(invalid)
      expect(error).toBeDefined()
    })

    it('should require at least one produto', () => {
      const { error } = arquivoSchema.prepareAddProduct.validate({ produtos: [] })
      expect(error).toBeDefined()
    })
  })
})
