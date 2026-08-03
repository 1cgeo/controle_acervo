'use strict'

// Teste de rota (supertest) da Meta do PIT. Mocka banco + autenticacao (admin).
// Cobre: listar (envelope), criar (sem validar exercicio), validacao Joi (400),
// e a regressao do 409 ao deletar com consumidor vinculado.
//
// A rota saiu de /api/orcamento/metas para /api/metas em 2026-07-31: virou
// PLATAFORMA. Ler pede so login; escrever pede administrador global.

const { createMockDb } = require('../helpers/orcamento/mockDb')

const mockDb = createMockDb()
jest.mock('../../database', () => ({
  db: mockDb,
  databaseVersion: { nome: '1.0.0', load: jest.fn() }
}))
jest.mock('../../login', () => require('../helpers/orcamento/mockLogin'))

const request = require('supertest')
const { buildTestApp } = require('../helpers/orcamento/testApp')
const { TEST_USER } = require('../helpers/orcamento/mockLogin')
const { pitRoute } = require('../../pit')

const app = buildTestApp([{ path: '/metas', router: pitRoute }])

beforeEach(() => mockDb.reset())

/**
 * O parametro do INSERT em auditoria.evento, ou falha dizendo que ele nao houve.
 *
 * Aqui o banco e mockado, entao o que se prova NAO e o SQL: e que a escrita
 * chamou o registro do rastro, dentro do `tx`, com o modulo, a entidade e o
 * autor que o MAPA resolve. A meta do PIT nao tem teste contra banco de verdade,
 * e sem isto a rota poderia deixar de auditar sem nada acusar.
 */
const eventosAuditados = () =>
  mockDb.conn.none.mock.calls
    .filter(([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO auditoria.evento'))
    .map(c => c[1])

// Desde 2026-08-04 uma escrita de meta gera DOIS eventos: a identidade
// (`pit.meta`) e o que a revisao declara (`pit.meta_revisao`). `tabela` diz de
// qual deles se quer falar.
const eventoAuditado = (tabela = 'pit.meta') => {
  const chamadas = eventosAuditados().filter(e => e.tabela === tabela)
  expect(chamadas).toHaveLength(1)
  return chamadas[0]
}

// O exercicio VIGENTE e a revisao ABERTA, que toda escrita de meta consulta
// antes de gravar. Sem elas o controller recusa com 400, que e o comportamento
// desejado e tem teste proprio.
const comRevisaoAberta = () => {
  mockDb.conn.oneOrNone.mockResolvedValueOnce({ situacao_id: 2 })
  mockDb.conn.oneOrNone.mockResolvedValueOnce({ id: 7, codigo: 'R1' })
}

describe('GET /metas', () => {
  test('devolve o envelope padrao com os dados', async () => {
    mockDb.conn.any.mockResolvedValueOnce([{ id: 1, ano: 2026 }])
    const res = await request(app).get('/metas')
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ version: expect.any(String), success: true })
    expect(res.body.dados).toHaveLength(1)
  })

  test('aceita filtro ?ano=', async () => {
    mockDb.conn.any.mockResolvedValueOnce([{ id: 1 }])
    const res = await request(app).get('/metas?ano=2026')
    expect(res.status).toBe(200)
    expect(mockDb.conn.any).toHaveBeenCalledWith(
      expect.stringContaining('WHERE ano = $<ano>'),
      { ano: 2026 }
    )
  })
})

describe('POST /metas', () => {
  test('rejeita body sem ano com 400 (validacao Joi)', async () => {
    const res = await request(app).post('/metas').send({ numero_meta: 1 })
    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
  })

  test('rejeita body sem numero_meta com 400 (validacao Joi)', async () => {
    const res = await request(app).post('/metas').send({ ano: 2026 })
    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
  })

  test('rejeita body sem descricao com 400: ela e a frase que a revisao declara', async () => {
    const res = await request(app)
      .post('/metas')
      .send({ ano: 2026, numero_meta: 1, item: '1.1' })
    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
  })

  test('cria meta e responde com sucesso', async () => {
    comRevisaoAberta()
    mockDb.conn.one.mockResolvedValueOnce({ id: 9 })
    mockDb.conn.one.mockResolvedValueOnce({ id: 3, meta_id: 9 })
    const res = await request(app)
      .post('/metas')
      .send({ ano: 2026, numero_meta: 1, item: '1.1', descricao: 'Meta 1' })
    expect([200, 201]).toContain(res.status)
    expect(res.body.success).toBe(true)
    expect(res.body.dados).toEqual({ id: 9 })
  })

  test('sem exercicio cadastrado, recusa com 400', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce(null)
    const res = await request(app)
      .post('/metas')
      .send({ ano: 2031, numero_meta: 1, item: '1.1', descricao: 'Meta 1' })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/exerc/i)
  })

  // O guard que faz o historico ficar completo POR CONSTRUCAO: nao da para mudar
  // o que o PIT promete sem dizer qual documento autorizou.
  test('sem revisao aberta, recusa com 400 e diz o que fazer', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce({ situacao_id: 2 })
    mockDb.conn.oneOrNone.mockResolvedValueOnce(null)
    const res = await request(app)
      .post('/metas')
      .send({ ano: 2026, numero_meta: 1, item: '1.1', descricao: 'Meta 1' })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/revis/i)
  })

  test('exercicio encerrado recusa com 400', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce({ situacao_id: 3 })
    const res = await request(app)
      .post('/metas')
      .send({ ano: 2025, numero_meta: 1, item: '1.1', descricao: 'Meta 1' })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/encerrado/i)
  })

  // A coerencia entre a origem e a unidade: a origem Producao conta versao do
  // acervo, e uma versao e uma FOLHA.
  test('origem Producao com unidade que nao e Folha recusa com 400', async () => {
    const res = await request(app)
      .post('/metas')
      .send({
        ano: 2026, numero_meta: 1, item: '1.1', descricao: 'Meta 1',
        origem_id: 3, unidade_id: 2
      })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/Folha/)
  })
})

