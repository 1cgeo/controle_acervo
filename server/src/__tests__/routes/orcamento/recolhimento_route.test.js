'use strict'

// Teste de rota (supertest) do RECOLHIMENTO DE CREDITO. Mocka banco e
// autenticacao (admin).
//
// Foco: o contrato de escrita (o que o schema exige e o que ele recusa), a
// traducao do 409 da chave (ano, numero, NC alvo) e a ficha em que o rastro cai
// -- que e a da NOTA DE CREDITO, e nao uma ficha propria do recolhimento.

const { createMockDb, eventosDeAuditoria } = require('../../helpers/orcamento/mockDb')

const mockDb = createMockDb()
jest.mock('../../../database', () => ({
  db: mockDb,
  databaseVersion: { nome: '1.0.0', load: jest.fn() }
}))
jest.mock('../../../login', () => require('../../helpers/orcamento/mockLogin'))

const request = require('supertest')
const { buildTestApp } = require('../../helpers/orcamento/testApp')
const { recolhimentoRoute } = require('../../../orcamento/nota_credito')

const app = buildTestApp([{ path: '/recolhimentos', router: recolhimentoRoute }])

const corpoValido = {
  nota_credito_id: 5,
  numero: '2026NC401316',
  ano: 2026,
  valor: 0.98
}

beforeEach(() => mockDb.reset())

describe('GET /recolhimentos', () => {
  test('devolve o envelope com os dados', async () => {
    mockDb.conn.any.mockResolvedValueOnce([{ id: 1 }, { id: 2 }])
    const res = await request(app).get('/recolhimentos')
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.dados).toHaveLength(2)
  })

  test('aceita os filtros ?nota_credito_id= e ?ano=', async () => {
    mockDb.conn.any.mockResolvedValueOnce([{ id: 1 }])
    const res = await request(app).get('/recolhimentos?nota_credito_id=5&ano=2026')
    expect(res.status).toBe(200)
    expect(mockDb.conn.any).toHaveBeenCalledWith(
      expect.any(String),
      { notaCreditoId: 5, ano: 2026 }
    )
  })

  test('sem filtro nenhum manda null nos dois', async () => {
    mockDb.conn.any.mockResolvedValueOnce([])
    await request(app).get('/recolhimentos')
    expect(mockDb.conn.any).toHaveBeenCalledWith(
      expect.any(String),
      { notaCreditoId: null, ano: null }
    )
  })
})

describe('GET /recolhimentos/:id', () => {
  test('404 quando nao existe', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce(null)
    const res = await request(app).get('/recolhimentos/9')
    expect(res.status).toBe(404)
    expect(res.body.success).toBe(false)
  })
})

