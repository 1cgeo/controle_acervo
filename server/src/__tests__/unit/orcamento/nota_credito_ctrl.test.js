'use strict'

// Teste unitario do controller de nota de credito (banco mockado).
// Cobre: caminho feliz do criar, a normalizacao de pdr_item_id por
// classificacao (regra de negocio central), filtros do listar e os
// dois bloqueios de exclusao (NE vinculada e NC complementada).

const { createMockDb } = require('../../helpers/orcamento/mockDb')

const mockDb = createMockDb()
jest.mock('../../../database', () => ({
  db: mockDb,
  databaseVersion: { nome: '1.0.0', load: jest.fn() }
}))

const ctrl = require('../../../orcamento/nota_credito/nota_credito_ctrl')
const httpCode = require('../../../utils/http_code')

beforeEach(() => mockDb.reset())

describe('nota_credito_ctrl.criar', () => {
  test('caminho feliz: insere e devolve o id', async () => {
    mockDb.conn.one.mockResolvedValueOnce({ id: 42 })

    const r = await ctrl.criar(
      {
        numero: 'NC-001',
        ano: 2026,
        cod_nd: '339030',
        valor_nc: 1000,
        classificacao_id: 1,
        pdr_item_id: 7
      },
      'uuid'
    )

    expect(r).toEqual({ id: 42 })
    expect(mockDb.conn.one).toHaveBeenCalledTimes(1)
    // classificacao = PDR (1) com pdr_item_id => grava o item
    const params = mockDb.conn.one.mock.calls[0][1]
    expect(params.pdrItemId).toBe(7)
    expect(params.usuarioUuid).toBe('uuid')
  })

  // O RECOLHIDO SAIU DA ESCRITA DA NC na 1.40.0: a coluna foi apagada e a
  // devolucao virou DOCUMENTO, em `orcamento.nota_credito_recolhimento`.
  //
  // Este caso prende as DUAS pontas, e sem a segunda ele passaria numa
  // implementacao que apenas parou de ler o campo do corpo e continuou mandando
  // a coluna no INSERT, o que quebraria no banco e nao aqui.
  test('a escrita da NC nao toca mais o recolhido: nem parametro, nem coluna', async () => {
    mockDb.conn.one.mockResolvedValueOnce({ id: 43 })

    await ctrl.criar(
      {
        numero: 'NC-001b',
        ano: 2026,
        cod_nd: '339030',
        valor_nc: 1000,
        classificacao_id: 2,
        // Mesmo que alguem insista em mandar o campo (cliente velho), ele nao
        // pode chegar ao SQL. Quem o recusa antes e o schema, com 400.
        valor_recolhido: 150
      },
      'uuid'
    )

    const [sql, params] = mockDb.conn.one.mock.calls[0]
    expect(params.valorRecolhido).toBeUndefined()
    expect(String(sql)).not.toContain('valor_recolhido')
  })

  test('regra: classificacao Extra-PDR (2) forca pdrItemId a null mesmo se enviado', async () => {
    mockDb.conn.one.mockResolvedValueOnce({ id: 5 })

    await ctrl.criar(
      {
        numero: 'NC-002',
        ano: 2026,
        cod_nd: '339030',
        valor_nc: 500,
        classificacao_id: 2,
        // o ctrl ignora pdr_item_id quando classificacao != 1
        pdr_item_id: 99
      },
      'uuid'
    )

    const params = mockDb.conn.one.mock.calls[0][1]
    expect(params.pdrItemId).toBeNull()
  })

  test('regra: classificacao PDR (1) sem pdr_item_id grava null', async () => {
    mockDb.conn.one.mockResolvedValueOnce({ id: 6 })

    await ctrl.criar(
      {
        numero: 'NC-003',
        ano: 2026,
        cod_nd: '339030',
        valor_nc: 500,
        classificacao_id: 1
      },
      'uuid'
    )

    const params = mockDb.conn.one.mock.calls[0][1]
    expect(params.pdrItemId).toBeNull()
  })
})

describe('nota_credito_ctrl.listar', () => {
  test('repassa os filtros ano e classificacao_id para a query', async () => {
    mockDb.conn.any.mockResolvedValueOnce([{ id: 1 }])

    const r = await ctrl.listar({ ano: 2026, classificacao_id: 2 })

    expect(r).toHaveLength(1)
    const [, params] = mockDb.conn.any.mock.calls[0]
    expect(params).toEqual({ ano: 2026, classificacaoId: 2 })
  })

  test('sem filtros usa null (lista geral)', async () => {
    mockDb.conn.any.mockResolvedValueOnce([])

    await ctrl.listar()

    const [, params] = mockDb.conn.any.mock.calls[0]
    expect(params).toEqual({ ano: null, classificacaoId: null })
  })

  // O CAMPO CONTINUA SAINDO COM O MESMO NOME, e a FONTE e que mudou: a tela, o
  // CLI e o RPCMTec leem `valor_recolhido`, e trocar o nome quebraria os tres de
  // uma vez. Este caso prende as duas metades da promessa.
  test('o recolhido sai como SOMA da tabela de recolhimento, e nao de coluna', async () => {
    mockDb.conn.any.mockResolvedValueOnce([])

    await ctrl.listar({ ano: 2026 })

    const sql = String(mockDb.conn.any.mock.calls[0][0])
    expect(sql).toContain('AS valor_recolhido')
    expect(sql).toContain('orcamento.nota_credito_recolhimento')
    // E o SALDO usa a mesma soma, senao a lista mostraria um recolhido e
    // descontaria outro.
    expect(sql).toContain('AS saldo')
    expect(sql).not.toContain('nc.valor_recolhido')
  })
})

describe('nota_credito_ctrl.deletar', () => {
  test('404 quando a NC nao existe', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce(null) // SELECT id

    await expect(ctrl.deletar(1)).rejects.toMatchObject({
      statusCode: httpCode.NotFound
    })
    expect(mockDb.conn.none).not.toHaveBeenCalled()
  })

  test('409 quando ha nota de empenho referenciando a NC', async () => {
    mockDb.conn.oneOrNone
      .mockResolvedValueOnce({ id: 1 }) // existe
      .mockResolvedValueOnce({ '?column?': 1 }) // tem NE vinculada

    await expect(ctrl.deletar(1)).rejects.toMatchObject({
      statusCode: httpCode.Conflict
    })
    expect(mockDb.conn.none).not.toHaveBeenCalled()
  })

  test('409 quando outra NC a referencia como complementada', async () => {
    mockDb.conn.oneOrNone
      .mockResolvedValueOnce({ id: 1 }) // existe
      .mockResolvedValueOnce(null) // sem NE vinculada
      .mockResolvedValueOnce({ '?column?': 1 }) // complementada por outra NC

    await expect(ctrl.deletar(1)).rejects.toMatchObject({
      statusCode: httpCode.Conflict
    })
    expect(mockDb.conn.none).not.toHaveBeenCalled()
  })

  test('remove quando nao ha dependentes', async () => {
    mockDb.conn.oneOrNone
      .mockResolvedValueOnce({ id: 1 }) // existe
      .mockResolvedValueOnce(null) // sem NE
      .mockResolvedValueOnce(null) // sem complementacao
    mockDb.conn.none.mockResolvedValueOnce(undefined)

    await ctrl.deletar(1)

    expect(mockDb.conn.none).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM orcamento.nota_credito'),
      { id: 1 }
    )
  })
})

describe('nota_credito_ctrl.getPorId', () => {
  test('404 quando nao encontra', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce(null)
    await expect(ctrl.getPorId(1)).rejects.toMatchObject({
      statusCode: httpCode.NotFound
    })
  })
})
