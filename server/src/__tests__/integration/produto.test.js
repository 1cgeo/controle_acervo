'use strict'

const { conn, cleanTestData } = require('../helpers/db')
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
    // O UPDATE e o DELETE crus saíram: `UPDATE` seguido de `SELECT` prova o
    // PostgreSQL, e não o sistema. Quem os exercita pelo controlador é
    // routes/produto.test.js.
    it('grava a geometria do produto em 4674, como o resto do acervo espera', async () => {
      const produto = await createProduto()

      // O nome do caso promete GEOMETRIA, e é ela que se lê: a coluna sai do
      // banco como EWKT, com o SRID na frente, e é assim que o PUT a reenvia.
      const { geom, srid } = await conn.one(
        `SELECT ST_AsEWKT(geom) AS geom, ST_SRID(geom) AS srid
           FROM acervo.produto WHERE id = $1`,
        [produto.id]
      )
      expect(srid).toBe(4674)
      expect(geom).toMatch(/^SRID=4674;POLYGON/)
    })
  })

  describe('Version management', () => {
    it('should create a version for a product', async () => {
      const produto = await createProduto()
      const versao = await createVersao(produto.id)

      // A LINHA LIDA DE VOLTA, e não o eco do `RETURNING`: o vínculo com o
      // produto é o que faz a versão existir, e é ele que se confere.
      const gravada = await conn.one(
        'SELECT produto_id, versao FROM acervo.versao WHERE id = $1',
        [versao.id]
      )
      expect(Number(gravada.produto_id)).toBe(Number(produto.id))
      expect(gravada.versao).toBe('1-DSG')
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
      await createVersao(produto.id, { versao: '2-DSG' })

      const rotulos = await conn.any(
        'SELECT versao FROM acervo.versao WHERE produto_id = $1 ORDER BY versao',
        [produto.id]
      )
      expect(rotulos.map(r => r.versao)).toEqual(['1-DSG', '2-DSG'])
    })

    it('should enforce unique version per product', async () => {
      const produto = await createProduto()
      await createVersao(produto.id, { versao: '1-DSG' })
      await expect(createVersao(produto.id, { versao: '1-DSG' }))
        .rejects.toThrow()
    })

    // O rotulo da versao e unico por (produto, versao, SUBTIPO), e nao por
    // (produto, versao). O produto que tem a Carta Ortoimagem SCN (3) e a
    // Especial (27), ambas "1ª Edição", e legitimo: e o caso dos mosaicos
    // RADAMBRASIL. A checagem amigavel do `atualizaVersao` tem de olhar o
    // subtipo, senao devolve 409 ao editar QUALQUER uma das duas.
    it('edita a versao de um produto que tem o MESMO rotulo em outro subtipo', async () => {
      const produto = await createProduto({ tipo_produto_id: 3 })
      const scn = await createVersao(produto.id, { versao: '1ª Edição', subtipo_produto_id: 3 })
      const especial = await createVersao(produto.id, { versao: '1ª Edição', subtipo_produto_id: 27 })
      expect(especial.id).not.toBe(scn.id)

      const atual = await conn.one('SELECT * FROM acervo.versao WHERE id = $1', [especial.id])
      await produtoCtrl.atualizaVersao({
        id: Number(especial.id),
        versao: atual.versao,
        nome: atual.nome,
        tipo_versao_id: atual.tipo_versao_id,
        subtipo_produto_id: atual.subtipo_produto_id,
        descricao: atual.descricao || '',
        metadado: atual.metadado || {},
        lote_id: atual.lote_id === null ? null : Number(atual.lote_id),
        orgao_produtor: atual.orgao_produtor,
        palavras_chave: ['radambrasil'],
        data_criacao: atual.data_criacao,
        data_edicao: atual.data_edicao
      }, ADMIN_UUID)

      const depois = await conn.one('SELECT palavras_chave FROM acervo.versao WHERE id = $1', [especial.id])
      expect(depois.palavras_chave).toEqual(['radambrasil'])
    })

    it('segue recusando o MESMO rotulo no MESMO subtipo', async () => {
      const produto = await createProduto({ tipo_produto_id: 3 })
      await createVersao(produto.id, { versao: '1ª Edição', subtipo_produto_id: 3 })
      const outra = await createVersao(produto.id, { versao: '1ª Edição', subtipo_produto_id: 27 })

      const atual = await conn.one('SELECT * FROM acervo.versao WHERE id = $1', [outra.id])
      await expect(produtoCtrl.atualizaVersao({
        id: Number(outra.id),
        versao: atual.versao,
        nome: atual.nome,
        tipo_versao_id: atual.tipo_versao_id,
        // muda o subtipo para o da irma: agora COLIDE de verdade
        subtipo_produto_id: 3,
        descricao: atual.descricao || '',
        metadado: atual.metadado || {},
        lote_id: atual.lote_id === null ? null : Number(atual.lote_id),
        orgao_produtor: atual.orgao_produtor,
        palavras_chave: atual.palavras_chave || [],
        data_criacao: atual.data_criacao,
        data_edicao: atual.data_edicao
      }, ADMIN_UUID)).rejects.toThrow(/Já existe a versão/)
    })
  })

  describe('Identidade do produto pelo subtipo (militar = produto proprio)', () => {
    // A Carta Topografica Militar (subtipo 24) e um produto DISTINTO do civil
    // no mesmo MI: a chave de identidade e o SUBTIPO, e nao o tipo.
    it('rejeita versao militar (subtipo 24) num produto civil (subtipo NULL)', async () => {
      const civil = await createProduto({ tipo_produto_id: 2 })
      await expect(createVersao(civil.id, { versao: '1ª Edição', subtipo_produto_id: 24, tipo_versao_id: 2 }))
        .rejects.toThrow()
    })

    it('aceita versao militar num produto militar (subtipo 24)', async () => {
      const militar = await createProduto({ tipo_produto_id: 2, subtipo_produto_id: 24 })
      const v = await createVersao(militar.id, { versao: '1ª Edição', subtipo_produto_id: 24, tipo_versao_id: 2 })

      const gravada = await conn.one(
        'SELECT subtipo_produto_id FROM acervo.versao WHERE id = $1', [v.id]
      )
      expect(gravada.subtipo_produto_id).toBe(24)
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
      // O MI entra explícito, e a contagem é POR ELE: quem decide a identidade
      // é `unique_produto_identidade (mi, tipo_escala_id, tipo_produto_id,
      // COALESCE(subtipo_produto_id, 0))`, e o INOM não participa dela. Contar
      // por INOM media outra coisa que não a regra sob teste.
      const mi = 'MI-COEXISTE'
      const civil = await createProduto({ mi, inom, tipo_produto_id: 2, subtipo_produto_id: null })
      const militar = await createProduto({ mi, inom, tipo_produto_id: 2, subtipo_produto_id: 24 })
      expect(civil.id).not.toBe(militar.id)

      const n = await conn.one(
        `SELECT count(*)::int AS c FROM acervo.produto
          WHERE mi = $1 AND tipo_produto_id = 2`,
        [mi]
      )
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
      // Dois subtipos civis coexistem no mesmo produto (T34-700=2, ET-RDG=12);
      // renumerar um nao mexe no outro. (Militar=24 NAO pode coexistir: e
      // produto proprio, ver acervo.validate_version.)
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
      // A MENSAGEM entra: `toThrow()` nu aceita um TypeError de argumento
      // trocado, que é falha do teste e não recusa do controlador.
      await expect(produtoCtrl.renumeraVersoes(999999, 2, 'EDICAO', '1957-01-01', ADMIN_UUID))
        .rejects.toThrow(/[Pp]roduto/)
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

  // A LÁPIDE DO ARQUIVO EXCLUÍDO não é provada aqui. O caso que existia
  // reescrevia à mão o INSERT do `arquivo_ctrl.deleteArquivos`, e com
  // `tipo_status_id = 4` onde o caminho real grava 3: ele documentava um valor
  // errado. Quem prova a exclusão de verdade, coluna a coluna e pelo
  // controlador, é integration/exclusao_acervo.test.js.
})
