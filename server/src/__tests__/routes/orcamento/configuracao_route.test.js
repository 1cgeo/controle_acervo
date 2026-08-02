'use strict'

// Teste de rota (supertest) da Configuracao (linha unica uasg/codom/ano_referencia).
// Mocka banco + autenticacao (admin).
//   * GET /configuracao        -> devolve a config (mock db.conn.one)
//   * PUT /configuracao        -> atualiza e devolve a config (mock db.conn.one)
//   * GET /configuracao/anos   -> devolve a lista de anos (mock db.conn.any)

const { createMockDb, eventosDeAuditoria } = require('../../helpers/orcamento/mockDb')

const mockDb = createMockDb()
jest.mock('../../../database', () => ({
  db: mockDb,
  databaseVersion: { nome: '1.0.0', load: jest.fn() }
}))
jest.mock('../../../login', () => require('../../helpers/orcamento/mockLogin'))

const request = require('supertest')
const { buildTestApp } = require('../../helpers/orcamento/testApp')
const { configuracaoRoute } = require('../../../orcamento/configuracao')

const app = buildTestApp([{ path: '/configuracao', router: configuracaoRoute }])

beforeEach(() => mockDb.reset())

describe('GET /configuracao', () => {
  test('devolve a configuracao (linha unica)', async () => {
    mockDb.conn.one.mockResolvedValueOnce({
      id: 1,
      uasg: '160382',
      codom: '048215',
      ano_referencia: 2026
    })
    const res = await request(app).get('/configuracao')
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ version: expect.any(String), success: true })
    expect(res.body.dados).toMatchObject({ uasg: '160382', codom: '048215', ano_referencia: 2026 })
  })

  test('ano_referencia nulo cai no ano corrente como default', async () => {
    mockDb.conn.one.mockResolvedValueOnce({
      id: 1,
      uasg: '160382',
      codom: '048215',
      ano_referencia: null
    })
    const res = await request(app).get('/configuracao')
    expect(res.status).toBe(200)
    expect(res.body.dados.ano_referencia).toBe(new Date().getFullYear())
  })
})

describe('PUT /configuracao', () => {
  // A ORDEM das consultas mudou com a rastreabilidade: o `lerAntes` (oneOrNone)
  // vem ANTES do UPDATE, e e ele que produz o `dados_antes`. Este e o unico
  // ajuste que a fase 4 pediu nos testes mockados, e ele se repete em todo caso
  // de `atualizar` e `deletar` do modulo.
  const preparaUpdate = () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce({
      id: 1,
      uasg: '160382',
      codom: '048215',
      ano_referencia: 2026
    })
    mockDb.conn.one.mockResolvedValueOnce({
      id: 1,
      uasg: '160500',
      codom: '048215',
      ano_referencia: 2027
    })
  }

  test('atualiza e devolve a configuracao', async () => {
    preparaUpdate()
    const res = await request(app)
      .put('/configuracao')
      .send({ uasg: '160500', codom: '048215', ano_referencia: 2027 })
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.dados).toMatchObject({ uasg: '160500', ano_referencia: 2027 })
    expect(mockDb.conn.one).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE orcamento.configuracao'),
      expect.objectContaining({ uasg: '160500', anoReferencia: 2027 })
    )
  })

  test('registra o evento de rastreabilidade com o autor do token', async () => {
    preparaUpdate()
    await request(app)
      .put('/configuracao')
      .send({ uasg: '160500', codom: '048215', ano_referencia: 2027 })

    const eventos = eventosDeAuditoria(mockDb)
    expect(eventos).toHaveLength(1)
    expect(eventos[0]).toMatchObject({
      modulo: 'orcamento',
      entidade: 'configuracao',
      // Singleton: a ficha e a propria pagina Configuração, e o agregado e
      // sempre 1.
      entidadeId: '1',
      tabela: 'orcamento.configuracao',
      operacao: 'U',
      usuarioUuid: '11111111-1111-1111-1111-111111111111'
    })
    // O diff e CALCULADO dos dois lados lidos do banco.
    expect(eventos[0].camposAlterados).toEqual(['ano_referencia', 'uasg'])
  })

  test('ano_referencia string (strict) vira 400 (validacao Joi)', async () => {
    const res = await request(app)
      .put('/configuracao')
      .send({ uasg: '160500', ano_referencia: '2027' })
    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
  })
})

describe('GET /configuracao/anos', () => {
  test('devolve a lista de anos distintos', async () => {
    const atual = new Date().getFullYear()
    mockDb.conn.any.mockResolvedValueOnce([{ ano: atual }, { ano: 2025 }, { ano: 2024 }])
    const res = await request(app).get('/configuracao/anos')
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.dados).toEqual(expect.arrayContaining([atual, 2025, 2024]))
  })

  test('garante o ano corrente mesmo sem dado no banco', async () => {
    mockDb.conn.any.mockResolvedValueOnce([])
    const res = await request(app).get('/configuracao/anos')
    expect(res.status).toBe(200)
    expect(res.body.dados).toContain(new Date().getFullYear())
  })
})
