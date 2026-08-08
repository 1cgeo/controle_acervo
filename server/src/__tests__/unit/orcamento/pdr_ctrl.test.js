'use strict'

// Teste unitario do controller de PDR (banco mockado).
// O PDR e o conjunto dos seus itens (amarrados no ano), nao ha mais cabeçalho:
// esta feature e um CRUD de ITENS. Cobre: listar por ano; getPorId (OK / 404);
// criar (INSERT RETURNING {id}); atualizar via result.rowCount (OK / 404);
// deletar com 404 (item inexistente), 409 (nota_credito vinculada) e caminho
// feliz (sem referencia).

const { createMockDb } = require('../../helpers/orcamento/mockDb')

const mockDb = createMockDb()
jest.mock('../../../database', () => ({
  db: mockDb,
  databaseVersion: { nome: '1.0.0', load: jest.fn() }
}))

const ctrl = require('../../../orcamento/pdr/pdr_ctrl')
const httpCode = require('../../../utils/http_code')

beforeEach(() => mockDb.reset())

describe('pdr_ctrl.listar', () => {
  test('lista os itens do ano informado', async () => {
    mockDb.conn.any.mockResolvedValueOnce([
      { id: 10, ano: 2026, cod_nd: '339015' },
      { id: 11, ano: 2026, cod_nd: '339030' }
    ])

    const itens = await ctrl.listar(2026)

    expect(itens).toHaveLength(2)
    expect(mockDb.conn.any).toHaveBeenCalledTimes(1)
    // o ano informado vai para o parametro $<ano> da query
    expect(mockDb.conn.any).toHaveBeenCalledWith(
      expect.stringContaining('orcamento.pdr_item'),
      { ano: 2026 }
    )
  })

  test('sem ano lista tudo (parametro vira null)', async () => {
    mockDb.conn.any.mockResolvedValueOnce([])
    await ctrl.listar(undefined)
    expect(mockDb.conn.any).toHaveBeenCalledWith(expect.any(String), { ano: null })
  })
})

describe('pdr_ctrl.getPorId', () => {
  test('devolve o item quando existe', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce({ id: 10, ano: 2026, cod_nd: '339015' })
    const item = await ctrl.getPorId(10)
    expect(item).toMatchObject({ id: 10, cod_nd: '339015' })
  })

  test('404 quando o item nao existe', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce(null)
    await expect(ctrl.getPorId(999)).rejects.toMatchObject({
      statusCode: httpCode.NotFound
    })
  })
})

describe('pdr_ctrl.criar', () => {
  test('caminho feliz: insere o item e devolve o id', async () => {
    mockDb.conn.one.mockResolvedValueOnce({ id: 77, ano: 2026 }) // INSERT RETURNING *

    const r = await ctrl.criar(
      { ano: 2026, cod_nd: '339015', valor_autorizado: 50000 },
      'uuid'
    )

    expect(r).toEqual({ id: 77 })
    expect(mockDb.conn.one).toHaveBeenCalledTimes(1)
    // os obrigatorios e o uuid do usuario chegam normalizados na query
    expect(mockDb.conn.one).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO orcamento.pdr_item'),
      expect.objectContaining({ ano: 2026, cod_nd: '339015', usuarioUuid: 'uuid' })
    )
  })

  test('opcionais omitidos sao normalizados para null', async () => {
    mockDb.conn.one.mockResolvedValueOnce({ id: 78, ano: 2026 })
    await ctrl.criar({ ano: 2026, cod_nd: '339015' }, 'uuid')
    expect(mockDb.conn.one).toHaveBeenCalledWith(
      expect.any(String),
      // SEM `gnd`: ele saiu da tabela na 1.43.0 e passou a vir da natureza de
      // despesa por JOIN, entao nao ha o que normalizar para null aqui.
      expect.objectContaining({ meta_pit_id: null, valor_autorizado: null })
    )
  })
})

// A FORMA destas duas mudou, com a rastreabilidade: o 404 saia do
// `rowCount` do proprio UPDATE, e o estado anterior era destruido sem nunca ser
// lido. Hoje `lerAntes` faz as DUAS coisas -- le a linha inteira (que vira o
// `dados_antes` do evento) e lanca o mesmo 404 -- e o UPDATE devolve
// `RETURNING *`. E o mesmo numero de idas ao banco de antes.
describe('pdr_ctrl.atualizar', () => {
  test('caminho feliz: le o estado anterior e devolve a linha nova', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce({ id: 10, ano: 2026, cod_nd: '339015' })
    mockDb.conn.one.mockResolvedValueOnce({ id: 10, ano: 2026, cod_nd: '449052' })

    await expect(
      ctrl.atualizar(10, { ano: 2026, cod_nd: '339015' }, 'uuid')
    ).resolves.toBeUndefined()

    // O SELECT do estado anterior nao e uma consulta A MAIS: ele substituiu o
    // `SELECT id` que so existia para produzir o 404.
    expect(mockDb.conn.oneOrNone).toHaveBeenCalledWith(
      expect.stringContaining('FROM orcamento.pdr_item'),
      { id: 10 }
    )
  })

  test('404 quando o item nao existe, e agora vem do lerAntes', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce(null)
    await expect(
      ctrl.atualizar(999, { ano: 2026, cod_nd: '339015' }, 'uuid')
    ).rejects.toMatchObject({ statusCode: httpCode.NotFound })
    // E o UPDATE nem chega a ser tentado.
    expect(mockDb.conn.one).not.toHaveBeenCalled()
  })
})

describe('pdr_ctrl.deletar', () => {
  test('404 quando o item nao existe', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce(null) // existencia -> null
    await expect(ctrl.deletar(999, 'uuid')).rejects.toMatchObject({
      statusCode: httpCode.NotFound
    })
    expect(mockDb.conn.none).not.toHaveBeenCalled()
  })

  test('409 quando ha nota_credito vinculada ao item', async () => {
    mockDb.conn.oneOrNone
      .mockResolvedValueOnce({ id: 1, ano: 2026 }) // item existe
      .mockResolvedValueOnce({ '?column?': 1 }) // SELECT 1 da NC vinculada

    await expect(ctrl.deletar(1, 'uuid')).rejects.toMatchObject({
      statusCode: httpCode.Conflict
    })
    expect(mockDb.conn.none).not.toHaveBeenCalled()
  })

  test('remove o item quando nao ha NC vinculada', async () => {
    mockDb.conn.oneOrNone
      // A linha INTEIRA: ela e o `dados_antes` do evento de exclusao, que e o
      // unico registro do que se perdeu.
      .mockResolvedValueOnce({ id: 1, ano: 2026, cod_nd: '339015' })
      .mockResolvedValueOnce(null) // sem NC vinculada
    mockDb.conn.none.mockResolvedValueOnce(undefined) // DELETE

    await ctrl.deletar(1, 'uuid')

    expect(mockDb.conn.tx).toHaveBeenCalledTimes(1)
    expect(mockDb.conn.none).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM orcamento.pdr_item'),
      { id: 1 }
    )
  })
})
