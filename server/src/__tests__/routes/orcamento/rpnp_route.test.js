'use strict'

// Teste de rota (supertest) do RPNP. Mocka banco + autenticacao (admin).
// Foco: a regra de identificacao do schema (.or) e o filtro de listagem.

const { createMockDb, eventosDeAuditoria } = require('../../helpers/orcamento/mockDb')

const mockDb = createMockDb()
jest.mock('../../../database', () => ({
  db: mockDb,
  databaseVersion: { nome: '1.0.0', load: jest.fn() }
}))
jest.mock('../../../login', () => require('../../helpers/orcamento/mockLogin'))

const request = require('supertest')
const { buildTestApp } = require('../../helpers/orcamento/testApp')
const { rpnpRoute } = require('../../../orcamento/licitacao')

const app = buildTestApp([{ path: '/rpnp', router: rpnpRoute }])

beforeEach(() => mockDb.reset())

describe('GET /rpnp', () => {
  test('devolve o envelope com os dados', async () => {
    mockDb.conn.any.mockResolvedValueOnce([{ id: 1 }, { id: 2 }])
    const res = await request(app).get('/rpnp')
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.dados).toHaveLength(2)
  })

  test('aceita filtro ?ano=', async () => {
    mockDb.conn.any.mockResolvedValueOnce([{ id: 1 }])
    const res = await request(app).get('/rpnp?ano=2026')
    expect(res.status).toBe(200)
    expect(mockDb.conn.any).toHaveBeenCalledWith(
      expect.any(String),
      { ano: 2026 }
    )
  })
})

describe('POST /rpnp', () => {
  test('400 quando faltam nota_empenho_id e empenho_label (.or)', async () => {
    const res = await request(app)
      .post('/rpnp')
      .send({ ano: 2026, finalidade: 'x' })
    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
  })

  // O CASO QUE O `.or` DEIXAVA PASSAR, e que a tela produz.
  //
  // `rpnp-dialog.js` monta o corpo com as DUAS chaves sempre
  // (`nota_empenho_id: paraId(...)` e `empenho_label: ... || null`), e o `.or`
  // do Joi cobra PRESENCA e nao valor: com os dois campos em branco, o RPNP
  // gravava sem identificacao nenhuma e a lista o mostrava como '-' na coluna
  // Empenho, sem jeito de descobrir de que resto a pagar ele fala.
  test('400 quando as duas chaves vem NULAS, que e o que a tela manda', async () => {
    const res = await request(app)
      .post('/rpnp')
      .send({ ano: 2026, nota_empenho_id: null, empenho_label: null })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/nota de empenho|rótulo/i)
    expect(mockDb.conn.one).not.toHaveBeenCalled()
  })

  test('400 quando o rotulo vem VAZIO e nao ha nota de empenho', async () => {
    const res = await request(app)
      .post('/rpnp')
      .send({ ano: 2026, empenho_label: '   ' })
    expect(res.status).toBe(400)
    expect(mockDb.conn.one).not.toHaveBeenCalled()
  })

  // O OUTRO LADO DO MESMO BRANCO, e o `.custom()` sozinho nao o fechava: com
  // nota de empenho, o rotulo de espacos PASSAVA (ha identificacao) e era
  // GRAVADO, porque `dados.empenho_label || null` ve '   ' como truthy. A lista
  // monta `COALESCE(rp.empenho_label, ne.numero)`, entao os espacos apareciam no
  // lugar de '2023NE000261' e a busca da tabela deixava de achar o resto a pagar
  // pelo numero. Quem conserta e o `.trim()` do schema.
  test('com NE, o rotulo em branco vira NULO e nao esconde o numero', async () => {
    mockDb.conn.one.mockResolvedValueOnce({ id: 26, ano: 2026, nota_empenho_id: 5 })
    const res = await request(app)
      .post('/rpnp')
      .send({ ano: 2026, nota_empenho_id: 5, empenho_label: '   ' })

    expect([200, 201]).toContain(res.status)
    expect(mockDb.conn.one).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO orcamento.rpnp'),
      expect.objectContaining({ empenhoLabel: null, notaEmpenhoId: 5 })
    )
  })

  // O CONTROLE: a nota de empenho sozinha, com o rotulo NULO ao lado, continua
  // sendo o caminho normal da tela.
  test('cria com nota_empenho_id e empenho_label nulo (o corpo da tela)', async () => {
    mockDb.conn.one.mockResolvedValueOnce({ id: 25, ano: 2026, nota_empenho_id: 5 })
    const res = await request(app)
      .post('/rpnp')
      .send({ ano: 2026, nota_empenho_id: 5, empenho_label: null })
    expect([200, 201]).toContain(res.status)
  })

  test('cria com empenho_label apenas', async () => {
    mockDb.conn.one.mockResolvedValueOnce({ id: 22, ano: 2026, empenho_label: '2023NE000261' })
    const res = await request(app)
      .post('/rpnp')
      .send({ ano: 2026, empenho_label: '2023NE000261' })
    expect([200, 201]).toContain(res.status)
    expect(res.body.success).toBe(true)
    // A rota continua devolvendo SO o id: o `RETURNING *` e do rastro.
    expect(res.body.dados).toEqual({ id: 22 })

    expect(eventosDeAuditoria(mockDb)[0]).toMatchObject({
      modulo: 'orcamento',
      entidade: 'rpnp',
      entidadeId: '22',
      tabela: 'orcamento.rpnp',
      operacao: 'I',
      usuarioUuid: '11111111-1111-1111-1111-111111111111'
    })
  })

  test('cria com nota_empenho_id apenas', async () => {
    mockDb.conn.one.mockResolvedValueOnce({ id: 23, ano: 2026, nota_empenho_id: 5 })
    const res = await request(app)
      .post('/rpnp')
      .send({ ano: 2026, nota_empenho_id: 5 })
    expect([200, 201]).toContain(res.status)
    expect(res.body.success).toBe(true)
  })

  test('aceita valor_a_liquidar = 0 (RPNP totalmente liquidado)', async () => {
    mockDb.conn.one.mockResolvedValueOnce({ id: 24, ano: 2026, nota_empenho_id: 5 })
    const res = await request(app)
      .post('/rpnp')
      .send({
        ano: 2026,
        nota_empenho_id: 5,
        valor_empenhado: 10000,
        valor_a_liquidar: 0
      })
    expect([200, 201]).toContain(res.status)
    expect(res.body.success).toBe(true)
    expect(mockDb.conn.one).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ valorALiquidar: 0 })
    )
  })
})
