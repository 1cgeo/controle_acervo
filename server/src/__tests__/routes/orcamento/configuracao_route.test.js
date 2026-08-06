'use strict'

// Teste de rota (supertest) do que sobrou da Configuracao do orcamento.
// Mocka banco + autenticacao (admin).
//   * GET /configuracao/anos   -> devolve a lista de anos (mock db.conn.any)
//   * GET /configuracao        -> 404: a rota SAIU
//   * PUT /configuracao        -> 404: a rota SAIU
//
// A tabela `orcamento.configuracao` guardava `uasg` e `codom` e foi podada em
// 2026-08-06 (migrations/2026-08-06_poda_configuracao_orcamento.sql). As duas
// estavam preenchidas, corretas e sem um unico leitor fora da propria tela.
//
// O `/anos` NAO lia aquela tabela: ele varre o `ano` das tabelas de negocio e
// alimenta o seletor de ano de todas as telas do modulo. Por isso ele fica, e
// por isso o caminho continua com o nome da tabela que morreu.

const { createMockDb } = require('../../helpers/orcamento/mockDb')

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

  test('nao consulta a tabela que foi podada', async () => {
    mockDb.conn.any.mockResolvedValueOnce([])
    await request(app).get('/configuracao/anos')
    for (const [sql] of mockDb.conn.any.mock.calls) {
      expect(String(sql)).not.toContain('orcamento.configuracao')
    }
  })
})

// Estes dois REPROVAM o estado anterior a poda: antes de 2026-08-06 os dois
// respondiam 200. Cliente antigo, com a aba aberta desde antes do deploy, leva
// 404 ao abrir ou salvar os "Dados gerais" ate recarregar a pagina. A tela e
// admin-only e a secao inteira saiu do JS novo, entao o alcance e pequeno.
describe('as rotas da linha unica sairam', () => {
  test('GET /configuracao responde 404', async () => {
    const res = await request(app).get('/configuracao')
    expect(res.status).toBe(404)
    expect(mockDb.conn.one).not.toHaveBeenCalled()
  })

  test('PUT /configuracao responde 404 e nao grava nada', async () => {
    const res = await request(app)
      .put('/configuracao')
      .send({ uasg: '160500', codom: '048215' })
    expect(res.status).toBe(404)
    expect(mockDb.conn.one).not.toHaveBeenCalled()
    expect(mockDb.conn.none).not.toHaveBeenCalled()
  })
})
