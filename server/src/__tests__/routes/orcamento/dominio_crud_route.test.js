'use strict'

// Teste de rota (supertest) do CRUD admin dos dominios editaveis (natureza de
// despesa, plano interno, UG). Mocka banco e autenticacao (admin passthrough).
// Cobre: criar (201, grupo derivado do GND, 409 codigo duplicado, 400 validacao),
// atualizar (200, 404 via rowCount) e excluir (200, 404 via rowCount, 409 em uso).

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

describe('POST /dominio/natureza_despesa', () => {
  test('cria com 201 e deriva grupo=custeio do GND 3', async () => {
    const res = await request(app)
      .post('/dominio/natureza_despesa')
      .send({ code: '339030', nome: 'Material de consumo', gnd: 3 })
    expect(res.status).toBe(201)
    expect(res.body.success).toBe(true)
    expect(mockDb.conn.none).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ code: '339030', gnd: 3, grupo: 'custeio' })
    )
  })

  test('deriva grupo=capital do GND 4', async () => {
    await request(app)
      .post('/dominio/natureza_despesa')
      .send({ code: '449052', nome: 'Equipamentos', gnd: 4 })
    expect(mockDb.conn.none).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ grupo: 'capital' })
    )
  })

  test('codigo duplicado (23505) vira 409', async () => {
    mockDb.conn.none.mockRejectedValueOnce({ code: '23505' })
    const res = await request(app)
      .post('/dominio/natureza_despesa')
      .send({ code: '339030', nome: 'Repetida', gnd: 3 })
    expect(res.status).toBe(409)
  })

  test('sem nome -> 400 (validacao Joi)', async () => {
    const res = await request(app)
      .post('/dominio/natureza_despesa')
      .send({ code: '339030', gnd: 3 })
    expect(res.status).toBe(400)
  })

  test('GND invalido -> 400', async () => {
    const res = await request(app)
      .post('/dominio/natureza_despesa')
      .send({ code: '339030', nome: 'X', gnd: 5 })
    expect(res.status).toBe(400)
  })
})

describe('PUT /dominio/natureza_despesa/:code', () => {
  test('atualiza com 200 quando existe', async () => {
    mockDb.conn.result.mockResolvedValueOnce({ rowCount: 1 })
    const res = await request(app)
      .put('/dominio/natureza_despesa/339030')
      .send({ nome: 'Novo nome', gnd: 4 })
    expect(res.status).toBe(200)
  })

  test('404 quando nao existe (rowCount 0)', async () => {
    mockDb.conn.result.mockResolvedValueOnce({ rowCount: 0 })
    const res = await request(app)
      .put('/dominio/natureza_despesa/000000')
      .send({ nome: 'X', gnd: 3 })
    expect(res.status).toBe(404)
  })
})

describe('DELETE /dominio/natureza_despesa/:code', () => {
  test('exclui com 200', async () => {
    mockDb.conn.result.mockResolvedValueOnce({ rowCount: 1 })
    const res = await request(app).delete('/dominio/natureza_despesa/339030')
    expect(res.status).toBe(200)
  })

  test('404 quando nao existe', async () => {
    mockDb.conn.result.mockResolvedValueOnce({ rowCount: 0 })
    const res = await request(app).delete('/dominio/natureza_despesa/000000')
    expect(res.status).toBe(404)
  })

  test('em uso (FK 23503) vira 409', async () => {
    mockDb.conn.result.mockRejectedValueOnce({ code: '23503' })
    const res = await request(app).delete('/dominio/natureza_despesa/339030')
    expect(res.status).toBe(409)
  })
})

describe('POST /dominio/plano_interno', () => {
  test('cria com 201 e normaliza alinea vazia para null', async () => {
    const res = await request(app)
      .post('/dominio/plano_interno')
      .send({ code: 'PTRES123', nome: 'Plano X', alinea: '' })
    expect(res.status).toBe(201)
    expect(mockDb.conn.none).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ code: 'PTRES123', alinea: null })
    )
  })

  test('alinea com mais de 1 caractere -> 400', async () => {
    const res = await request(app)
      .post('/dominio/plano_interno')
      .send({ code: 'PTRES123', nome: 'Plano X', alinea: 'AB' })
    expect(res.status).toBe(400)
  })
})

describe('CRUD /dominio/ug', () => {
  test('cria com 201', async () => {
    const res = await request(app)
      .post('/dominio/ug')
      .send({ code: '160382', nome: '1 CGEO' })
    expect(res.status).toBe(201)
    expect(mockDb.conn.none).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ code: '160382', nome: '1 CGEO' })
    )
  })

  test('sem nome -> 400', async () => {
    const res = await request(app).post('/dominio/ug').send({ code: '160382' })
    expect(res.status).toBe(400)
  })

  test('exclui em uso (23503) vira 409', async () => {
    mockDb.conn.result.mockRejectedValueOnce({ code: '23503' })
    const res = await request(app).delete('/dominio/ug/160382')
    expect(res.status).toBe(409)
  })
})
