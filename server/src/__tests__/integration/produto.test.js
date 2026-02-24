'use strict'

const { conn, cleanTestData, closeConnection } = require('../helpers/db')
const { createProduto, createVersao, createFullProduct } = require('../helpers/fixtures')
const { ADMIN_UUID } = require('../helpers/auth')

afterEach(async () => {
  await cleanTestData()
})

describe('Produto Integration', () => {
  describe('Product CRUD', () => {
    it('should create a product with valid geometry', async () => {
      const produto = await createProduto()
      expect(produto.id).toBeDefined()
      expect(produto.nome).toBe('Produto Teste')
      expect(produto.mi).toBe('MI-2345')
    })

    it('should update a product', async () => {
      const produto = await createProduto()
      await conn.none(`
        UPDATE acervo.produto SET nome = 'Atualizado', data_modificacao = NOW(), usuario_modificacao_uuid = $2
        WHERE id = $1
      `, [produto.id, ADMIN_UUID])

      const found = await conn.one('SELECT nome FROM acervo.produto WHERE id = $1', [produto.id])
      expect(found.nome).toBe('Atualizado')
    })

    it('should delete a product without versions', async () => {
      const produto = await createProduto()
      await conn.none('DELETE FROM acervo.produto WHERE id = $1', [produto.id])

      const count = await conn.one('SELECT COUNT(*)::int as count FROM acervo.produto WHERE id = $1', [produto.id])
      expect(count.count).toBe(0)
    })
  })

  describe('Version management', () => {
    it('should create a version for a product', async () => {
      const produto = await createProduto()
      const versao = await createVersao(produto.id)
      expect(versao.id).toBeDefined()
      expect(versao.uuid_versao).toBeDefined()
    })

    it('should enforce version format X-SIGLA', async () => {
      const produto = await createProduto()
      await expect(createVersao(produto.id, { versao: 'invalid-format' }))
        .rejects.toThrow()
    })

    it('should enforce sequential versions (cannot create 2-DSG without 1-DSG)', async () => {
      const produto = await createProduto()
      await expect(createVersao(produto.id, { versao: '2-DSG' }))
        .rejects.toThrow()
    })

    it('should allow creating sequential versions', async () => {
      const produto = await createProduto()
      await createVersao(produto.id, { versao: '1-DSG' })
      const v2 = await createVersao(produto.id, { versao: '2-DSG' })
      expect(v2.id).toBeDefined()
    })

    it('should enforce unique version per product', async () => {
      const produto = await createProduto()
      await createVersao(produto.id, { versao: '1-DSG' })
      await expect(createVersao(produto.id, { versao: '1-DSG' }))
        .rejects.toThrow()
    })
  })

  describe('Version relationships', () => {
    it('should create a relationship between two versions', async () => {
      const p1 = await createProduto({ nome: 'P1', mi: 'MI-001', inom: 'INOM-1' })
      const p2 = await createProduto({ nome: 'P2', mi: 'MI-002', inom: 'INOM-2' })
      const v1 = await createVersao(p1.id)
      const v2 = await createVersao(p2.id)

      await conn.none(`
        INSERT INTO acervo.versao_relacionamento (versao_id_1, versao_id_2, tipo_relacionamento_id, usuario_relacionamento_uuid)
        VALUES ($1, $2, 1, $3)
      `, [v1.id, v2.id, ADMIN_UUID])

      const rel = await conn.one('SELECT * FROM acervo.versao_relacionamento WHERE versao_id_1 = $1', [v1.id])
      expect(rel.versao_id_2).toBe(v2.id)
    })
  })

  describe('Cascade operations', () => {
    it('should handle full product chain creation', async () => {
      const chain = await createFullProduct()
      expect(chain.produto.id).toBeDefined()
      expect(chain.versao.id).toBeDefined()
      expect(chain.arquivo.id).toBeDefined()
    })

    it('should track arquivo_deletado when deleting files', async () => {
      const chain = await createFullProduct()

      // Move file to deleted table
      await conn.one(`
        INSERT INTO acervo.arquivo_deletado (uuid_arquivo, nome, nome_arquivo, motivo_exclusao, versao_id, tipo_arquivo_id, volume_armazenamento_id, extensao, tamanho_mb, checksum, metadado, tipo_status_id, situacao_carregamento_id, descricao, crs_original, data_cadastramento, usuario_cadastramento_uuid, data_delete, usuario_delete_uuid)
        SELECT uuid_arquivo, nome, nome_arquivo, 'teste', versao_id, tipo_arquivo_id, volume_armazenamento_id, extensao, tamanho_mb, checksum, metadado, 4, situacao_carregamento_id, descricao, crs_original, data_cadastramento, usuario_cadastramento_uuid, NOW(), $2
        FROM acervo.arquivo WHERE id = $1 RETURNING id
      `, [chain.arquivo.id, ADMIN_UUID])

      const deleted = await conn.one('SELECT COUNT(*)::int as count FROM acervo.arquivo_deletado')
      expect(deleted.count).toBe(1)
    })
  })
})
