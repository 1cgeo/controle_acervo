'use strict'

// Teste unitario do controller de liquidacao (banco mockado).
// REGRA CRITICA: a soma das liquidacoes nao pode exceder o valor empenhado
// disponivel (valor_empenhado - valor_anulado). Validada em transacao no criar
// e no atualizar (este ultimo ignorando a propria liquidacao no recalculo).

const { createMockDb } = require('../../helpers/orcamento/mockDb')

const mockDb = createMockDb()
jest.mock('../../../database', () => ({
  db: mockDb,
  databaseVersion: { nome: '1.0.0', load: jest.fn() }
}))

const ctrl = require('../../../orcamento/nota_empenho/liquidacao_ctrl')
const httpCode = require('../../../utils/http_code')

beforeEach(() => mockDb.reset())

describe('liquidacao_ctrl.criar', () => {
  test('caminho feliz: dentro do disponivel, insere e devolve id', async () => {
    // carregarDisponivel: oneOrNone (NE) + one (SUM outras)
    mockDb.conn.oneOrNone.mockResolvedValueOnce({
      valor_empenhado: '1000',
      valor_anulado: '0'
    })
    mockDb.conn.one
      .mockResolvedValueOnce({ total: '200' }) // outras liquidacoes
      .mockResolvedValueOnce({ id: 9, nota_empenho_id: 1 }) // INSERT RETURNING *

    const r = await ctrl.criar(
      { nota_empenho_id: 1, valor_liquidado: 300 },
      'uuid'
    )

    expect(r).toEqual({ id: 9 })
    // a transacao roda no proprio conn (t === conn)
    expect(mockDb.conn.tx).toHaveBeenCalledTimes(1)
  })

  test('404 quando a NE nao existe na transacao', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce(null) // NE inexistente
    await expect(
      ctrl.criar({ nota_empenho_id: 999, valor_liquidado: 10 }, 'u')
    ).rejects.toMatchObject({ statusCode: httpCode.NotFound })
  })

  test('REGRA: estouro do disponivel -> 400 com a mensagem padrao', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce({
      valor_empenhado: '1000',
      valor_anulado: '200'
    }) // disponivel = 800
    mockDb.conn.one.mockResolvedValueOnce({ total: '600' }) // outras liquidacoes

    // 600 + 300 = 900 > 800 disponivel
    await expect(
      ctrl.criar({ nota_empenho_id: 1, valor_liquidado: 300 }, 'u')
    ).rejects.toMatchObject({
      statusCode: httpCode.BadRequest,
      message: 'Liquidação excede o valor empenhado disponível'
    })
    // nao chega a inserir
    expect(mockDb.conn.one).toHaveBeenCalledTimes(1)
  })

  // O SALDO EXATO PASSA MESMO COM RESIDUO DE PONTO FLUTUANTE.
  //
  // Os valores sao NUMERIC(15,2) e chegam como TEXTO; `Number()` os aproxima.
  //
  // O TRIO E ESCOLHIDO, e nao qualquer um: medido em node em 2026-09-05,
  // Number('1000.00') + Number('128.11') da 1128.1100000000001 e
  // Number('1128.11') da 1128.11 exatos, entao a soma fica 2,3e-13 ACIMA do teto
  // e a comparacao CRUA recusa a liquidacao que quita a NE. SEM a tolerancia de
  // meio centavo este caso reprova -- e e isso que ele existe para provar.
  //
  // O PAR OBVIO NAO SERVE, e foi o que este caso media ate hoje: com uma NE de
  // 1.000,10 e 500,05 ja liquidados, Number('500.05') + Number('500.05') e
  // Number('1000.10') sao bit a bit o MESMO double, a comparacao crua ja passava
  // e o caso ficava verde com e sem a tolerancia.
  test('a liquidacao do saldo EXATO passa apesar do residuo de ponto flutuante', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce({
      valor_empenhado: '1128.11',
      valor_anulado: '0.00'
    })
    mockDb.conn.one
      .mockResolvedValueOnce({ total: '1000.00' }) // outras liquidacoes
      .mockResolvedValueOnce({ id: 4, nota_empenho_id: 1 }) // INSERT RETURNING *

    const r = await ctrl.criar(
      { nota_empenho_id: 1, valor_liquidado: 128.11 },
      'u'
    )

    expect(r).toEqual({ id: 4 })
  })

  // O CONTROLE, sobre a MESMA NE do caso acima: a tolerancia e de MEIO CENTAVO,
  // e nao um cheque em branco. Um centavo a mais continua sendo estouro.
  test('um centavo acima do disponivel continua recusado', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce({
      valor_empenhado: '1128.11',
      valor_anulado: '0.00'
    })
    mockDb.conn.one.mockResolvedValueOnce({ total: '1000.00' })

    await expect(
      ctrl.criar({ nota_empenho_id: 1, valor_liquidado: 128.12 }, 'u')
    ).rejects.toMatchObject({
      statusCode: httpCode.BadRequest,
      message: 'Liquidação excede o valor empenhado disponível'
    })
  })

  test('exatamente no limite e aceito (nao excede)', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce({
      valor_empenhado: '1000',
      valor_anulado: '0'
    })
    mockDb.conn.one
      .mockResolvedValueOnce({ total: '700' }) // outras
      .mockResolvedValueOnce({ id: 3, nota_empenho_id: 1 }) // INSERT RETURNING *
    // 700 + 300 = 1000 == disponivel => ok
    const r = await ctrl.criar(
      { nota_empenho_id: 1, valor_liquidado: 300 },
      'u'
    )
    expect(r).toEqual({ id: 3 })
  })
})

