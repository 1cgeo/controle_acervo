'use strict'

// Teste unitario do controller de licitacao (banco mockado).
// Cobre: criar (tipo_id 1/2), listar com filtros, deletar (nada referencia a
// licitacao) e 404. A licitacao nao tem mais vinculo com DFD.

const { createMockDb } = require('../../helpers/orcamento/mockDb')

const mockDb = createMockDb()
jest.mock('../../../database', () => ({
  db: mockDb,
  databaseVersion: { nome: '1.0.0', load: jest.fn() }
}))

const ctrl = require('../../../orcamento/licitacao/licitacao_ctrl')
const httpCode = require('../../../utils/http_code')

describe('licitacao_ctrl', () => {
  beforeEach(() => mockDb.reset())

  test('criar (tipo_id 1) insere e devolve o id', async () => {
    mockDb.conn.one.mockResolvedValueOnce({ id: 11 })
    const r = await ctrl.criar(
      { ano: 2026, tipo_id: 1, objeto: 'GCALC DSG' },
      'uuid'
    )
    expect(r).toEqual({ id: 11 })
    expect(mockDb.conn.one).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO orcamento.licitacao'),
      expect.objectContaining({ ano: 2026, tipoId: 1 })
    )
  })

  test('criar (tipo_id 2) insere e devolve o id', async () => {
    mockDb.conn.one.mockResolvedValueOnce({ id: 12 })
    const r = await ctrl.criar(
      { ano: 2026, tipo_id: 2, objeto: 'Propria' },
      'uuid'
    )
    expect(r).toEqual({ id: 12 })
    expect(mockDb.conn.one).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ tipoId: 2 })
    )
  })

  test('listar passa os filtros ano e tipo_id', async () => {
    mockDb.conn.any.mockResolvedValueOnce([{ id: 1 }])
    const r = await ctrl.listar({ ano: 2026, tipo_id: 1 })
    expect(r).toHaveLength(1)
    expect(mockDb.conn.any).toHaveBeenCalledWith(
      expect.any(String),
      { ano: 2026, tipoId: 1 }
    )
  })

  test('listar sem filtros usa null (todos)', async () => {
    mockDb.conn.any.mockResolvedValueOnce([])
    await ctrl.listar()
    expect(mockDb.conn.any).toHaveBeenCalledWith(
      expect.any(String),
      { ano: null, tipoId: null }
    )
  })

  test('deletar remove a licitacao (nada a referencia)', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce({ id: 1 }) // licitacao existe
    mockDb.conn.none.mockResolvedValueOnce(undefined)
    await ctrl.deletar(1)
    expect(mockDb.conn.none).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM orcamento.licitacao'),
      { id: 1 }
    )
  })

  test('deletar com licitacao inexistente vira 404', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce(null)
    await expect(ctrl.deletar(99)).rejects.toMatchObject({
      statusCode: httpCode.NotFound
    })
  })
})
