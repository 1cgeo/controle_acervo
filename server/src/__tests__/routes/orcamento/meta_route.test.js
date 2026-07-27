'use strict'

// Teste de rota (supertest) da Meta do PIT. Mocka banco + autenticacao (admin).
// Cobre: listar (envelope), criar (sem validar exercicio), validacao Joi (400),
// e a regressao do 409 ao deletar com pdr_item/nota_credito vinculados.

const { createMockDb } = require('../../helpers/orcamento/mockDb')

const mockDb = createMockDb()
jest.mock('../../../database', () => ({
  db: mockDb,
  databaseVersion: { nome: '1.0.0', load: jest.fn() }
}))
jest.mock('../../../login', () => require('../../helpers/orcamento/mockLogin'))

const request = require('supertest')
const { buildTestApp } = require('../../helpers/orcamento/testApp')
const { metaRoute } = require('../../../orcamento/meta')

const app = buildTestApp([{ path: '/metas', router: metaRoute }])

beforeEach(() => mockDb.reset())

describe('GET /metas', () => {
  test('devolve o envelope padrao com os dados', async () => {
    mockDb.conn.any.mockResolvedValueOnce([{ id: 1, ano: 2026 }])
    const res = await request(app).get('/metas')
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ version: expect.any(String), success: true })
    expect(res.body.dados).toHaveLength(1)
  })

  test('aceita filtro ?ano=', async () => {
    mockDb.conn.any.mockResolvedValueOnce([{ id: 1 }])
    const res = await request(app).get('/metas?ano=2026')
    expect(res.status).toBe(200)
    expect(mockDb.conn.any).toHaveBeenCalledWith(
      expect.stringContaining('WHERE ano = $<ano>'),
      { ano: 2026 }
    )
  })
})

describe('POST /metas', () => {
  test('rejeita body sem ano com 400 (validacao Joi)', async () => {
    const res = await request(app).post('/metas').send({ numero_meta: 1 })
    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
  })

  test('rejeita body sem numero_meta com 400 (validacao Joi)', async () => {
    const res = await request(app).post('/metas').send({ ano: 2026 })
    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
  })

  test('cria meta e responde com sucesso (sem validar exercicio)', async () => {
    mockDb.conn.one.mockResolvedValueOnce({ id: 9 })
    const res = await request(app)
      .post('/metas')
      .send({ ano: 2026, numero_meta: 1, item: '1.1', descricao: 'Meta 1' })
    expect([200, 201]).toContain(res.status)
    expect(res.body.success).toBe(true)
    expect(res.body.dados).toEqual({ id: 9 })
    // sem checagem previa de exercicio
    expect(mockDb.conn.oneOrNone).not.toHaveBeenCalled()
  })
})

describe('PUT /metas/:id', () => {
  test('atualiza meta existente', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce({ id: 5 }) // existe
    mockDb.conn.one.mockResolvedValueOnce({ id: 5 })
    const res = await request(app)
      .put('/metas/5')
      .send({ ano: 2026, numero_meta: 2, item: '2.1' })
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
  })

  test('404 quando a meta nao existe', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce(null)
    const res = await request(app)
      .put('/metas/99')
      .send({ ano: 2026, numero_meta: 1 })
    expect(res.status).toBe(404)
    expect(res.body.success).toBe(false)
  })
})

describe('DELETE /metas/:id', () => {
  test('409 quando ha pdr_item/nota_credito vinculados', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce({ id: 1 }) // existe
    mockDb.conn.one.mockResolvedValueOnce({ n: 1 }) // ha dependentes
    const res = await request(app).delete('/metas/1')
    expect(res.status).toBe(409)
    expect(res.body.success).toBe(false)
  })

  test('exclui quando nao ha dependentes', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce({ id: 1 })
    mockDb.conn.one.mockResolvedValueOnce({ n: 0 })
    mockDb.conn.none.mockResolvedValueOnce(undefined)
    const res = await request(app).delete('/metas/1')
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
  })

  test('404 quando a meta nao existe', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce(null)
    const res = await request(app).delete('/metas/99')
    expect(res.status).toBe(404)
    expect(res.body.success).toBe(false)
  })
})