describe('liquidacao_ctrl.atualizar', () => {
  test('404 quando a liquidacao nao existe', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce(null) // SELECT id liquidacao
    await expect(
      ctrl.atualizar(1, { nota_empenho_id: 1, valor_liquidado: 10 }, 'u')
    ).rejects.toMatchObject({ statusCode: httpCode.NotFound })
  })

  test('REGRA: estouro no recalculo (ignorando a propria) -> 400', async () => {
    mockDb.conn.oneOrNone
      .mockResolvedValueOnce({ id: 1, nota_empenho_id: 1 }) // liquidacao existe
      .mockResolvedValueOnce({ valor_empenhado: '1000', valor_anulado: '0' }) // NE
    mockDb.conn.one.mockResolvedValueOnce({ total: '900' }) // outras (sem esta)

    // 900 + 200 = 1100 > 1000
    await expect(
      ctrl.atualizar(1, { nota_empenho_id: 1, valor_liquidado: 200 }, 'u')
    ).rejects.toMatchObject({
      statusCode: httpCode.BadRequest,
      message: 'Liquidação excede o valor empenhado disponível'
    })
  })

  test('atualiza quando cabe no disponivel', async () => {
    mockDb.conn.oneOrNone
      .mockResolvedValueOnce({ id: 1, nota_empenho_id: 1 }) // existe
      .mockResolvedValueOnce({ valor_empenhado: '1000', valor_anulado: '0' }) // NE
    mockDb.conn.one
      .mockResolvedValueOnce({ total: '300' }) // outras
      .mockResolvedValueOnce({ id: 1, nota_empenho_id: 1 }) // UPDATE RETURNING *

    const r = await ctrl.atualizar(
      1,
      { nota_empenho_id: 1, valor_liquidado: 400 },
      'u'
    )
    expect(r).toEqual({ id: 1 })
  })
})

describe('liquidacao_ctrl.deletar', () => {
  test('404 quando nao existe', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce(null)
    await expect(ctrl.deletar(1, 'uuid')).rejects.toMatchObject({
      statusCode: httpCode.NotFound
    })
  })

  test('remove quando existe, e o autor da exclusao chega ao controller', async () => {
    // A linha INTEIRA, e nao so o id: ela e o `dados_antes` do evento, o unico
    // registro do que se perdeu. E o `deletar` recebe o uuid de quem apaga.
    mockDb.conn.oneOrNone.mockResolvedValueOnce({
      id: 1, nota_empenho_id: 1, valor_liquidado: '100'
    })
    mockDb.conn.none.mockResolvedValueOnce(undefined)
    await ctrl.deletar(1, 'uuid')
    expect(mockDb.conn.none).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM orcamento.liquidacao'),
      { id: 1 }
    )
  })
})
