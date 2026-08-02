'use strict'

// Teste de rota (supertest) da nota de empenho. Mocka banco e autenticacao.
// Cobre: GET, caminho feliz do POST, validacao Joi (valor_empenhado > 0 e
// valor_anulado <= valor_empenhado) e o 409 do DELETE.

const { createMockDb, eventosDeAuditoria } = require('../../helpers/orcamento/mockDb')

const mockDb = createMockDb()
jest.mock('../../../database', () => ({
  db: mockDb,
  databaseVersion: { nome: '1.0.0', load: jest.fn() }
}))
jest.mock('../../../login', () => require('../../helpers/orcamento/mockLogin'))

const request = require('supertest')
const { buildTestApp } = require('../../helpers/orcamento/testApp')
const { notaEmpenhoRoute } = require('../../../orcamento/nota_empenho')

const app = buildTestApp([{ path: '/notas_empenho', router: notaEmpenhoRoute }])

beforeEach(() => mockDb.reset())

// A NE empenha contra uma NC (nota_credito_id obrigatorio); ND/PI/GND sao
// herdados da NC, entao nao vao no corpo.
const bodyValido = { numero: 'NE-001', ano: 2026, nota_credito_id: 5, valor_empenhado: 2000 }

describe('GET /notas_empenho', () => {
  test('devolve o envelope padrao com os dados', async () => {
    mockDb.conn.any.mockResolvedValueOnce([{ id: 1 }])
    const res = await request(app).get('/notas_empenho')
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ version: expect.any(String), success: true })
    expect(res.body.dados).toHaveLength(1)
  })
})

describe('POST /notas_empenho', () => {
  test('cria NE e responde com sucesso', async () => {
    mockDb.conn.one.mockResolvedValueOnce({ id: 7, ...bodyValido })
    const res = await request(app).post('/notas_empenho').send(bodyValido)
    expect([200, 201]).toContain(res.status)
    expect(res.body.success).toBe(true)
    // A rota continua devolvendo SO o id: o `RETURNING *` e do rastro.
    expect(res.body.dados).toEqual({ id: 7 })
  })

  // SAO DOIS EVENTOS, e o segundo descreve a LISTA do rateio.
  //
  // `nota_empenho_nota_credito` e "apaga tudo e reinsere", como os itens do DFD:
  // auditar linha a linha faria o historico da NE dizer "removeu 2 alocacoes,
  // acrescentou 2 alocacoes" em todo salvamento.
  test('registra a NE e o RATEIO, os dois na ficha da NE', async () => {
    mockDb.conn.one.mockResolvedValueOnce({ id: 7, ...bodyValido })
    mockDb.conn.any.mockResolvedValueOnce([
      { nota_credito_id: 5, valor: '2000.00' }
    ]) // releitura do rateio, para o rastro
    await request(app).post('/notas_empenho').send(bodyValido)

    const eventos = eventosDeAuditoria(mockDb)
    expect(eventos).toHaveLength(2)

    expect(eventos[0]).toMatchObject({
      modulo: 'orcamento',
      entidade: 'nota_empenho',
      entidadeId: '7',
      tabela: 'orcamento.nota_empenho',
      registroId: '7',
      operacao: 'I',
      usuarioUuid: '11111111-1111-1111-1111-111111111111'
    })

    expect(eventos[1]).toMatchObject({
      entidade: 'nota_empenho',
      entidadeId: '7',
      tabela: 'orcamento.nota_empenho_nota_credito',
      operacao: 'I',
      // Sem `registro_id`: o evento descreve a lista, e nao uma linha.
      registroId: null
    })
    expect(JSON.parse(eventos[1].dadosDepois).alocacoes).toEqual(['NC #5: 2000.00'])
  })

  test('valor_empenhado = 0 vira 400 (deve ser positivo)', async () => {
    const res = await request(app)
      .post('/notas_empenho')
      .send({ ...bodyValido, valor_empenhado: 0 })
    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
    expect(mockDb.conn.one).not.toHaveBeenCalled()
  })

  test('valor_empenhado ausente vira 400', async () => {
    const { valor_empenhado, ...sem } = bodyValido
    const res = await request(app).post('/notas_empenho').send(sem)
    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
  })

  test('nota_credito_id ausente vira 400 (NC obrigatoria)', async () => {
    const { nota_credito_id, ...sem } = bodyValido
    const res = await request(app).post('/notas_empenho').send(sem)
    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
    expect(mockDb.conn.one).not.toHaveBeenCalled()
  })

  test('valor_anulado > valor_empenhado vira 400', async () => {
    const res = await request(app)
      .post('/notas_empenho')
      .send({ ...bodyValido, valor_empenhado: 1000, valor_anulado: 1500 })
    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
    expect(mockDb.conn.one).not.toHaveBeenCalled()
  })

  test('cria NE com varias NCs (notas_credito)', async () => {
    mockDb.conn.any.mockResolvedValueOnce([
      { id: 5, cod_nd: '339030', classificacao_id: 2 },
      { id: 6, cod_nd: '339030', classificacao_id: 2 }
    ])
    mockDb.conn.one.mockResolvedValueOnce({ id: 8, numero: 'NE-2', ano: 2026 })
    const res = await request(app)
      .post('/notas_empenho')
      .send({
        numero: 'NE-2',
        ano: 2026,
        notas_credito: [
          { nota_credito_id: 5, valor: 1000 },
          { nota_credito_id: 6, valor: 500 }
        ]
      })
    expect([200, 201]).toContain(res.status)
    expect(res.body.success).toBe(true)
    expect(res.body.dados).toEqual({ id: 8 })
  })

  test('400 ao informar nota_credito_id e notas_credito juntos (oxor)', async () => {
    const res = await request(app)
      .post('/notas_empenho')
      .send({ ...bodyValido, notas_credito: [{ nota_credito_id: 6, valor: 100 }] })
    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
    expect(mockDb.conn.one).not.toHaveBeenCalled()
  })
})

