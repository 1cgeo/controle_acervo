'use strict'

// Teste de rota (supertest) da liquidacao. Mocka banco e autenticacao.
// Cobre: caminho feliz do POST, validacao Joi (valor_liquidado > 0) e a
// regra de estouro do valor empenhado disponivel virando 400 via rota.

const { createMockDb, eventosDeAuditoria } = require('../../helpers/orcamento/mockDb')

const mockDb = createMockDb()
jest.mock('../../../database', () => ({
  db: mockDb,
  databaseVersion: { nome: '1.0.0', load: jest.fn() }
}))
jest.mock('../../../login', () => require('../../helpers/orcamento/mockLogin'))

const request = require('supertest')
const { buildTestApp } = require('../../helpers/orcamento/testApp')
const { liquidacaoRoute } = require('../../../orcamento/nota_empenho')

const app = buildTestApp([{ path: '/liquidacoes', router: liquidacaoRoute }])

beforeEach(() => mockDb.reset())

describe('GET /liquidacoes', () => {
  test('devolve o envelope padrao com os dados', async () => {
    mockDb.conn.any.mockResolvedValueOnce([{ id: 1 }])
    const res = await request(app).get('/liquidacoes')
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.dados).toHaveLength(1)
  })
})

describe('POST /liquidacoes', () => {
  test('cria liquidacao dentro do disponivel com sucesso', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce({
      valor_empenhado: '1000',
      valor_anulado: '0'
    })
    mockDb.conn.one
      .mockResolvedValueOnce({ total: '100' }) // outras
      // `RETURNING *`, e `nota_empenho_id` esta na linha porque
      // e dele que sai o agregado: a liquidacao aparece na ficha da NE, que e a
      // ficha que a pessoa abre.
      .mockResolvedValueOnce({ id: 4, nota_empenho_id: 1, valor_liquidado: '500' })

    const res = await request(app)
      .post('/liquidacoes')
      .send({ nota_empenho_id: 1, valor_liquidado: 500 })
    expect([200, 201]).toContain(res.status)
    expect(res.body.success).toBe(true)
    expect(res.body.dados).toEqual({ id: 4 })

    const eventos = eventosDeAuditoria(mockDb)
    expect(eventos).toHaveLength(1)
    expect(eventos[0]).toMatchObject({
      modulo: 'orcamento',
      entidade: 'nota_empenho',
      entidadeId: '1',
      tabela: 'orcamento.liquidacao',
      registroId: '4',
      operacao: 'I',
      usuarioUuid: '11111111-1111-1111-1111-111111111111'
    })
  })

  test('valor_liquidado = 0 vira 400 (validacao Joi)', async () => {
    const res = await request(app)
      .post('/liquidacoes')
      .send({ nota_empenho_id: 1, valor_liquidado: 0 })
    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
    expect(mockDb.conn.tx).not.toHaveBeenCalled()
  })

  test('nota_empenho_id ausente vira 400', async () => {
    const res = await request(app)
      .post('/liquidacoes')
      .send({ valor_liquidado: 100 })
    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
  })

  test('REGRA: estouro do disponivel vira 400 via rota', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce({
      valor_empenhado: '1000',
      valor_anulado: '0'
    })
    mockDb.conn.one.mockResolvedValueOnce({ total: '900' }) // outras

    // 900 + 200 = 1100 > 1000
    const res = await request(app)
      .post('/liquidacoes')
      .send({ nota_empenho_id: 1, valor_liquidado: 200 })
    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
    expect(res.body.message).toContain('excede o valor empenhado')
    // Recusada a liquidacao, nao ha evento: a auditoria nao registra o que nao
    // foi gravado.
    expect(eventosDeAuditoria(mockDb)).toHaveLength(0)
  })
})