describe('PUT /metas/:id', () => {
  // A DECLARACAO nao mudou (a mesma descricao e a mesma quantidade), entao esta
  // edicao NAO precisa de revisao aberta: ela so mexe na identidade.
  test('atualiza so a identidade sem exigir revisao', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce({ id: 5, numero_meta: 2 })
    mockDb.conn.oneOrNone.mockResolvedValueOnce({ situacao_id: 2 })
    mockDb.conn.one.mockResolvedValueOnce({ id: 5 })
    mockDb.conn.oneOrNone.mockResolvedValueOnce({
      descricao: 'Meta 2', quantidade_prevista: null, prazo: null,
      demandante: null, cancelada: false
    })
    const res = await request(app)
      .put('/metas/5')
      .send({ ano: 2026, numero_meta: 2, item: '2.1', descricao: 'Meta 2' })
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
  })

  test('mudar a quantidade sem revisao aberta recusa com 400', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce({ id: 5, numero_meta: 2 })
    mockDb.conn.oneOrNone.mockResolvedValueOnce({ situacao_id: 2 })
    mockDb.conn.one.mockResolvedValueOnce({ id: 5 })
    mockDb.conn.oneOrNone.mockResolvedValueOnce({
      descricao: 'Meta 2', quantidade_prevista: 24, prazo: null,
      demandante: null, cancelada: false
    })
    mockDb.conn.oneOrNone.mockResolvedValueOnce(null)
    const res = await request(app)
      .put('/metas/5')
      .send({
        ano: 2026, numero_meta: 2, item: '2.1', descricao: 'Meta 2',
        quantidade_prevista: 20
      })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/revis/i)
  })

  test('404 quando a meta nao existe', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce(null)
    const res = await request(app)
      .put('/metas/99')
      .send({ ano: 2026, numero_meta: 1, descricao: 'Meta 1' })
    expect(res.status).toBe(404)
    expect(res.body.success).toBe(false)
  })
})

