'use strict'

const { conn, cleanTestData, closeConnection } = require('../helpers/db')
const { createProduto, createVersao, createFullProduct } = require('../helpers/fixtures')
const { ADMIN_UUID } = require('../helpers/auth')
const { getApp } = require('../helpers/app')
const produtoCtrl = require('../../produto/produto_ctrl')

// renumeraVersoes chama produtoCtrl direto (nao via rota), entao precisa que
// database/db.js esteja inicializado (db.conn) -- getApp() faz isso como efeito
// colateral, mesmo sem usarmos o app retornado.
beforeAll(async () => {
  await getApp()
})

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

  describe('Identidade do produto pelo subtipo (militar = produto proprio)', () => {
    // Modelo desde 2026-07-06 (chefe): a Carta Topografica Militar (subtipo 24) e um
    // produto DISTINTO do civil no mesmo MI; a chave de identidade e o subtipo, nao o tipo.
    it('rejeita versao militar (subtipo 24) num produto civil (subtipo NULL)', async () => {
      const civil = await createProduto({ tipo_produto_id: 2 })
      await expect(createVersao(civil.id, { versao: '1ª Edição', subtipo_produto_id: 24, tipo_versao_id: 2 }))
        .rejects.toThrow()
    })

    it('aceita versao militar num produto militar (subtipo 24)', async () => {
      const militar = await createProduto({ tipo_produto_id: 2, subtipo_produto_id: 24 })
      const v = await createVersao(militar.id, { versao: '1ª Edição', subtipo_produto_id: 24, tipo_versao_id: 2 })
      expect(v.id).toBeDefined()
    })

    it('rejeita versao de outro subtipo num produto militar (subtipo 24)', async () => {
      const militar = await createProduto({ tipo_produto_id: 2, subtipo_produto_id: 24 })
      await expect(createVersao(militar.id, { versao: '1ª Edição', subtipo_produto_id: 2, tipo_versao_id: 2 }))
        .rejects.toThrow()
    })

    it('a Carta Militar (24) e a civil (NULL) coexistem como produtos separados na mesma folha', async () => {
      // A unicidade de produto passou a considerar o subtipo (INOM, tipo, subtipo)
      // quando ele exige produto proprio, espelhando o prepare-upload/product.
      const inom = 'SG-99-Z-Z-I-1-NE'
      const civil = await createProduto({ inom, tipo_produto_id: 2, subtipo_produto_id: null })
      const militar = await createProduto({ inom, tipo_produto_id: 2, subtipo_produto_id: 24 })
      expect(civil.id).not.toBe(militar.id)
      const n = await conn.one('SELECT count(*)::int AS c FROM acervo.produto WHERE inom = $1 AND tipo_produto_id = 2', [inom])
      expect(n.c).toBe(2)
    })
  })

  describe('Renumerar versoes (abrir espaco pra edicao mais antiga)', () => {
    it('should shift existing editions and free up "1ª Edição" when the new one is older than all', async () => {
      const produto = await createProduto()
      await createVersao(produto.id, { versao: '1ª Edição', subtipo_produto_id: 2, data_criacao: '2001-01-01', data_edicao: '2001-01-01' })
      await createVersao(produto.id, { versao: '2ª Edição', subtipo_produto_id: 2, data_criacao: '2001-06-01', data_edicao: '2001-06-01' })

      const resultado = await produtoCtrl.renumeraVersoes(
        produto.id, 2, 'EDICAO', '1957-01-01', ADMIN_UUID
      )

      expect(resultado.rotulo_livre).toBe('1ª Edição')
      expect(resultado.versoes_deslocadas).toHaveLength(2)

      const versoes = await conn.any(
        'SELECT versao, data_edicao FROM acervo.versao WHERE produto_id = $1 ORDER BY data_edicao', [produto.id]
      )
      expect(versoes.map(v => v.versao)).toEqual(['2ª Edição', '3ª Edição'])
    })

    it('should insert in the middle when the new edition falls between two existing ones', async () => {
      const produto = await createProduto()
      await createVersao(produto.id, { versao: '1ª Edição', subtipo_produto_id: 2, data_criacao: '1960-01-01', data_edicao: '1960-01-01' })
      await createVersao(produto.id, { versao: '2ª Edição', subtipo_produto_id: 2, data_criacao: '2001-01-01', data_edicao: '2001-01-01' })

      const resultado = await produtoCtrl.renumeraVersoes(
        produto.id, 2, 'EDICAO', '1980-01-01', ADMIN_UUID
      )

      expect(resultado.rotulo_livre).toBe('2ª Edição')
      expect(resultado.versoes_deslocadas).toHaveLength(1)

      const versoes = await conn.any(
        'SELECT versao FROM acervo.versao WHERE produto_id = $1 ORDER BY data_edicao', [produto.id]
      )
      expect(versoes.map(v => v.versao)).toEqual(['1ª Edição', '3ª Edição'])
    })

    it('should not shift anything when the new edition is the most recent', async () => {
      const produto = await createProduto()
      await createVersao(produto.id, { versao: '1ª Edição', subtipo_produto_id: 2, data_criacao: '1960-01-01', data_edicao: '1960-01-01' })

      const resultado = await produtoCtrl.renumeraVersoes(
        produto.id, 2, 'EDICAO', '2020-01-01', ADMIN_UUID
      )

      expect(resultado.rotulo_livre).toBe('2ª Edição')
      expect(resultado.versoes_deslocadas).toHaveLength(0)
    })

    it('should return "1ª Edição" free with no shifts when the family has no versions yet', async () => {
      const produto = await createProduto()

      const resultado = await produtoCtrl.renumeraVersoes(
        produto.id, 2, 'EDICAO', '1957-01-01', ADMIN_UUID
      )

      expect(resultado.rotulo_livre).toBe('1ª Edição')
      expect(resultado.versoes_deslocadas).toHaveLength(0)
    })

    it('should keep families "EDICAO" and a sigla (ex. DSG) independent within the same produto/subtipo', async () => {
      const produto = await createProduto()
      await createVersao(produto.id, { versao: '1ª Edição', subtipo_produto_id: 2, data_criacao: '1960-01-01', data_edicao: '1960-01-01' })
      await createVersao(produto.id, { versao: '1-DSG', subtipo_produto_id: 2, data_criacao: '2023-01-01', data_edicao: '2023-01-01' })

      const resultado = await produtoCtrl.renumeraVersoes(
        produto.id, 2, 'EDICAO', '1940-01-01', ADMIN_UUID
      )

      expect(resultado.rotulo_livre).toBe('1ª Edição')
      expect(resultado.versoes_deslocadas).toHaveLength(1)

      const dsg = await conn.one(
        `SELECT versao FROM acervo.versao WHERE produto_id = $1 AND versao = '1-DSG'`, [produto.id]
      )
      expect(dsg.versao).toBe('1-DSG')
    })

    it('should not touch versions of a different subtipo_produto_id', async () => {
      // Dois subtipos civis coexistem no mesmo produto (T34-700=2, ET-RDG=12); renumerar
      // um nao mexe no outro. (Militar=24 NAO pode coexistir: e produto proprio desde
      // 2026-07-06, ver acervo.validate_version.)
      const produto = await createProduto()
      await createVersao(produto.id, { versao: '1ª Edição', subtipo_produto_id: 2, data_criacao: '1960-01-01', data_edicao: '1960-01-01' })
      await createVersao(produto.id, { versao: '1ª Edição', subtipo_produto_id: 12, data_criacao: '1980-01-01', data_edicao: '1980-01-01' })

      await produtoCtrl.renumeraVersoes(produto.id, 2, 'EDICAO', '1940-01-01', ADMIN_UUID)

      const outroSubtipo = await conn.one(
        `SELECT versao FROM acervo.versao WHERE produto_id = $1 AND subtipo_produto_id = 12`, [produto.id]
      )
      expect(outroSubtipo.versao).toBe('1ª Edição')
    })

    it('should reject an unknown produto_id', async () => {
      await expect(produtoCtrl.renumeraVersoes(999999, 2, 'EDICAO', '1957-01-01', ADMIN_UUID))
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
