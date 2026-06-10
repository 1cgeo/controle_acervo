'use strict'

const request = require('supertest')
const { getApp } = require('../helpers/app')
const { conn, cleanTestData } = require('../helpers/db')
const { generateAdminToken, generateUserToken, ADMIN_UUID } = require('../helpers/auth')
const { createFullProduct } = require('../helpers/fixtures')

let app

beforeAll(async () => {
  app = await getApp()
})

afterEach(async () => {
  await cleanTestData()
})

describe('Produto Routes', () => {
  describe('POST /api/produtos/produtos (bulk create)', () => {
    it('should create products in bulk (admin)', async () => {
      const res = await request(app)
        .post('/api/produtos/produtos')
        .set('Authorization', generateAdminToken())
        .send({
          produtos: [{
            nome: 'Carta Rota',
            mi: 'MI-001',
            inom: 'SF-22-Y-D',
            tipo_escala_id: 2,
            denominador_escala_especial: null,
            tipo_produto_id: 1,
            descricao: null,
            geom: 'SRID=4674;POLYGON((-50 -25, -49 -25, -49 -24, -50 -24, -50 -25))'
          }]
        })

      expect(res.status).toBe(201)

      const criado = await conn.oneOrNone(
        `SELECT id FROM acervo.produto WHERE nome = 'Carta Rota'`
      )
      expect(criado).not.toBeNull()
    })

    it('should reject with invalid body', async () => {
      const res = await request(app)
        .post('/api/produtos/produtos')
        .set('Authorization', generateAdminToken())
        .send({ produtos: [] })

      expect(res.status).toBe(400)
    })

    it('should reject without auth', async () => {
      const res = await request(app)
        .post('/api/produtos/produtos')
        .send({ produtos: [{ nome: 'Test' }] })

      expect(res.status).toBe(401)
    })
  })

  describe('PUT /api/produtos/produto (update)', () => {
    it('should require admin', async () => {
      const res = await request(app)
        .put('/api/produtos/produto')
        .set('Authorization', generateUserToken())
        .send({
          id: 1,
          nome: 'Updated',
          tipo_escala_id: 2,
          denominador_escala_especial: null,
          tipo_produto_id: 1,
          descricao: ''
        })

      expect(res.status).toBe(403)
    })

    it('should update produto (admin)', async () => {
      const chain = await createFullProduct()

      const res = await request(app)
        .put('/api/produtos/produto')
        .set('Authorization', generateAdminToken())
        .send({
          id: Number(chain.produto.id),
          nome: 'Atualizado Via Rota',
          mi: 'MI-2345',
          inom: 'INOM-TEST',
          tipo_escala_id: 1,
          denominador_escala_especial: null,
          tipo_produto_id: 1,
          descricao: 'desc atualizada',
          geom: 'SRID=4674;POLYGON((-50 -15, -49 -15, -49 -14, -50 -14, -50 -15))'
        })

      expect(res.status).toBe(200)

      const atualizado = await conn.one(
        `SELECT nome FROM acervo.produto WHERE id = $1`, [chain.produto.id]
      )
      expect(atualizado.nome).toBe('Atualizado Via Rota')
    })
  })

  describe('DELETE /api/produtos/produto', () => {
    it('should delete produto moving files to arquivo_deletado', async () => {
      const chain = await createFullProduct()

      const res = await request(app)
        .delete('/api/produtos/produto')
        .set('Authorization', generateAdminToken())
        .send({
          produto_ids: [Number(chain.produto.id)],
          motivo_exclusao: 'Teste de exclusão'
        })

      expect(res.status).toBe(200)

      const restante = await conn.oneOrNone(
        `SELECT id FROM acervo.produto WHERE id = $1`, [chain.produto.id]
      )
      expect(restante).toBeNull()

      const deletado = await conn.one(
        `SELECT COUNT(*)::int AS n FROM acervo.arquivo_deletado WHERE versao_id IS NULL OR versao_id = $1`,
        [chain.versao.id]
      )
      expect(deletado.n).toBe(1)
    })

    it('should return 404 for non-existent product', async () => {
      const res = await request(app)
        .delete('/api/produtos/produto')
        .set('Authorization', generateAdminToken())
        .send({
          produto_ids: [99999],
          motivo_exclusao: 'Não existe'
        })

      expect(res.status).toBe(404)
    })
  })

  describe('GET /api/produtos/versao_relacionamento', () => {
    it('should return relationships list with login token', async () => {
      const res = await request(app)
        .get('/api/produtos/versao_relacionamento')
        .set('Authorization', generateUserToken())

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(Array.isArray(res.body.dados)).toBe(true)
    })
  })
})
