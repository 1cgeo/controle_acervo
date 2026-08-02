'use strict'

// Teste de rota (supertest) da nota de credito. Mocka banco e autenticacao.
// Cobre: GET com filtros, caminho feliz do POST, validacao Joi (valor_nc),
// a regra de strip do pdr_item_id por classificacao e o 409 do DELETE.

const { createMockDb, eventosDeAuditoria } = require('../../helpers/orcamento/mockDb')

const mockDb = createMockDb()
jest.mock('../../../database', () => ({
  db: mockDb,
  databaseVersion: { nome: '1.0.0', load: jest.fn() }
}))
jest.mock('../../../login', () => require('../../helpers/orcamento/mockLogin'))

const request = require('supertest')
const { buildTestApp } = require('../../helpers/orcamento/testApp')
const { notaCreditoRoute } = require('../../../orcamento/nota_credito')

const app = buildTestApp([{ path: '/notas_credito', router: notaCreditoRoute }])

beforeEach(() => mockDb.reset())

const bodyValido = {
  numero: 'NC-001',
  ano: 2026,
  cod_nd: '339030',
  valor_nc: 1000,
  classificacao_id: 1,
  pdr_item_id: 7
}

describe('GET /notas_credito', () => {
  test('devolve o envelope padrao com os dados', async () => {
    mockDb.conn.any.mockResolvedValueOnce([{ id: 1 }, { id: 2 }])
    const res = await request(app).get('/notas_credito')
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ version: expect.any(String), success: true })
    expect(res.body.dados).toHaveLength(2)
  })

  test('aceita filtros ?ano= e ?classificacao_id= e os repassa ao ctrl', async () => {
    mockDb.conn.any.mockResolvedValueOnce([])
    const res = await request(app)
      .get('/notas_credito')
      .query({ ano: 2026, classificacao_id: 2 })
    expect(res.status).toBe(200)
    const [, params] = mockDb.conn.any.mock.calls[0]
    expect(params).toEqual({ ano: 2026, classificacaoId: 2 })
  })

  test('classificacao_id invalido (3) vira 400', async () => {
    const res = await request(app)
      .get('/notas_credito')
      .query({ classificacao_id: 3 })
    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
  })
})

describe('POST /notas_credito', () => {
  test('cria NC e responde com sucesso', async () => {
    mockDb.conn.one.mockResolvedValueOnce({ id: 10, ...bodyValido })
    const res = await request(app).post('/notas_credito').send(bodyValido)
    expect([200, 201]).toContain(res.status)
    expect(res.body.success).toBe(true)
    // A rota continua devolvendo SO o id: o `RETURNING *` e do rastro.
    expect(res.body.dados).toEqual({ id: 10 })

    expect(eventosDeAuditoria(mockDb)[0]).toMatchObject({
      modulo: 'orcamento',
      entidade: 'nota_credito',
      entidadeId: '10',
      tabela: 'orcamento.nota_credito',
      registroId: '10',
      operacao: 'I',
      usuarioUuid: '11111111-1111-1111-1111-111111111111'
    })
  })

  // A pergunta mais provavel deste modulo e "qual era o valor antes". Ate
  // 2026-08-02 a resposta nao existia: o `SELECT id` lia so a chave.
  test('a alteracao guarda o valor ANTERIOR da NC', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce({
      id: 10,
      ...bodyValido,
      valor_nc: '1000.00'
    }) // lerAntes
    mockDb.conn.one.mockResolvedValueOnce({
      id: 10,
      ...bodyValido,
      valor_nc: '2500.00'
    })

    const res = await request(app)
      .put('/notas_credito/10')
      .send({ ...bodyValido, valor_nc: 2500 })
    expect(res.status).toBe(200)

    const [evento] = eventosDeAuditoria(mockDb)
    expect(evento.operacao).toBe('U')
    expect(evento.camposAlterados).toEqual(['valor_nc'])
    expect(JSON.parse(evento.dadosAntes).valor_nc).toBe('1000.00')
    expect(JSON.parse(evento.dadosDepois).valor_nc).toBe('2500.00')
  })

  test('valor_nc ausente vira 400 (validacao Joi)', async () => {
    const { valor_nc, ...semValor } = bodyValido
    const res = await request(app).post('/notas_credito').send(semValor)
    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
    expect(mockDb.conn.one).not.toHaveBeenCalled()
  })

  test('valor_nc = 0 vira 400 (deve ser positivo)', async () => {
    const res = await request(app)
      .post('/notas_credito')
      .send({ ...bodyValido, valor_nc: 0 })
    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
    expect(mockDb.conn.one).not.toHaveBeenCalled()
  })

  test('regra: classificacao Extra-PDR (2) com pdr_item_id => o item nao chega ao banco', async () => {
    mockDb.conn.one.mockResolvedValueOnce({ id: 11, ...bodyValido, classificacao_id: 2 })
    const res = await request(app)
      .post('/notas_credito')
      .send({ ...bodyValido, classificacao_id: 2, pdr_item_id: 99 })
    expect([200, 201]).toContain(res.status)
    // o schema faz strip do pdr_item_id; o ctrl grava null
    const params = mockDb.conn.one.mock.calls[0][1]
    expect(params.pdrItemId).toBeNull()
  })
})

