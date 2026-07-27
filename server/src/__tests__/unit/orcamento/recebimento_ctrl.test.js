'use strict'

// Teste unitario do controller de recebimento de material (banco mockado).
// Cobre o ano_referencia (usado pela 3.6 para itens de RPNP recebidos em ano
// diferente do empenho) no criar/atualizar.

const { createMockDb } = require('../../helpers/orcamento/mockDb')

const mockDb = createMockDb()
jest.mock('../../../database', () => ({
  db: mockDb,
  databaseVersion: { nome: '1.0.0', load: jest.fn() }
}))

const ctrl = require('../../../orcamento/nota_empenho/recebimento_ctrl')
const httpCode = require('../../../utils/http_code')

describe('recebimento_ctrl', () => {
  beforeEach(() => mockDb.reset())

  test('criar envia ano_referencia quando informado', async () => {
    mockDb.conn.one.mockResolvedValueOnce({ id: 30 })
    const r = await ctrl.criar(
      { nota_empenho_id: 51, material: 'Nobreak', ano_referencia: 2026 },
      'uuid'
    )
    expect(r).toEqual({ id: 30 })
    expect(mockDb.conn.one).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO orcamento.recebimento_material'),
      expect.objectContaining({ notaEmpenhoId: 51, anoReferencia: 2026 })
    )
  })

  test('criar usa null quando ano_referencia ausente (cai no ano da NE na 3.6)', async () => {
    mockDb.conn.one.mockResolvedValueOnce({ id: 31 })
    await ctrl.criar({ nota_empenho_id: 12, material: 'Tinta' }, 'uuid')
    expect(mockDb.conn.one).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ anoReferencia: null })
    )
  })

  test('atualizar envia ano_referencia', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce({ id: 10 })
    mockDb.conn.one.mockResolvedValueOnce({ id: 10 })
    await ctrl.atualizar(
      10,
      { nota_empenho_id: 51, material: 'Nobreak', ano_referencia: 2026 },
      'uuid'
    )
    expect(mockDb.conn.one).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE orcamento.recebimento_material'),
      expect.objectContaining({ id: 10, anoReferencia: 2026 })
    )
  })

  test('atualizar inexistente vira 404', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce(null)
    await expect(
      ctrl.atualizar(99, { nota_empenho_id: 1, material: 'x' }, 'uuid')
    ).rejects.toMatchObject({ statusCode: httpCode.NotFound })
  })
})