describe('DELETE /metas/:id', () => {
  test('409 quando ha pdr_item/nota_credito vinculados', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce({ id: 1 }) // existe
    mockDb.conn.one.mockResolvedValueOnce({ n: 1 }) // ha dependentes
    const res = await request(app).delete('/metas/1')
    expect(res.status).toBe(409)
    expect(res.body.success).toBe(false)
  })

  test('exclui quando nao ha dependentes', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce({ id: 1 })
    mockDb.conn.one.mockResolvedValueOnce({ n: 0 })
    mockDb.conn.none.mockResolvedValueOnce(undefined)
    const res = await request(app).delete('/metas/1')
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
  })

  test('404 quando a meta nao existe', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce(null)
    const res = await request(app).delete('/metas/99')
    expect(res.status).toBe(404)
    expect(res.body.success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Rastreabilidade (2026-08-02)
//
// A meta do PIT e rota de PLATAFORMA e alimenta o RPCMTec: o PDR, a NC e o
// pedido de impressao apontam para ela, entao mudar uma meta muda o que os tres
// modulos contam. Ate aqui nenhuma das tres escritas deixava rastro, e a
// exclusao nem sequer recebia o usuario.
// ---------------------------------------------------------------------------

describe('Rastreabilidade da meta do PIT', () => {
  test('POST registra a criacao, com o autor do token', async () => {
    comRevisaoAberta()
    mockDb.conn.one.mockResolvedValueOnce({ id: 9, ano: 2026, numero_meta: 1 })
    mockDb.conn.one.mockResolvedValueOnce({ id: 3, meta_id: 9, revisao_id: 7 })

    await request(app)
      .post('/metas')
      .send({ ano: 2026, numero_meta: 1, item: '1.1', descricao: 'Meta 1' })

    const evento = eventoAuditado()

    // `modulo`, `entidade` e `entidade_id` NAO sao passados pelo chamador: saem
    // do mapa. Passa-los a mao seria a lista digitada que envelhece.
    expect(evento.modulo).toBe('plataforma')
    expect(evento.entidade).toBe('meta')
    expect(evento.entidadeId).toBe('9')
    expect(evento.tabela).toBe('pit.meta')
    expect(evento.operacao).toBe('I')
    expect(evento.usuarioUuid).toBe(TEST_USER.uuid)
    expect(evento.dadosAntes).toBeNull()
  })

  test('PUT registra os dois lados, lidos do BANCO', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce({ id: 5, ano: 2026, numero_meta: 2 })
    mockDb.conn.oneOrNone.mockResolvedValueOnce({ situacao_id: 2 })
    mockDb.conn.one.mockResolvedValueOnce({ id: 5, ano: 2026, numero_meta: 4 })
    mockDb.conn.oneOrNone.mockResolvedValueOnce({
      descricao: 'Meta 4', quantidade_prevista: null, prazo: null,
      demandante: null, cancelada: false
    })

    await request(app).put('/metas/5')
      .send({ ano: 2026, numero_meta: 4, descricao: 'Meta 4' })

    const evento = eventoAuditado()

    expect(evento.operacao).toBe('U')
    // O `lerAntes` substituiu o `SELECT id` que existia so para o 404: sem ele o
    // rastro diria que a meta mudou, sem dizer de que para que.
    expect(JSON.parse(evento.dadosAntes).numero_meta).toBe(2)
    expect(JSON.parse(evento.dadosDepois).numero_meta).toBe(4)
    expect(evento.camposAlterados).toEqual(['numero_meta'])
  })

  test('DELETE registra o que se perdeu', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce({ id: 1, ano: 2026, numero_meta: 7 })
    mockDb.conn.one.mockResolvedValueOnce({ n: 0 })

    const res = await request(app).delete('/metas/1')
    expect(res.status).toBe(200)

    const evento = eventoAuditado()

    expect(evento.operacao).toBe('D')
    expect(evento.dadosDepois).toBeNull()
    expect(JSON.parse(evento.dadosAntes).numero_meta).toBe(7)
    // A rota nao passava o usuario para o `deletar` ate 2026-08-02.
    expect(evento.usuarioUuid).toBe(TEST_USER.uuid)
  })

  test('a exclusao barrada por dependente nao registra nada', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce({ id: 1 })
    mockDb.conn.one.mockResolvedValueOnce({ n: 1 })

    const res = await request(app).delete('/metas/1')
    expect(res.status).toBe(409)

    const chamadas = mockDb.conn.none.mock.calls.filter(
      ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO auditoria.evento')
    )
    expect(chamadas).toHaveLength(0)
  })
})
