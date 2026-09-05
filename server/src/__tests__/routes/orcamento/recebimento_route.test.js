'use strict'

// Teste de rota (supertest) do recebimento de material. Mocka banco e
// autenticacao.
//
// O arquivo cobre o basico das tres rotas (caminho feliz, 404 e a validacao do
// Joi) junto do EVENTO de cada escrita.
//
// O agregado e a NOTA DE EMPENHO, e nao o recebimento: ninguem abre "recebimento
// n.o 812"; abre a ficha da NE e olha o que foi recebido contra ela.

const { createMockDb, eventosDeAuditoria } = require('../../helpers/orcamento/mockDb')

const mockDb = createMockDb()
jest.mock('../../../database', () => ({
  db: mockDb,
  databaseVersion: { nome: '1.0.0', load: jest.fn() }
}))
jest.mock('../../../login', () => require('../../helpers/orcamento/mockLogin'))

const request = require('supertest')
const { buildTestApp } = require('../../helpers/orcamento/testApp')
const { recebimentoRoute } = require('../../../orcamento/nota_empenho')

const app = buildTestApp([{ path: '/recebimentos', router: recebimentoRoute }])

const AUTOR = '11111111-1111-1111-1111-111111111111'

const bodyValido = {
  nota_empenho_id: 3,
  material: 'Plotter HP DesignJet',
  prazo_entrega: '30 dias',
  situacao: 'Aguardando entrega'
}

beforeEach(() => mockDb.reset())

describe('POST /recebimentos', () => {
  test('cria e registra o evento na ficha da NE', async () => {
    mockDb.conn.one.mockResolvedValueOnce({ id: 15, ...bodyValido })
    const res = await request(app).post('/recebimentos').send(bodyValido)
    expect([200, 201]).toContain(res.status)
    // A rota continua devolvendo SO o id: o `RETURNING *` e do rastro.
    expect(res.body.dados).toEqual({ id: 15 })

    expect(eventosDeAuditoria(mockDb)[0]).toMatchObject({
      modulo: 'orcamento',
      entidade: 'nota_empenho',
      entidadeId: '3',
      tabela: 'orcamento.recebimento_material',
      registroId: '15',
      operacao: 'I',
      usuarioUuid: AUTOR
    })
  })

  test('sem material vira 400 (validacao Joi)', async () => {
    const { material, ...sem } = bodyValido
    const res = await request(app).post('/recebimentos').send(sem)
    expect(res.status).toBe(400)
    expect(mockDb.conn.one).not.toHaveBeenCalled()
  })

  // O DIA DO RECEBIMENTO ENTRA PELA PORTA, e e ele que recorta a 4.6 pelo MES
  // da edicao. A coluna nasceu em 2026-08-11 e o Joi nao a conhecia, entao o
  // validador ESTRITO do modulo recusava o campo com 400 e a tela nao tinha como
  // informar o dia: toda linha nova nascia com o dia NULO, e a edicao de janeiro
  // listava material recebido em julho.
  test('aceita data_recebimento, e ela chega crua ao banco', async () => {
    mockDb.conn.one.mockResolvedValueOnce({ id: 16, ...bodyValido })
    const res = await request(app)
      .post('/recebimentos')
      .send({ ...bodyValido, data_recebimento: '2026-07-31' })

    expect([200, 201]).toContain(res.status)
    // CRUA, e nao um Date: `Joi.date().iso().raw()` preserva 'YYYY-MM-DD'. Sem
    // o `.raw()` a coluna DATE guardaria 30/07 em UTC-3.
    expect(mockDb.conn.one).toHaveBeenCalledWith(
      expect.stringContaining('data_recebimento'),
      expect.objectContaining({ dataRecebimento: '2026-07-31' })
    )
  })

  test('data_recebimento fora do ISO vira 400, e nao 8 de janeiro', async () => {
    const res = await request(app)
      .post('/recebimentos')
      .send({ ...bodyValido, data_recebimento: '01/08/2026' })

    expect(res.status).toBe(400)
    expect(mockDb.conn.one).not.toHaveBeenCalled()
  })

  // A NE e obrigatoria: o recebimento nao existe solto.
  test('NE inexistente (FK 23503) vira 400 com mensagem, e nao 500', async () => {
    mockDb.conn.one.mockRejectedValueOnce({ code: '23503' })
    const res = await request(app).post('/recebimentos').send(bodyValido)
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/nota de empenho/i)
  })
})

describe('PUT /recebimentos/:id', () => {
  test('a alteracao guarda os dois lados', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce({
      id: 15,
      ...bodyValido,
      situacao: 'Aguardando entrega'
    }) // lerAntes
    mockDb.conn.one.mockResolvedValueOnce({
      id: 15,
      ...bodyValido,
      situacao: 'Recebido'
    })

    const res = await request(app)
      .put('/recebimentos/15')
      .send({ ...bodyValido, situacao: 'Recebido' })
    expect(res.status).toBe(200)

    const [evento] = eventosDeAuditoria(mockDb)
    expect(evento.operacao).toBe('U')
    expect(evento.camposAlterados).toEqual(['situacao'])
    expect(JSON.parse(evento.dadosAntes).situacao).toBe('Aguardando entrega')
    expect(JSON.parse(evento.dadosDepois).situacao).toBe('Recebido')
  })

  test('404 quando o recebimento nao existe', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce(null)
    const res = await request(app).put('/recebimentos/999').send(bodyValido)
    expect(res.status).toBe(404)
    expect(eventosDeAuditoria(mockDb)).toHaveLength(0)
  })
})

describe('DELETE /recebimentos/:id', () => {
  test('exclui e guarda o que se perdeu', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce({ id: 15, ...bodyValido })
    mockDb.conn.none.mockResolvedValueOnce(undefined)
    const res = await request(app).delete('/recebimentos/15')
    expect(res.status).toBe(200)

    const [evento] = eventosDeAuditoria(mockDb)
    expect(evento).toMatchObject({ operacao: 'D', usuarioUuid: AUTOR })
    expect(JSON.parse(evento.dadosAntes).material).toBe('Plotter HP DesignJet')
    expect(evento.dadosDepois).toBeNull()
  })

  test('404 quando o recebimento nao existe', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce(null)
    const res = await request(app).delete('/recebimentos/999')
    expect(res.status).toBe(404)
  })
})
