'use strict'

// Teste de rota (supertest) da Configuracao (linha unica uasg/codom/ano_referencia).
// Mocka banco + autenticacao (admin).
//   * GET /configuracao        -> devolve a config (mock db.conn.one)
//   * PUT /configuracao        -> atualiza e devolve a config (mock db.conn.one)
//   * GET /configuracao/anos   -> devolve a lista de anos (mock db.conn.any)

const { createMockDb } = require('../../helpers/orcamento/mockDb')

const mockDb = createMockDb()
jest.mock('../../../database', () => ({
  db: mockDb,
  databaseVersion: { nome: '1.0.0', load: jest.fn() }
}))
jest.mock('../../../login', () => require('../../helpers/orcamento/mockLogin'))

const request = require('supertest')
const { buildTestApp } = require('../../helpers/orcamento/testApp')
const { configuracaoRoute } = require('../../../orcamento/configuracao')

const app = buildTestApp([{ path: '/configuracao', router: configuracaoRoute }])

beforeEach(() => mockDb.reset())

describe('GET /configuracao', () => {
  test('devolve a configuracao (linha unica)', async () => {
    mockDb.conn.one.mockResolvedValueOnce({
      id: 1,
      uasg: '160382',
      codom: '048215',
      ano_referencia: 2026
    })
    const res = await request(app).get('/configuracao')
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ version: expect.any(String), success: true })
    expect(res.body.dados).toMatchObject({ uasg: '160382', codom: '048215', ano_referencia: 2026 })
  })

  test('ano_referencia nulo cai no ano corrente como default', async () => {
    mockDb.conn.one.mockResolvedValueOnce({
      id: 1,
      uasg: '160382',
      codom: '048215',
      ano_referencia: null
    })
    const res = await request(app).get('/configuracao')
    expect(res.status).toBe(200)
    expect(res.body.dados.ano_referencia).toBe(new Date().getFullYear())
  })
})

describe('PUT /configuracao', () => {
  test('atualiza e devolve a configuracao', async () => {
    mockDb.conn.one.mockResolvedValueOnce({
      id: 1,
      uasg: '160500',
      codom: '048215',
      ano_referencia: 2027
    })
    const res = await request(app)
      .put('/configuracao')
      .send({ uasg: '160500', codom: '048215', ano_referencia: 2027 })
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.dados).toMatchObject({ uasg: '160500', ano_referencia: 2027 })
    expect(mockDb.conn.one).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE orcamento.configuracao'),
      expect.objectContaining({ uasg: '160500', anoReferencia: 2027 })
    )
  })

  test('ano_referencia string (strict) vira 400 (validacao Joi)', async () => {
    const res = await request(app)
      .put('/configuracao')
      .send({ uasg: '160500', ano_referencia: '2027' })
    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
  })
})

describe('GET /configuracao/anos', () => {
  test('devolve a lista de anos distintos', async () => {
    const atual = new Date().getFullYear()
    mockDb.conn.any.mockResolvedValueOnce([{ ano: atual }, { ano: 2025 }, { ano: 2024 }])
    const res = await request(app).get('/configuracao/anos')
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.dados).toEqual(expect.arrayContaining([atual, 2025, 2024]))
  })

  test('garante o ano corrente mesmo sem dado no banco', async () => {
    mockDb.conn.any.mockResolvedValueOnce([])
    const res = await request(app).get('/configuracao/anos')
    expect(res.status).toBe(200)
    expect(res.body.dados).toContain(new Date().getFullYear())
  })
})
