'use strict'

// Teste de rota (supertest) do RPNP. Mocka banco + autenticacao (admin).
// Foco: a regra de identificacao do schema (.or) e o filtro de listagem.

const { createMockDb } = require('../../helpers/orcamento/mockDb')

const mockDb = createMockDb()
jest.mock('../../../database', () => ({
  db: mockDb,
  databaseVersion: { nome: '1.0.0', load: jest.fn() }
}))
jest.mock('../../../login', () => require('../../helpers/orcamento/mockLogin'))

const request = require('supertest')
const { buildTestApp } = require('../../helpers/orcamento/testApp')
const { rpnpRoute } = require('../../../orcamento/licitacao')

const app = buildTestApp([{ path: '/rpnp', router: rpnpRoute }])

beforeEach(() => mockDb.reset())

describe('GET /rpnp', () => {
  test('devolve o envelope com os dados', async () => {
    mockDb.conn.any.mockResolvedValueOnce([{ id: 1 }, { id: 2 }])
    const res = await request(app).get('/rpnp')
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.dados).toHaveLength(2)
  })

  test('aceita filtro ?ano=', async () => {
    mockDb.conn.any.mockResolvedValueOnce([{ id: 1 }])
    const res = await request(app).get('/rpnp?ano=2026')
    expect(res.status).toBe(200)
    expect(mockDb.conn.any).toHaveBeenCalledWith(
      expect.any(String),
      { ano: 2026 }
    )
  })
})

describe('POST /rpnp', () => {
  test('400 quando faltam nota_empenho_id e empenho_label (.or)', async () => {
    const res = await request(app)
      .post('/rpnp')
      .send({ ano: 2026, finalidade: 'x' })
    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
  })

  test('cria com empenho_label apenas', async () => {
    mockDb.conn.one.mockResolvedValueOnce({ id: 22 })
    const res = await request(app)
      .post('/rpnp')
      .send({ ano: 2026, empenho_label: '2023NE000261' })
    expect([200, 201]).toContain(res.status)
    expect(res.body.success).toBe(true)
    expect(res.body.dados).toEqual({ id: 22 })
  })

  test('cria com nota_empenho_id apenas', async () => {
    mockDb.conn.one.mockResolvedValueOnce({ id: 23 })
    const res = await request(app)
      .post('/rpnp')
      .send({ ano: 2026, nota_empenho_id: 5 })
    expect([200, 201]).toContain(res.status)
    expect(res.body.success).toBe(true)
  })

  test('aceita valor_a_liquidar = 0 (RPNP totalmente liquidado)', async () => {
    mockDb.conn.one.mockResolvedValueOnce({ id: 24 })
    const res = await request(app)
      .post('/rpnp')
      .send({
        ano: 2026,
        nota_empenho_id: 5,
        valor_empenhado: 10000,
        valor_a_liquidar: 0
      })
    expect([200, 201]).toContain(res.status)
    expect(res.body.success).toBe(true)
    expect(mockDb.conn.one).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ valorALiquidar: 0 })
    )
  })
})
