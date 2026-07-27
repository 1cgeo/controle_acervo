'use strict'

// Teste de rota (supertest) dos anexos. Mocka banco e autenticacao. Cobre a
// validacao do vinculo (exatamente um entre NC/DFD/PDR), o 400 de POST sem
// arquivo, o download (bytes do banco) e o DELETE (200 e 404). O upload real
// (multer + banco) e coberto na suite de integracao.

const { createMockDb } = require('../../helpers/orcamento/mockDb')

const mockDb = createMockDb()
jest.mock('../../../database', () => ({
  db: mockDb,
  databaseVersion: { nome: '1.1.0', load: jest.fn() }
}))
jest.mock('../../../login', () => require('../../helpers/orcamento/mockLogin'))

const request = require('supertest')
const { buildTestApp } = require('../../helpers/orcamento/testApp')
const { arquivoRoute } = require('../../../orcamento/arquivo')

const app = buildTestApp([{ path: '/arquivo', router: arquivoRoute }])

beforeEach(() => mockDb.reset())

describe('GET /arquivo (validacao do vinculo)', () => {
  test('lista por nota_credito_id', async () => {
    mockDb.conn.any.mockResolvedValueOnce([{ id: 1 }, { id: 2 }])
    const res = await request(app).get('/arquivo').query({ nota_credito_id: 5 })
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.dados).toHaveLength(2)
  })

  test('sem vinculo vira 400 (pelo menos um obrigatorio)', async () => {
    const res = await request(app).get('/arquivo')
    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
  })

  test('dois vinculos viram 400 (no maximo um)', async () => {
    const res = await request(app)
      .get('/arquivo')
      .query({ nota_credito_id: 5, dfd_id: 6 })
    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
  })
})

describe('POST /arquivo', () => {
  test('sem vinculo vira 400', async () => {
    const res = await request(app).post('/arquivo')
    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
  })

  test('vinculo valido mas sem arquivo vira 400', async () => {
    const res = await request(app).post('/arquivo').query({ pdr_ano: 2026 })
    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
    expect(res.body.message).toMatch(/arquivo/i)
  })
})

describe('GET /arquivo/:id/download', () => {
  test('devolve os bytes do banco com os cabecalhos certos', async () => {
    const conteudo = Buffer.from('%PDF-1.4 bytes do banco')
    mockDb.conn.oneOrNone.mockResolvedValueOnce({
      id: 7,
      nome_original: 'extrato.pdf',
      mimetype: 'application/pdf',
      conteudo
    })
    const res = await request(app).get('/arquivo/7/download')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/pdf/)
    expect(res.headers['content-disposition']).toMatch(/extrato\.pdf/)
    expect(Buffer.from(res.body)).toEqual(conteudo)
  })

  test('404 quando o anexo nao existe', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce(null)
    const res = await request(app).get('/arquivo/123/download')
    expect(res.status).toBe(404)
    expect(res.body.success).toBe(false)
  })
})

describe('DELETE /arquivo/:id', () => {
  test('200 quando o anexo existe', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce({ id: 9 })
    mockDb.conn.none.mockResolvedValueOnce(undefined)
    const res = await request(app).delete('/arquivo/9')
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
  })

  test('404 quando o anexo nao existe', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce(null)
    const res = await request(app).delete('/arquivo/123')
    expect(res.status).toBe(404)
    expect(res.body.success).toBe(false)
  })
})
