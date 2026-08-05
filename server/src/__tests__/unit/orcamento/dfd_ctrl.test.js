'use strict'

// Teste unitario do controller de DFD (banco mockado).
// Cobre: criar com itens (tx: INSERT dfd RETURNING id + insert dos itens),
// getPorId trazendo itens, e deletar (remove os itens e o DFD; a licitacao nao
// referencia mais o DFD, entao nao ha bloqueio por licitacao).

const { createMockDb } = require('../../helpers/orcamento/mockDb')

const mockDb = createMockDb()
jest.mock('../../../database', () => ({
  db: mockDb,
  databaseVersion: { nome: '1.0.0', load: jest.fn() }
}))

const ctrl = require('../../../orcamento/dfd/dfd_ctrl')
const httpCode = require('../../../utils/http_code')

describe('dfd_ctrl', () => {
  beforeEach(() => mockDb.reset())

  test('criar insere o DFD e os itens na transacao', async () => {
    mockDb.conn.one.mockResolvedValueOnce({ id: 42, numero: 'DFD-001', ano: 2026 }) // INSERT dfd RETURNING *
    mockDb.conn.none.mockResolvedValueOnce(undefined) // insert em lote dos itens

    const r = await ctrl.criar(
      {
        numero: 'DFD-001',
        ano: 2026,
        objeto: 'Aquisicao',
        consta_pca: true,
        itens: [
          { tipo_item_id: 1, descricao: 'Item A', quantidade: 2, valor_unitario: 50, valor_total: 100 }
        ]
      },
      'uuid-1'
    )

    expect(r).toEqual({ id: 42 })
    expect(mockDb.conn.tx).toHaveBeenCalledTimes(1)
    expect(mockDb.conn.one).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO orcamento.dfd'),
      expect.objectContaining({ numero: 'DFD-001', ano: 2026 })
    )
    // Os itens viram um insert em lote (db.pgp.helpers.insert) -> t.none(query).
    //
    // Contagem crua de `none` deixou de dizer isto: a auditoria
    // grava o evento pelo MESMO `none`, entao o numero passa a somar as duas
    // coisas e muda toda vez que alguem acrescenta um evento. Asserir o SQL diz
    // o que aconteceu e continua valendo.
    const insertsDeItem = mockDb.conn.none.mock.calls
      .filter(([sql]) => String(sql).includes('"dfd_item"'))
    expect(insertsDeItem).toHaveLength(1)
  })

  test('criar sem itens nao chama o insert em lote', async () => {
    mockDb.conn.one.mockResolvedValueOnce({ id: 5, numero: 'DFD-002', ano: 2026 })
    await ctrl.criar(
      { numero: 'DFD-002', ano: 2026, objeto: 'x', itens: [] },
      'uuid'
    )
    const insertsDeItem = mockDb.conn.none.mock.calls
      .filter(([sql]) => String(sql).includes('"dfd_item"'))
    expect(insertsDeItem).toHaveLength(0)
  })

  test('getPorId traz o DFD com o array de itens', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce({ id: 42, numero: 'DFD-001' })
    mockDb.conn.any.mockResolvedValueOnce([
      { id: 1, descricao: 'Item A' },
      { id: 2, descricao: 'Item B' }
    ])

    const r = await ctrl.getPorId(42)

    expect(r.id).toBe(42)
    expect(Array.isArray(r.itens)).toBe(true)
    expect(r.itens).toHaveLength(2)
  })

  test('getPorId com DFD inexistente vira 404', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce(null)
    await expect(ctrl.getPorId(99)).rejects.toMatchObject({
      statusCode: httpCode.NotFound
    })
  })

  test('deletar remove os itens e o DFD', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce({ id: 10 }) // DFD existe
    mockDb.conn.none
      .mockResolvedValueOnce(undefined) // DELETE itens
      .mockResolvedValueOnce(undefined) // DELETE dfd

    await ctrl.deletar(10)

    expect(mockDb.conn.none).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM orcamento.dfd_item'),
      { id: 10 }
    )
    expect(mockDb.conn.none).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM orcamento.dfd WHERE'),
      { id: 10 }
    )
  })

  test('deletar com DFD inexistente vira 404', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce(null)
    await expect(ctrl.deletar(99)).rejects.toMatchObject({
      statusCode: httpCode.NotFound
    })
  })
})
