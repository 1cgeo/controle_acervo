'use strict'

// Teste de rota (supertest) da nota de credito. Mocka banco e autenticacao.
// Cobre: GET com filtros, caminho feliz do POST, validacao Joi (valor_nc),
// a regra de strip do pdr_item_id por classificacao e o 409 do DELETE.

const { createMockDb } = require('../../helpers/orcamento/mockDb')

const mockDb = createMockDb()
jest.mock('../../../database', () => ({
  db: mockDb,
  databaseVersion: { nome: '1.0.0', load: jest.fn() }
}))
jest.mock('../../../login', () => require('../../helpers/orcamento/mockLogin'))

const request = require('supertest')
const { buildTestApp } = require('../../helpers/orcamento/testApp')
const { notaCreditoRoute } = require('../../../orcamento/nota_credito')

const app = buildTestApp([{ path: '/notas_credito', router: notaCreditoRoute }])

beforeEach(() => mockDb.reset())

const bodyValido = {
  numero: 'NC-001',
  ano: 2026,
  cod_nd: '339030',
  valor_nc: 1000,
  classificacao_id: 1,
  pdr_item_id: 7
}

describe('GET /notas_credito', () => {
  test('devolve o envelope padrao com os dados', async () => {
    mockDb.conn.any.mockResolvedValueOnce([{ id: 1 }, { id: 2 }])
    const res = await request(app).get('/notas_credito')
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ version: expect.any(String), success: true })
    expect(res.body.dados).toHaveLength(2)
  })

  test('aceita filtros ?ano= e ?classificacao_id= e os repassa ao ctrl', async () => {
    mockDb.conn.any.mockResolvedValueOnce([])
    const res = await request(app)
      .get('/notas_credito')
      .query({ ano: 2026, classificacao_id: 2 })
    expect(res.status).toBe(200)
    const [, params] = mockDb.conn.any.mock.calls[0]
    expect(params).toEqual({ ano: 2026, classificacaoId: 2 })
  })

  test('classificacao_id invalido (3) vira 400', async () => {
    const res = await request(app)
      .get('/notas_credito')
      .query({ classificacao_id: 3 })
    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
  })
})

describe('POST /notas_credito', () => {
  test('cria NC e responde com sucesso', async () => {
    mockDb.conn.one.mockResolvedValueOnce({ id: 10 })
    const res = await request(app).post('/notas_credito').send(bodyValido)
    expect([200, 201]).toContain(res.status)
    expect(res.body.success).toBe(true)
    expect(res.body.dados).toEqual({ id: 10 })
  })

  test('valor_nc ausente vira 400 (validacao Joi)', async () => {
    const { valor_nc, ...semValor } = bodyValido
    const res = await request(app).post('/notas_credito').send(semValor)
    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
    expect(mockDb.conn.one).not.toHaveBeenCalled()
  })

  test('valor_nc = 0 vira 400 (deve ser positivo)', async () => {
    const res = await request(app)
      .post('/notas_credito')
      .send({ ...bodyValido, valor_nc: 0 })
    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
    expect(mockDb.conn.one).not.toHaveBeenCalled()
  })

  test('regra: classificacao Extra-PDR (2) com pdr_item_id => o item nao chega ao banco', async () => {
    mockDb.conn.one.mockResolvedValueOnce({ id: 11 })
    const res = await request(app)
      .post('/notas_credito')
      .send({ ...bodyValido, classificacao_id: 2, pdr_item_id: 99 })
    expect([200, 201]).toContain(res.status)
    // o schema faz strip do pdr_item_id; o ctrl grava null
    const params = mockDb.conn.one.mock.calls[0][1]
    expect(params.pdrItemId).toBeNull()
  })
})

describe('DELETE /notas_credito/:id', () => {
  test('409 quando ha nota de empenho vinculada', async () => {
    mockDb.conn.oneOrNone
      .mockResolvedValueOnce({ id: 1 }) // existe
      .mockResolvedValueOnce({ '?column?': 1 }) // NE vinculada
    const res = await request(app).delete('/notas_credito/1')
    expect(res.status).toBe(409)
    expect(res.body.success).toBe(false)
  })

  test('remove com 200 quando nao ha dependentes', async () => {
    mockDb.conn.oneOrNone
      .mockResolvedValueOnce({ id: 1 })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
    mockDb.conn.none.mockResolvedValueOnce(undefined)
    const res = await request(app).delete('/notas_credito/1')
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
  })
})
