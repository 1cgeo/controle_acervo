'use strict'

// Teste de rota (supertest) da Configuracao (linha unica uasg/codom).
// Mocka banco + autenticacao (admin).
//   * GET /configuracao        -> devolve a config (mock db.conn.one)
//   * PUT /configuracao        -> atualiza e devolve a config (mock db.conn.one)
//   * GET /configuracao/anos   -> devolve a lista de anos (mock db.conn.any)
//
// O `ano_referencia` saiu do contrato em 2026-08-04: o ano virou filtro de cada
// tela. A COLUNA ainda existe no banco (o DROP vai em migracao propria), entao
// o que se prova aqui e que a rota nao le nem grava o campo.

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
      codom: '048215'
    })
    const res = await request(app).get('/configuracao')
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ version: expect.any(String), success: true })
    expect(res.body.dados).toMatchObject({ uasg: '160382', codom: '048215' })
  })

  test('o SELECT nao le mais o ano_referencia', async () => {
    mockDb.conn.one.mockResolvedValueOnce({ id: 1, uasg: '160382', codom: '048215' })
    await request(app).get('/configuracao')
    const [sql] = mockDb.conn.one.mock.calls[0]
    expect(sql).toContain('FROM orcamento.configuracao')
    expect(sql).not.toContain('ano_referencia')
  })
})

describe('PUT /configuracao', () => {
  // A ORDEM das consultas mudou com a rastreabilidade: o `lerAntes` (oneOrNone)
  // vem ANTES do UPDATE, e e ele que produz o `dados_antes`. Este e o unico
  // ajuste que a fase 4 pediu nos testes mockados, e ele se repete em todo caso
  // de `atualizar` e `deletar` do modulo.
  //
  // Os dois lados carregam o `ano_referencia` de proposito: a coluna continua no
  // banco e volta no `RETURNING *`. O UPDATE nao a toca, entao ela sai igual dos
  // dois lados e nao entra no diff.
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
      ano_referencia: 2026
    })
  }

  test('atualiza e devolve a configuracao', async () => {
    preparaUpdate()
    const res = await request(app)
      .put('/configuracao')
      .send({ uasg: '160500', codom: '048215' })
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.dados).toMatchObject({ uasg: '160500', codom: '048215' })
    // A resposta perdeu o campo: nao ha mais ano padrao para a tela ler.
    expect(res.body.dados).not.toHaveProperty('ano_referencia')
    expect(mockDb.conn.one).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE orcamento.configuracao'),
      expect.objectContaining({ uasg: '160500' })
    )
  })

  test('registra o evento de rastreabilidade com o autor do token', async () => {
    preparaUpdate()
    await request(app)
      .put('/configuracao')
      .send({ uasg: '160500', codom: '048215' })

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
    expect(eventos[0].camposAlterados).toEqual(['uasg'])
  })

  // Cliente antigo (ou aba aberta desde antes da mudanca) ainda manda o campo.
  //
  // O modulo orcamento tem schemaValidation PROPRIO, que RECUSA chave
  // desconhecida com 400 (ver o comentario de src/orcamento/utils/index.js). Ele
  // nao e o do SCA, que descartaria com `stripUnknown` e devolveria 200 com
  // aviso. A diferenca importa no deploy: enquanto houver aba aberta com o JS
  // antigo, salvar a Configuracao devolve 400 ate a pagina ser recarregada.
  // A tela e admin-only e pouco usada, entao o alcance e pequeno; o teste existe
  // para ninguem se surpreender com o 400.
  test('ano_referencia de cliente antigo e RECUSADO com 400', async () => {
    preparaUpdate()
    const res = await request(app)
      .put('/configuracao')
      .send({ uasg: '160500', codom: '048215', ano_referencia: 2027 })

    expect(res.status).toBe(400)
    expect(String(res.body.message || res.body.error)).toContain('ano_referencia')

    // Nenhum UPDATE roda: a validacao barra antes do controller.
    const chamou = mockDb.conn.one.mock.calls.some(
      ([texto]) => String(texto).includes('UPDATE orcamento.configuracao')
    )
    expect(chamou).toBe(false)
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