// As quatro consultas desta rota rodavam em QUATRO CONEXOES diferentes ate
// 2026-08-02 (o `SELECT id`, as duas checagens de dependencia e o DELETE). Hoje
// e uma transacao so, e o `SELECT id` virou `lerAntes`.
describe('DELETE /notas_credito/:id', () => {
  test('409 quando ha nota de empenho vinculada', async () => {
    mockDb.conn.oneOrNone
      .mockResolvedValueOnce({ id: 1, ...bodyValido }) // lerAntes
      .mockResolvedValueOnce({ '?column?': 1 }) // NE vinculada
    const res = await request(app).delete('/notas_credito/1')
    expect(res.status).toBe(409)
    expect(res.body.success).toBe(false)
    // Recusada a exclusao, nada foi apagado e nada se registra.
    expect(eventosDeAuditoria(mockDb)).toHaveLength(0)
  })

  test('remove com 200 quando nao ha dependentes', async () => {
    mockDb.conn.oneOrNone
      .mockResolvedValueOnce({ id: 1, ...bodyValido, valor_nc: '1000.00' }) // lerAntes
      .mockResolvedValueOnce(null) // sem NE
      .mockResolvedValueOnce(null) // sem complementacao
    mockDb.conn.any.mockResolvedValueOnce([]) // anexos que cairiam por cascata
    mockDb.conn.none.mockResolvedValueOnce(undefined)
    const res = await request(app).delete('/notas_credito/1')
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)

    const [evento] = eventosDeAuditoria(mockDb)
    expect(evento).toMatchObject({ tabela: 'orcamento.nota_credito', operacao: 'D' })
    expect(JSON.parse(evento.dadosAntes).valor_nc).toBe('1000.00')
    expect(evento.dadosDepois).toBeNull()
  })

  // O anexo (PDF do SIAFI) cai por ON DELETE CASCADE, sem DELETE explicito no
  // controller. Sem o evento proprio, o unico registro de que ele existiu
  // sumiria em silencio junto com a NC.
  test('o anexo que cai por cascata tambem deixa rastro', async () => {
    mockDb.conn.oneOrNone
      .mockResolvedValueOnce({ id: 1, ...bodyValido })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
    mockDb.conn.any.mockResolvedValueOnce([
      { id: 77, nota_credito_id: 1, dfd_id: null, pdr_ano: null, nome_original: 'nc.pdf' }
    ])
    mockDb.conn.none.mockResolvedValueOnce(undefined)
    await request(app).delete('/notas_credito/1')

    const eventos = eventosDeAuditoria(mockDb)
    const anexo = eventos.find(e => e.tabela === 'orcamento.arquivo')
    expect(anexo).toMatchObject({
      operacao: 'D',
      registroId: '77',
      // A entidade dona do anexo sai da LINHA: aqui, a propria NC.
      entidade: 'nota_credito',
      entidadeId: '1'
    })
    expect(JSON.parse(anexo.dadosAntes)).not.toHaveProperty('conteudo')
  })
})
