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
    it('should return produto by id', async () => {
      const chain = await createFullProduct()

      const res = await request(app)
        .get(`/api/acervo/produto/${chain.produto.id}`)
        .set('Authorization', generateUserToken())

      expect(res.status).toBe(200)
      expect(res.body.dados.id).toBe(chain.produto.id)
    })

    it('should return 404 for missing produto', async () => {
      const res = await request(app)
        .get('/api/acervo/produto/99999')
        .set('Authorization', generateUserToken())

      expect(res.status).toBe(404)
    })

    it('should reject invalid produto_id param', async () => {
      const res = await request(app)
        .get('/api/acervo/produto/abc')
        .set('Authorization', generateUserToken())

      expect(res.status).toBe(400)
    })
  })

  describe('GET /api/acervo/versao/:versao_id', () => {
    it('should return versao by id', async () => {
      const chain = await createFullProduct()

      const res = await request(app)
        .get(`/api/acervo/versao/${chain.versao.id}`)
        .set('Authorization', generateUserToken())

      expect(res.status).toBe(200)
      expect(res.body.dados.id).toBe(chain.versao.id)
    })
  })

  describe('GET /api/acervo/produto/detalhado/:produto_id', () => {
    it('should return detailed produto with versions and files', async () => {
      const chain = await createFullProduct()

      const res = await request(app)
        .get(`/api/acervo/produto/detalhado/${chain.produto.id}`)
        .set('Authorization', generateUserToken())

      expect(res.status).toBe(200)
      expect(res.body.dados.id).toBe(chain.produto.id)
      expect(res.body.dados.versoes).toHaveLength(1)
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

    it('should cleanup expired downloads (admin)', async () => {
      const res = await request(app)
        .post('/api/acervo/cleanup-expired-downloads')
        .set('Authorization', generateAdminToken())

      expect(res.status).toBe(200)
    })
  })
})
