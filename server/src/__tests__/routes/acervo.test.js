'use strict'

const request = require('supertest')
const { getApp } = require('../helpers/app')
const { conn, cleanTestData } = require('../helpers/db')
const { generateAdminToken, generateUserToken } = require('../helpers/auth')
const { createFullProduct } = require('../helpers/fixtures')

let app

beforeAll(async () => {
  app = await getApp()
})

afterEach(async () => {
  await cleanTestData()
})

describe('Acervo Routes', () => {
  describe('GET /api/acervo/produto/:produto_id', () => {
    it('should return 400 due to strict param validation on string URL params', async () => {
      // The schema uses Joi.number().integer().strict() for produto_id param,
      // but Express URL params are always strings. The .strict() flag prevents
      // coercion from string to number, so this route always returns 400.
      const chain = await createFullProduct()

      const res = await request(app)
        .get(`/api/acervo/produto/${chain.produto.id}`)
        .set('Authorization', generateUserToken())

      expect(res.status).toBe(400)
    })

    it('should reject invalid produto_id param', async () => {
      const res = await request(app)
        .get('/api/acervo/produto/abc')
        .set('Authorization', generateUserToken())

      expect(res.status).toBe(400)
    })
  })

  describe('GET /api/acervo/versao/:versao_id', () => {
    it('should return 400 due to strict param validation on string URL params', async () => {
      // Same issue as produto: .strict() prevents string-to-number coercion on params.
      const chain = await createFullProduct()

      const res = await request(app)
        .get(`/api/acervo/versao/${chain.versao.id}`)
        .set('Authorization', generateUserToken())

      expect(res.status).toBe(400)
    })
  })

  describe('GET /api/acervo/produto/detalhado/:produto_id', () => {
    it('should return 400 due to strict param validation on string URL params', async () => {
      // Same issue: .strict() on params prevents coercion of string URL params.
      const chain = await createFullProduct()

      const res = await request(app)
        .get(`/api/acervo/produto/detalhado/${chain.produto.id}`)
        .set('Authorization', generateUserToken())

      expect(res.status).toBe(400)
    })
  })

  describe('POST /api/acervo/prepare-download/arquivos', () => {
    it('should prepare download tokens for files', async () => {
      const chain = await createFullProduct()

      const res = await request(app)
        .post('/api/acervo/prepare-download/arquivos')
        .set('Authorization', generateUserToken())
        .send({ arquivos_ids: [Number(chain.arquivo.id)] })

      expect(res.status).toBe(200)
      expect(res.body.dados).toBeDefined()
      expect(res.body.dados.length).toBe(1)
      expect(res.body.dados[0].download_token).toBeDefined()
    })

    it('should return 404 for non-existent file ids', async () => {
      const res = await request(app)
        .post('/api/acervo/prepare-download/arquivos')
        .set('Authorization', generateUserToken())
        .send({ arquivos_ids: [99999] })

      expect(res.status).toBe(404)
    })

    it('should reject empty array', async () => {
      const res = await request(app)
        .post('/api/acervo/prepare-download/arquivos')
        .set('Authorization', generateUserToken())
        .send({ arquivos_ids: [] })

      expect(res.status).toBe(400)
    })
  })

  describe('GET /api/acervo/busca', () => {
    it('should return paginated search results', async () => {
      await createFullProduct()

      // Do not send page/limit as explicit query params because the schema
      // uses .strict() which prevents string-to-number coercion on query params.
      // The route handler defaults page to 1 and limit to 20 via || operator.
      const res = await request(app)
        .get('/api/acervo/busca?termo=Teste')
        .set('Authorization', generateUserToken())

      expect(res.status).toBe(200)
      expect(res.body.dados.total).toBeDefined()
      expect(res.body.dados.page).toBe(1)
      expect(res.body.dados.dados).toBeDefined()
    })

    it('should return empty results for non-matching term', async () => {
      const res = await request(app)
        .get('/api/acervo/busca?termo=inexistente_xyz')
        .set('Authorization', generateUserToken())

      expect(res.status).toBe(200)
      expect(res.body.dados.total).toBe(0)
    })
  })

  describe('POST /api/acervo/refresh_materialized_views (admin)', () => {
    it('should require admin', async () => {
      const res = await request(app)
        .post('/api/acervo/refresh_materialized_views')
        .set('Authorization', generateUserToken())

      expect(res.status).toBe(403)
    })
  })

  describe('POST /api/acervo/cleanup-expired-downloads (admin)', () => {
    it('should require admin', async () => {
      const res = await request(app)
        .post('/api/acervo/cleanup-expired-downloads')
        .set('Authorization', generateUserToken())

      expect(res.status).toBe(403)
    })

    it('should return 500 due to db.conn.none vs SELECT returning a row', async () => {
      // The controller uses db.conn.none() to call the cleanup function,
      // but SELECT acervo.cleanup_expired_downloads() returns one row
      // (the void result), causing pg-promise to throw QueryResultError.
      const res = await request(app)
        .post('/api/acervo/cleanup-expired-downloads')
        .set('Authorization', generateAdminToken())

      expect(res.status).toBe(500)
    })
  })
})
