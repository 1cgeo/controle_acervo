'use strict'

// Teste de rota (supertest) da licitacao. Mocka banco + autenticacao (admin).

const { createMockDb } = require('../../helpers/orcamento/mockDb')

const mockDb = createMockDb()
jest.mock('../../../database', () => ({
  db: mockDb,
  databaseVersion: { nome: '1.0.0', load: jest.fn() }
}))
jest.mock('../../../login', () => require('../../helpers/orcamento/mockLogin'))

const request = require('supertest')
const { buildTestApp } = require('../../helpers/orcamento/testApp')
const { licitacaoRoute } = require('../../../orcamento/licitacao')

const app = buildTestApp([{ path: '/licitacao', router: licitacaoRoute }])

beforeEach(() => mockDb.reset())

describe('GET /licitacao', () => {
  test('devolve o envelope com os dados', async () => {
    mockDb.conn.any.mockResolvedValueOnce([{ id: 1, tipo_id: 1 }])
    const res = await request(app).get('/licitacao')
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.dados).toHaveLength(1)
  })

  test('aceita filtros ?ano= e ?tipo_id=', async () => {
    mockDb.conn.any.mockResolvedValueOnce([{ id: 2, tipo_id: 2 }])
    const res = await request(app).get('/licitacao?ano=2026&tipo_id=2')
    expect(res.status).toBe(200)
    expect(mockDb.conn.any).toHaveBeenCalledWith(
      expect.any(String),
      { ano: 2026, tipoId: 2 }
    )
  })

  test('rejeita tipo_id fora de {1,2} com 400', async () => {
    const res = await request(app).get('/licitacao?tipo_id=9')
    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
  })
})

describe('POST /licitacao', () => {
  test('cria (tipo_id 1) com sucesso', async () => {
    mockDb.conn.one.mockResolvedValueOnce({ id: 11 })
    const res = await request(app)
      .post('/licitacao')
      .send({ ano: 2026, tipo_id: 1, objeto: 'GCALC DSG' })
    expect([200, 201]).toContain(res.status)
    expect(res.body.success).toBe(true)
    expect(res.body.dados).toEqual({ id: 11 })
  })

  test('cria (tipo_id 3 = Participante) com sucesso', async () => {
    mockDb.conn.one.mockResolvedValueOnce({ id: 13 })
    const res = await request(app)
      .post('/licitacao')
      .send({ ano: 2026, tipo_id: 3, objeto: 'Pregao participante (outra OM)' })
    expect([200, 201]).toContain(res.status)
    expect(res.body.dados).toEqual({ id: 13 })
  })

  test('rejeita tipo_id 9 com 400 (fora de {1,2,3})', async () => {
    const res = await request(app)
      .post('/licitacao')
      .send({ ano: 2026, tipo_id: 9, objeto: 'x' })
    expect(res.status).toBe(400)
  })

  test('rejeita sem objeto com 400 (validacao Joi)', async () => {
    const res = await request(app)
      .post('/licitacao')
      .send({ ano: 2026, tipo_id: 1 })
    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
  })
})

describe('DELETE /licitacao/:id', () => {
  test('exclui a licitacao (nada referencia a licitacao)', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce({ id: 1 }) // existe
    mockDb.conn.none.mockResolvedValueOnce(undefined)
    const res = await request(app).delete('/licitacao/1')
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
  })

  test('404 quando a licitacao nao existe', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce(null)
    const res = await request(app).delete('/licitacao/999')
    expect(res.status).toBe(404)
    expect(res.body.success).toBe(false)
  })
})