describe('POST /recolhimentos', () => {
  test('cria e devolve so o id', async () => {
    mockDb.conn.one.mockResolvedValueOnce({ id: 31, ...corpoValido })
    const res = await request(app).post('/recolhimentos').send(corpoValido)
    expect([200, 201]).toContain(res.status)
    expect(res.body.success).toBe(true)
    // A rota devolve SO o id: o `RETURNING *` e do rastro.
    expect(res.body.dados).toEqual({ id: 31 })
  })

  // O RASTRO CAI NA FICHA DA NC, e este e o ponto da entrada nova no mapa de
  // auditoria. Ninguem abre "recolhimento n.o 31": abre a nota de credito e
  // olha o que dela foi devolvido. Com `entidade: 'recolhimento'`, o evento
  // ficaria numa ficha que nenhuma tela abre.
  test('o evento vai para a ficha da NOTA DE CREDITO que ele abate', async () => {
    mockDb.conn.one.mockResolvedValueOnce({ id: 31, ...corpoValido })
    await request(app).post('/recolhimentos').send(corpoValido)

    const eventos = eventosDeAuditoria(mockDb)
    expect(eventos).toHaveLength(1)
    expect(eventos[0]).toMatchObject({
      modulo: 'orcamento',
      entidade: 'nota_credito',
      // o id da NC, e nao o do recolhimento
      entidadeId: '5',
      tabela: 'orcamento.nota_credito_recolhimento',
      registroId: '31',
      operacao: 'I',
      usuarioUuid: '11111111-1111-1111-1111-111111111111'
    })
  })

  test('400 sem nota_credito_id: recolhimento que nao abate nada nao e deste modulo', async () => {
    const { nota_credito_id: _, ...semAlvo } = corpoValido
    const res = await request(app).post('/recolhimentos').send(semAlvo)
    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
    expect(mockDb.conn.one).not.toHaveBeenCalled()
  })

  test('400 com valor zero: recolhimento de zero nao e documento nenhum', async () => {
    const res = await request(app)
      .post('/recolhimentos')
      .send({ ...corpoValido, valor: 0 })
    expect(res.status).toBe(400)
    expect(mockDb.conn.one).not.toHaveBeenCalled()
  })

  test('400 com valor negativo', async () => {
    const res = await request(app)
      .post('/recolhimentos')
      .send({ ...corpoValido, valor: -10 })
    expect(res.status).toBe(400)
  })

  // A COLISAO DA CHAVE VIRA 409 COM EXPLICACAO, e nao erro cru do banco: o mesmo
  // documento PODE entrar de novo para outra NC (rateio), e a mensagem tem de
  // dizer isso, senao quem lanca o rateio acha que o sistema recusou o segundo
  // lancamento legitimo.
  test('409 quando o par (ano, numero, NC) ja existe', async () => {
    const erro = new Error('duplicate key')
    erro.code = '23505'
    mockDb.conn.one.mockRejectedValueOnce(erro)

    const res = await request(app).post('/recolhimentos').send(corpoValido)
    expect(res.status).toBe(409)
    expect(res.body.success).toBe(false)
  })

  test('400 quando a nota de credito nao existe (FK)', async () => {
    const erro = new Error('fk')
    erro.code = '23503'
    erro.detail = 'Key (nota_credito_id)=(999) is not present in table "nota_credito".'
    mockDb.conn.one.mockRejectedValueOnce(erro)

    const res = await request(app).post('/recolhimentos').send(corpoValido)
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/nota de credito/i)
  })

  // A REPETICAO DO NUMERO PARA OUTRA NC E LEGITIMA, e sem este caso o de cima
  // passaria numa implementacao que recusasse todo numero repetido.
  test('o mesmo numero para OUTRA nota de credito passa', async () => {
    mockDb.conn.one.mockResolvedValueOnce({ id: 32, ...corpoValido, nota_credito_id: 6 })
    const res = await request(app)
      .post('/recolhimentos')
      .send({ ...corpoValido, nota_credito_id: 6, valor: 0.99 })
    expect([200, 201]).toContain(res.status)
    expect(res.body.dados).toEqual({ id: 32 })
  })
})

describe('PUT /recolhimentos/:id', () => {
  test('atualiza e devolve 200', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce({ id: 31, ...corpoValido })
    mockDb.conn.one.mockResolvedValueOnce({ id: 31, ...corpoValido, valor: 1.5 })
    const res = await request(app)
      .put('/recolhimentos/31')
      .send({ ...corpoValido, valor: 1.5 })
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
  })

  test('404 quando o recolhimento nao existe', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce(null)
    const res = await request(app).put('/recolhimentos/99').send(corpoValido)
    expect(res.status).toBe(404)
  })
})

describe('DELETE /recolhimentos/:id', () => {
  test('remove e devolve 200', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce({ id: 31, ...corpoValido })
    const res = await request(app).delete('/recolhimentos/31')
    expect(res.status).toBe(200)
    expect(mockDb.conn.none).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM orcamento.nota_credito_recolhimento'),
      { id: 31 }
    )
  })
})
