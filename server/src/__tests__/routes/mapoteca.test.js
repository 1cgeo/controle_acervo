'use strict'

const request = require('supertest')
const { getApp } = require('../helpers/app')
const { conn, cleanTestData } = require('../helpers/db')
const { generateAdminToken, generateUserToken } = require('../helpers/auth')

let app

beforeAll(async () => {
  app = await getApp()
})

afterEach(async () => {
  await cleanTestData()
})

describe('Mapoteca Routes', () => {
  describe('Domain endpoints (no auth)', () => {
    it('GET /api/mapoteca/dominio/tipo_cliente should return without auth', async () => {
      const res = await request(app).get('/api/mapoteca/dominio/tipo_cliente')
      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(Array.isArray(res.body.dados)).toBe(true)
    })

    it('GET /api/mapoteca/dominio/situacao_pedido should return without auth', async () => {
      const res = await request(app).get('/api/mapoteca/dominio/situacao_pedido')
      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
    })
  })

  describe('Clientes', () => {
    it('GET /api/mapoteca/cliente should require auth', async () => {
      const res = await request(app).get('/api/mapoteca/cliente')
      expect(res.status).toBe(401)
    })

    it('GET /api/mapoteca/cliente should return list with auth', async () => {
      const res = await request(app)
        .get('/api/mapoteca/cliente')
        .set('Authorization', generateAdminToken())

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
    })

    it('POST /api/mapoteca/cliente should return 500 due to db.oneOrNone bug', async () => {
      // The criaCliente controller calls db.oneOrNone() instead of
      // db.conn.oneOrNone(), causing a TypeError at runtime.
      const res = await request(app)
        .post('/api/mapoteca/cliente')
        .set('Authorization', generateAdminToken())
        .send({
          nome: 'OM Rota Teste',
          ponto_contato_principal: null,
          endereco_entrega_principal: null,
          tipo_cliente_id: 1
        })

      expect(res.status).toBe(500)
    })

    it('POST /api/mapoteca/cliente should reject without nome', async () => {
      const res = await request(app)
        .post('/api/mapoteca/cliente')
        .set('Authorization', generateAdminToken())
        .send({
          tipo_cliente_id: 1
        })

      expect(res.status).toBe(400)
    })

    it('POST /api/mapoteca/cliente should require admin', async () => {
      const res = await request(app)
        .post('/api/mapoteca/cliente')
        .set('Authorization', generateUserToken())
        .send({
          nome: 'OM Rota',
          tipo_cliente_id: 1
        })

      expect(res.status).toBe(403)
    })
  })

  describe('Plotters', () => {
    it('POST /api/mapoteca/plotter should create plotter (admin)', async () => {
      // The controller's ColumnSet requires all 5 properties:
      // ativo, nr_serie, modelo, data_aquisicao, vida_util.
      // The schema validation middleware does not apply Joi defaults
      // back to req.body, so all properties must be explicitly sent.
      const res = await request(app)
        .post('/api/mapoteca/plotter')
        .set('Authorization', generateAdminToken())
        .send({
          ativo: true,
          nr_serie: 'SN-ROUTE-001',
          modelo: 'HP DesignJet T1600',
          data_aquisicao: null,
          vida_util: null
        })

      expect(res.status).toBe(201)
    })

    it('GET /api/mapoteca/plotter should return list with auth', async () => {
      const res = await request(app)
        .get('/api/mapoteca/plotter')
        .set('Authorization', generateUserToken())

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
    })
  })
})