describe('GET /notas_empenho/:id', () => {
  test('traz saldo_a_liquidar', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce({
      id: 1,
      valor_empenhado: '1000',
      valor_anulado: '0'
    })
    mockDb.conn.any.mockResolvedValueOnce([{ id: 1, valor_liquidado: '250' }])

    const res = await request(app).get('/notas_empenho/1')
    expect(res.status).toBe(200)
    expect(res.body.dados.saldo_a_liquidar).toBe(750)
  })

  test('404 quando nao existe', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce(null)
    const res = await request(app).get('/notas_empenho/999')
    expect(res.status).toBe(404)
    expect(res.body.success).toBe(false)
  })
})

// Eram QUATRO comandos em quatro conexoes ate 2026-08-02 (o `SELECT id`, as duas
// checagens de dependencia e o DELETE). Hoje e uma transacao so, e o `SELECT id`
// virou `lerAntes`.
describe('DELETE /notas_empenho/:id', () => {
  test('409 quando ha liquidacao vinculada', async () => {
    mockDb.conn.oneOrNone
      .mockResolvedValueOnce({ id: 1, ...bodyValido }) // lerAntes
      .mockResolvedValueOnce({ '?column?': 1 }) // liquidacao vinculada
    const res = await request(app).delete('/notas_empenho/1')
    expect(res.status).toBe(409)
    expect(res.body.success).toBe(false)
    // Recusada a exclusao, nada foi apagado e nada se registra.
    expect(eventosDeAuditoria(mockDb)).toHaveLength(0)
  })

  test('exclui e registra a NE mais o rateio que cai por cascata', async () => {
    mockDb.conn.oneOrNone
      .mockResolvedValueOnce({ id: 1, ...bodyValido, valor_empenhado: '2000.00' })
      .mockResolvedValueOnce(null) // sem liquidacao
      .mockResolvedValueOnce(null) // sem recebimento
    mockDb.conn.any.mockResolvedValueOnce([{ nota_credito_id: 5, valor: '2000.00' }])
    mockDb.conn.none.mockResolvedValueOnce(undefined)

    const res = await request(app).delete('/notas_empenho/1')
    expect(res.status).toBe(200)

    const eventos = eventosDeAuditoria(mockDb)
    const tabelas = eventos.map(e => e.tabela)
    // O rateio cai por ON DELETE CASCADE, sem DELETE explicito: sem este evento,
    // a divisao do empenho entre as NCs desapareceria sem rastro nenhum.
    expect(tabelas).toContain('orcamento.nota_empenho_nota_credito')
    expect(tabelas).toContain('orcamento.nota_empenho')
    for (const evento of eventos) {
      expect(evento.operacao).toBe('D')
      expect(evento.dadosDepois).toBeNull()
    }
  })
})
