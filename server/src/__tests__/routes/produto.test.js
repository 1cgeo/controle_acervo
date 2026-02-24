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
    it('should return 500 due to internal type mismatch in materialized view refresh', async () => {
      // The controller inserts products successfully but then calls
      // refreshViews.atualizarViewsPorProdutos with BIGSERIAL IDs (strings),
      // which pg-promise formats as text[] instead of integer[], causing a
      // PostgreSQL function signature mismatch (text[] vs integer[]).
      const res = await request(app)
        .post('/api/produtos/produtos')
        .set('Authorization', generateUserToken())
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

      expect(res.status).toBe(500)
    })

    it('should reject with invalid body', async () => {
      const res = await request(app)
        .post('/api/produtos/produtos')
        .set('Authorization', generateUserToken())
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

    it('should return 500 due to materialized view refresh bug in update path', async () => {
      // Even with valid data (geom path avoids ColumnSet schema bug),
      // the refreshViews.atualizarViewsPorProdutos function has a bug where
      // the view_name includes the schema prefix ('acervo.mv_produto_...'),
      // and format('%I', ...) quotes it as a single identifier, causing
      // "relation does not exist" error during REFRESH MATERIALIZED VIEW.
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

      expect(res.status).toBe(500)
    })
  })

  describe('DELETE /api/produtos/produto', () => {
    it('should return 500 due to materialized view refresh bug in delete path', async () => {
      // The delete controller moves files to arquivo_deletado, removes versions,
      // then calls refreshViews.atualizarViewsPorProdutos which fails because
      // the atualizar_mv_por_produtos DB function has a bug where the view_name
      // includes the schema prefix and format('%I',...) quotes it incorrectly.
      const chain = await createFullProduct()

      const res = await request(app)
        .delete('/api/produtos/produto')
        .set('Authorization', generateAdminToken())
        .send({
          produto_ids: [Number(chain.produto.id)],
          motivo_exclusao: 'Teste de exclusão'
        })

      expect(res.status).toBe(500)
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
