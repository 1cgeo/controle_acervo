'use strict'

// Teste de rota (supertest) do PDR. Mocka banco e autenticacao.
// O PDR e o conjunto dos seus itens: esta feature e um CRUD de ITENS.
// Cobre: GET /pdr (lista) e GET /pdr?ano=, GET /pdr/:id (OK / 404),
// POST /pdr (cria item, 201), PUT /pdr/:id (200 / 404 via rowCount),
// DELETE /pdr/:id (200 / 404 / 409 por NC vinculada) e a validacao Joi
// (body sem cod_nd ou sem ano -> 400).

const { createMockDb } = require('../../helpers/orcamento/mockDb')

const mockDb = createMockDb()
jest.mock('../../../database', () => ({
  db: mockDb,
  databaseVersion: { nome: '1.0.0', load: jest.fn() }
}))
jest.mock('../../../login', () => require('../../helpers/orcamento/mockLogin'))

const request = require('supertest')
const { buildTestApp } = require('../../helpers/orcamento/testApp')
const { pdrRoute } = require('../../../orcamento/pdr')

const app = buildTestApp([{ path: '/pdr', router: pdrRoute }])

// Body valido de um item do PDR (obrigatorios: ano e cod_nd).
const itemValido = {
  ano: 2026,
  cod_nd: '339015',
  meta_pit_id: null,
  item_label: '1D',
  gnd: 3,
  valor_solicitado: 50000,
  valor_autorizado: 50000
}

beforeEach(() => mockDb.reset())

describe('GET /pdr', () => {
  test('devolve o envelope padrao com os dados', async () => {
    mockDb.conn.any.mockResolvedValueOnce([{ id: 1, ano: 2026, cod_nd: '339015' }])
    const res = await request(app).get('/pdr')
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.dados).toHaveLength(1)
  })

  test('filtra por ano (GET /pdr?ano=)', async () => {
    mockDb.conn.any.mockResolvedValueOnce([{ id: 1, ano: 2026, cod_nd: '339015' }])
    const res = await request(app).get('/pdr').query({ ano: 2026 })
    expect(res.status).toBe(200)
    expect(mockDb.conn.any).toHaveBeenCalledWith(expect.any(String), { ano: 2026 })
  })
})

describe('GET /pdr/:id', () => {
  test('devolve o item quando existe', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce({ id: 10, ano: 2026, cod_nd: '339015' })
    const res = await request(app).get('/pdr/10')
    expect(res.status).toBe(200)
    expect(res.body.dados).toMatchObject({ id: 10 })
  })

  test('404 quando o item nao existe', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce(null)
    const res = await request(app).get('/pdr/999')
    expect(res.status).toBe(404)
    expect(res.body.success).toBe(false)
  })
})

describe('POST /pdr', () => {
  test('cria um item e responde 201', async () => {
    mockDb.conn.one.mockResolvedValueOnce({ id: 12 }) // INSERT RETURNING id
    const res = await request(app).post('/pdr').send(itemValido)
    expect(res.status).toBe(201)
    expect(res.body.success).toBe(true)
    expect(res.body.dados).toEqual({ id: 12 })
  })

  test('cod_nd ausente vira 400 (validacao Joi)', async () => {
    const { cod_nd, ...semCodNd } = itemValido
    const res = await request(app).post('/pdr').send(semCodNd)
    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
    expect(mockDb.conn.one).not.toHaveBeenCalled()
  })

  test('ano ausente vira 400 (validacao Joi)', async () => {
    const { ano, ...semAno } = itemValido
    const res = await request(app).post('/pdr').send(semAno)
    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
    expect(mockDb.conn.one).not.toHaveBeenCalled()
  })
})

describe('PUT /pdr/:id', () => {
  test('caminho feliz: atualiza item (rowCount 1) e responde 200', async () => {
    mockDb.conn.result.mockResolvedValueOnce({ rowCount: 1 })
    const res = await request(app).put('/pdr/10').send(itemValido)
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
  })

  test('404 quando o item nao existe (rowCount 0)', async () => {
    mockDb.conn.result.mockResolvedValueOnce({ rowCount: 0 })
    const res = await request(app).put('/pdr/999').send(itemValido)
    expect(res.status).toBe(404)
    expect(res.body.success).toBe(false)
  })
})

describe('DELETE /pdr/:id', () => {
  test('remove com 200 quando nao ha NC vinculada', async () => {
    mockDb.conn.oneOrNone
      .mockResolvedValueOnce({ id: 1 }) // item existe
      .mockResolvedValueOnce(null) // sem NC
    mockDb.conn.none.mockResolvedValueOnce(undefined)
    const res = await request(app).delete('/pdr/1')
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
  })

  test('404 quando o item nao existe', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce(null)
    const res = await request(app).delete('/pdr/999')
    expect(res.status).toBe(404)
    expect(res.body.success).toBe(false)
  })

  test('409 quando ha NC vinculada ao item', async () => {
    mockDb.conn.oneOrNone
      .mockResolvedValueOnce({ id: 1 }) // item existe
      .mockResolvedValueOnce({ '?column?': 1 }) // NC vinculada
    const res = await request(app).delete('/pdr/1')
    expect(res.status).toBe(409)
    expect(res.body.success).toBe(false)
  })
})
