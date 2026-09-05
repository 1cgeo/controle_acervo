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
    mockDb.conn.one.mockResolvedValueOnce({ id: 30, nota_empenho_id: 51 })
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
    mockDb.conn.one.mockResolvedValueOnce({ id: 31, nota_empenho_id: 12 })
    await ctrl.criar({ nota_empenho_id: 12, material: 'Tinta' }, 'uuid')
    expect(mockDb.conn.one).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ anoReferencia: null })
    )
  })

  test('atualizar envia ano_referencia', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce({ id: 10, nota_empenho_id: 51 })
    mockDb.conn.one.mockResolvedValueOnce({ id: 10, nota_empenho_id: 51 })
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

  // O DIA DO RECEBIMENTO E QUEM RECORTA A 4.6 PELO MES DA EDICAO
  // (`rpcmtec_ctrl.js`: `rm.data_recebimento IS NULL OR <= cutoff`). A coluna
  // nasceu em 2026-08-11 e ficou INERTE: sem campo no Joi e sem coluna no
  // INSERT/UPDATE, toda linha nova nascia com o dia NULO, e a regra do
  // relatorio ("nulo continua aparecendo") fazia a edicao de janeiro listar
  // material recebido em julho. E o mesmo defeito que a chave do SIAFI da NE
  // teve por 24 horas.
  test('criar grava data_recebimento, que e o dia do corte da 4.6', async () => {
    mockDb.conn.one.mockResolvedValueOnce({ id: 32, nota_empenho_id: 51 })
    await ctrl.criar(
      {
        nota_empenho_id: 51,
        material: 'Nobreak',
        data_recebimento: '2026-07-31'
      },
      'uuid'
    )
    const [sql, params] = mockDb.conn.one.mock.calls[0]
    expect(String(sql)).toContain('data_recebimento')
    expect(params).toMatchObject({ dataRecebimento: '2026-07-31' })
  })

  test('criar usa null quando o dia nao e conhecido', async () => {
    mockDb.conn.one.mockResolvedValueOnce({ id: 33, nota_empenho_id: 51 })
    await ctrl.criar({ nota_empenho_id: 51, material: 'Tinta' }, 'uuid')
    expect(mockDb.conn.one).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ dataRecebimento: null })
    )
  })

  test('atualizar grava data_recebimento', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce({ id: 10, nota_empenho_id: 51 })
    mockDb.conn.one.mockResolvedValueOnce({ id: 10, nota_empenho_id: 51 })
    await ctrl.atualizar(
      10,
      {
        nota_empenho_id: 51,
        material: 'Nobreak',
        data_recebimento: '2026-04-30'
      },
      'uuid'
    )
    const [sql, params] = mockDb.conn.one.mock.calls[0]
    expect(String(sql)).toContain('data_recebimento = $<dataRecebimento>')
    expect(params).toMatchObject({ dataRecebimento: '2026-04-30' })
  })

  test('atualizar inexistente vira 404', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce(null)
    await expect(
      ctrl.atualizar(99, { nota_empenho_id: 1, material: 'x' }, 'uuid')
    ).rejects.toMatchObject({ statusCode: httpCode.NotFound })
  })
})
