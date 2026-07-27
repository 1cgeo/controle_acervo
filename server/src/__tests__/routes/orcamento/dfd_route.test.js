'use strict'

// Teste de rota (supertest) do DFD. Mocka banco + autenticacao (admin).
// A licitacao nao referencia mais o DFD, entao excluir DFD nao bloqueia por
// licitacao (remove primeiro os itens e depois o proprio DFD).

const { createMockDb } = require('../../helpers/orcamento/mockDb')

const mockDb = createMockDb()
jest.mock('../../../database', () => ({
  db: mockDb,
  databaseVersion: { nome: '1.0.0', load: jest.fn() }
}))
jest.mock('../../../login', () => require('../../helpers/orcamento/mockLogin'))

const request = require('supertest')
const { buildTestApp } = require('../../helpers/orcamento/testApp')
const { dfdRoute } = require('../../../orcamento/dfd')

const app = buildTestApp([{ path: '/dfd', router: dfdRoute }])

beforeEach(() => mockDb.reset())

describe('GET /dfd/:id', () => {
  test('traz o DFD com o array de itens', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce({ id: 42, numero: 'DFD-001' })
    mockDb.conn.any.mockResolvedValueOnce([{ id: 1, descricao: 'Item A' }])
    const res = await request(app).get('/dfd/42')
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.dados.itens).toHaveLength(1)
  })

  test('404 quando o DFD nao existe', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce(null)
    const res = await request(app).get('/dfd/99')
    expect(res.status).toBe(404)
  })
})

describe('POST /dfd', () => {
  test('rejeita body sem numero/ano com 400 (validacao Joi)', async () => {
    const res = await request(app).post('/dfd').send({ objeto: 'x' })
    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
  })

  test('cria DFD com itens e responde com sucesso', async () => {
    mockDb.conn.one.mockResolvedValueOnce({ id: 42 }) // INSERT dfd
    mockDb.conn.none.mockResolvedValueOnce(undefined) // insert dos itens
    const res = await request(app)
      .post('/dfd')
      .send({
        numero: 'DFD-001',
        ano: 2026,
        objeto: 'Aquisicao',
        itens: [{ tipo_item_id: 1, descricao: 'Item A', valor_total: 100 }]
      })
    expect([200, 201]).toContain(res.status)
    expect(res.body.success).toBe(true)
    expect(res.body.dados).toEqual({ id: 42 })
  })
})

describe('DELETE /dfd/:id', () => {
  test('exclui o DFD e seus itens', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce({ id: 10 }) // DFD existe
    mockDb.conn.none
      .mockResolvedValueOnce(undefined) // DELETE itens
      .mockResolvedValueOnce(undefined) // DELETE dfd
    const res = await request(app).delete('/dfd/10')
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
  })

  test('404 quando o DFD nao existe', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce(null)
    const res = await request(app).delete('/dfd/99')
    expect(res.status).toBe(404)
  })
})
