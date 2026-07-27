'use strict'

// Teste de rota (supertest) dos dominios. Os GET exigem perfil de consulta
// desde 2026-07-25 (antes eram publicos, sem guarda), entao aqui se mocka o
// ../../login junto com o banco.

const { createMockDb } = require('../../helpers/orcamento/mockDb')

const mockDb = createMockDb()
jest.mock('../../../database', () => ({
  db: mockDb,
  databaseVersion: { nome: '1.0.0', load: jest.fn() }
}))
jest.mock('../../../login', () => require('../../helpers/orcamento/mockLogin'))

const request = require('supertest')
const { buildTestApp } = require('../../helpers/orcamento/testApp')
const { dominioRoute } = require('../../../orcamento/dominio')

const app = buildTestApp([{ path: '/dominio', router: dominioRoute }])

beforeEach(() => mockDb.reset())

describe('GET /dominio', () => {
  test('natureza_despesa retorna 200 com dados', async () => {
    mockDb.conn.any.mockResolvedValueOnce([
      { code: 1, nome: 'Material de consumo', gnd: 3, grupo: 'Custeio' }
    ])
    const res = await request(app).get('/dominio/natureza_despesa')
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.dados).toHaveLength(1)
  })

  test('tipo_licitacao retorna 200 com dados', async () => {
    mockDb.conn.any.mockResolvedValueOnce([
      { code: 1, nome: 'GCALC DSG' },
      { code: 2, nome: 'Propria' }
    ])
    const res = await request(app).get('/dominio/tipo_licitacao')
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.dados).toHaveLength(2)
  })

  test('tipo_item_dfd retorna 200 com dados', async () => {
    mockDb.conn.any.mockResolvedValueOnce([{ code: 1, nome: 'Material' }])
    const res = await request(app).get('/dominio/tipo_item_dfd')
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.dados).toHaveLength(1)
  })
})
