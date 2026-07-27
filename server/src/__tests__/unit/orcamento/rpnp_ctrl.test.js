'use strict'

// Teste unitario do controller de RPNP (banco mockado).
// Cobre: criar e listar com filtro de ano. A regra de identificacao
// (nota_empenho_id OU empenho_label) e do schema, exercitada no teste de rota.

const { createMockDb } = require('../../helpers/orcamento/mockDb')

const mockDb = createMockDb()
jest.mock('../../../database', () => ({
  db: mockDb,
  databaseVersion: { nome: '1.0.0', load: jest.fn() }
}))

const ctrl = require('../../../orcamento/licitacao/rpnp_ctrl')
const httpCode = require('../../../utils/http_code')

describe('rpnp_ctrl', () => {
  beforeEach(() => mockDb.reset())

  test('criar com nota_empenho_id insere e devolve o id', async () => {
    mockDb.conn.one.mockResolvedValueOnce({ id: 21 })
    const r = await ctrl.criar(
      { ano: 2026, nota_empenho_id: 3, finalidade: 'x' },
      'uuid'
    )
    expect(r).toEqual({ id: 21 })
    expect(mockDb.conn.one).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO orcamento.rpnp'),
      expect.objectContaining({ ano: 2026, notaEmpenhoId: 3 })
    )
  })

  test('criar com empenho_label (sem nota cadastrada) insere', async () => {
    mockDb.conn.one.mockResolvedValueOnce({ id: 22 })
    const r = await ctrl.criar(
      { ano: 2026, empenho_label: '2023NE000261' },
      'uuid'
    )
    expect(r).toEqual({ id: 22 })
    expect(mockDb.conn.one).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ empenhoLabel: '2023NE000261', notaEmpenhoId: null })
    )
  })

  test('listar passa o filtro ano', async () => {
    mockDb.conn.any.mockResolvedValueOnce([{ id: 1 }, { id: 2 }])
    const r = await ctrl.listar({ ano: 2026 })
    expect(r).toHaveLength(2)
    expect(mockDb.conn.any).toHaveBeenCalledWith(
      expect.any(String),
      { ano: 2026 }
    )
  })

  test('listar sem filtro usa null', async () => {
    mockDb.conn.any.mockResolvedValueOnce([])
    await ctrl.listar()
    expect(mockDb.conn.any).toHaveBeenCalledWith(
      expect.any(String),
      { ano: null }
    )
  })

  test('deletar com RPNP inexistente vira 404', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce(null)
    await expect(ctrl.deletar(99)).rejects.toMatchObject({
      statusCode: httpCode.NotFound
    })
  })
})
