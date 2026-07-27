'use strict'

// Teste unitario do controller de nota de empenho (banco mockado).
// Cobre: caminho feliz do criar, o saldo_a_liquidar do getPorId, a regra
// do valor_anulado no atualizar e os dois bloqueios de exclusao (liquidacao
// e recebimento de material).

const { createMockDb } = require('../../helpers/orcamento/mockDb')

const mockDb = createMockDb()
jest.mock('../../../database', () => ({
  db: mockDb,
  databaseVersion: { nome: '1.0.0', load: jest.fn() }
}))

const ctrl = require('../../../orcamento/nota_empenho/nota_empenho_ctrl')
const httpCode = require('../../../utils/http_code')

beforeEach(() => mockDb.reset())

describe('nota_empenho_ctrl.criar', () => {
  test('caminho feliz: insere e devolve o id', async () => {
    mockDb.conn.one.mockResolvedValueOnce({ id: 50 })

    const r = await ctrl.criar(
      { numero: 'NE-001', ano: 2026, valor_empenhado: 2000 },
      'uuid'
    )

    expect(r).toEqual({ id: 50 })
    const params = mockDb.conn.one.mock.calls[0][1]
    expect(params.valorEmpenhado).toBe(2000)
    // valor_anulado default 0 quando ausente
    expect(params.valorAnulado).toBe(0)
  })

  test('varias NCs (mesma ND): soma os valores e grava o rateio', async () => {
    // validarNcsHomogeneas consulta as NCs (mesma ND e classificacao)
    mockDb.conn.any.mockResolvedValueOnce([
      { id: 5, cod_nd: '339030', classificacao_id: 2 },
      { id: 6, cod_nd: '339030', classificacao_id: 2 }
    ])
    mockDb.conn.one.mockResolvedValueOnce({ id: 60 }) // INSERT NE RETURNING

    const r = await ctrl.criar(
      {
        numero: 'NE-9',
        ano: 2026,
        notas_credito: [
          { nota_credito_id: 5, valor: 1000 },
          { nota_credito_id: 6, valor: 500 }
        ]
      },
      'uuid'
    )

    expect(r).toEqual({ id: 60 })
    const neParams = mockDb.conn.one.mock.calls[0][1]
    expect(neParams.valorEmpenhado).toBe(1500) // soma das alocacoes
    expect(neParams.notaCreditoId).toBe(5) // primeira NC = representativa
    // duas linhas de rateio inseridas (na junção)
    const inserts = mockDb.conn.none.mock.calls.filter(c =>
      /nota_empenho_nota_credito/.test(c[0])
    )
    expect(inserts).toHaveLength(2)
  })

  test('varias NCs com ND diferente vira 400 (sem inserir)', async () => {
    mockDb.conn.any.mockResolvedValueOnce([
      { id: 5, cod_nd: '339030', classificacao_id: 2 },
      { id: 6, cod_nd: '449052', classificacao_id: 2 }
    ])

    await expect(
      ctrl.criar(
        {
          numero: 'NE',
          ano: 2026,
          notas_credito: [
            { nota_credito_id: 5, valor: 100 },
            { nota_credito_id: 6, valor: 200 }
          ]
        },
        'u'
      )
    ).rejects.toMatchObject({ statusCode: httpCode.BadRequest })
    expect(mockDb.conn.one).not.toHaveBeenCalled()
  })
})

describe('nota_empenho_ctrl.getPorId', () => {
  test('404 quando nao encontra', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce(null)
    await expect(ctrl.getPorId(1)).rejects.toMatchObject({
      statusCode: httpCode.NotFound
    })
  })

  test('calcula saldo_a_liquidar = empenhado - anulado - SUM(liquidado)', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce({
      id: 1,
      valor_empenhado: '1000',
      valor_anulado: '200'
    })
    // liquidacoes da NE
    mockDb.conn.any.mockResolvedValueOnce([
      { id: 1, valor_liquidado: '300' },
      { id: 2, valor_liquidado: '100' }
    ])

    const ne = await ctrl.getPorId(1)

    expect(ne.total_liquidado).toBe(400)
    // 1000 - 200 - 400 = 400
    expect(ne.saldo_a_liquidar).toBe(400)
  })
})

describe('nota_empenho_ctrl.atualizar', () => {
  test('404 quando a NE nao existe', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce(null)
    await expect(
      ctrl.atualizar(1, { numero: 'X', ano: 2026, valor_empenhado: 100, valor_anulado: 0 }, 'u')
    ).rejects.toMatchObject({ statusCode: httpCode.NotFound })
  })

  test('400 quando o anulado deixa o disponivel abaixo do ja liquidado', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce({ id: 1 }) // existe
    mockDb.conn.one.mockResolvedValueOnce({ total: '900' }) // ja liquidado

    // empenhado 1000, anulado 500 => disponivel 500 < 900 liquidado => erro
    await expect(
      ctrl.atualizar(
        1,
        { numero: 'NE', ano: 2026, valor_empenhado: 1000, valor_anulado: 500 },
        'u'
      )
    ).rejects.toMatchObject({ statusCode: httpCode.BadRequest })
  })

  test('atualiza quando o disponivel cobre o liquidado', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce({ id: 1 })
    mockDb.conn.one
      .mockResolvedValueOnce({ total: '300' }) // liquidado
      .mockResolvedValueOnce({ id: 1 }) // UPDATE RETURNING

    const r = await ctrl.atualizar(
      1,
      { numero: 'NE', ano: 2026, valor_empenhado: 1000, valor_anulado: 100 },
      'u'
    )
    expect(r).toEqual({ id: 1 })
  })
})

describe('nota_empenho_ctrl.deletar', () => {
  test('404 quando a NE nao existe', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce(null)
    await expect(ctrl.deletar(1)).rejects.toMatchObject({
      statusCode: httpCode.NotFound
    })
  })

  test('409 quando ha liquidacao vinculada', async () => {
    mockDb.conn.oneOrNone
      .mockResolvedValueOnce({ id: 1 }) // existe
      .mockResolvedValueOnce({ '?column?': 1 }) // liquidacao vinculada

    await expect(ctrl.deletar(1)).rejects.toMatchObject({
      statusCode: httpCode.Conflict
    })
    expect(mockDb.conn.none).not.toHaveBeenCalled()
  })

  test('409 quando ha recebimento de material vinculado', async () => {
    mockDb.conn.oneOrNone
      .mockResolvedValueOnce({ id: 1 }) // existe
      .mockResolvedValueOnce(null) // sem liquidacao
      .mockResolvedValueOnce({ '?column?': 1 }) // recebimento vinculado

    await expect(ctrl.deletar(1)).rejects.toMatchObject({
      statusCode: httpCode.Conflict
    })
    expect(mockDb.conn.none).not.toHaveBeenCalled()
  })

  test('remove quando nao ha dependentes', async () => {
    mockDb.conn.oneOrNone
      .mockResolvedValueOnce({ id: 1 })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
    mockDb.conn.none.mockResolvedValueOnce(undefined)

    await ctrl.deletar(1)
    expect(mockDb.conn.none).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM orcamento.nota_empenho'),
      { id: 1 }
    )
  })
})
