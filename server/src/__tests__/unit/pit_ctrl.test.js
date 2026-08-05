'use strict'

// Teste unitario do controller de Meta do PIT (banco mockado).
// Cobre: listar (com e sem filtro de ano), criar (NAO valida exercicio: vai
// direto ao INSERT na tx), atualizar (404 se nao existe) e deletar (409 quando
// ha consumidor vinculado; 404 se inexistente).
//
// O controller saiu de src/orcamento/meta/ para src/pit/: o PIT
// virou dado de plataforma. O terceiro consumidor, mapoteca.pedido, entrou na
// mesma data, e por isso o COUNT do deletar soma tres tabelas.

const { createMockDb } = require('../helpers/orcamento/mockDb')

const mockDb = createMockDb()
jest.mock('../../database', () => ({
  db: mockDb,
  databaseVersion: { nome: '1.0.0', load: jest.fn() }
}))

const ctrl = require('../../pit/pit_ctrl')
const httpCode = require('../../utils/http_code')

describe('pit_ctrl', () => {
  beforeEach(() => mockDb.reset())

  test('listar com ano passa o filtro', async () => {
    mockDb.conn.any.mockResolvedValueOnce([{ id: 1 }, { id: 2 }])
    const r = await ctrl.listar(2026)
    expect(r).toHaveLength(2)
    expect(mockDb.conn.any).toHaveBeenCalledWith(
      expect.stringContaining('WHERE ano = $<ano>'),
      { ano: 2026 }
    )
  })

  test('listar sem ano traz todas (sem filtro)', async () => {
    mockDb.conn.any.mockResolvedValueOnce([])
    await ctrl.listar()
    // A chamada sem filtro usa apenas a query (sem objeto de parametros de ano).
    expect(mockDb.conn.any).toHaveBeenCalledWith(
      expect.stringContaining('FROM pit.meta_vigente')
    )
  })

  // O exercício VIGENTE e a revisão ABERTA, que toda escrita de meta consulta
  // antes de gravar. O dublê responde as duas leituras, nessa ordem.
  const comRevisaoAberta = () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce({ situacao_id: 2 })
    mockDb.conn.oneOrNone.mockResolvedValueOnce({ id: 7, codigo: 'R1' })
  }

  test('criar insere a IDENTIDADE e declara a meta na revisao aberta', async () => {
    comRevisaoAberta()
    mockDb.conn.one.mockResolvedValueOnce({ id: 9 })
    mockDb.conn.one.mockResolvedValueOnce({ id: 3, meta_id: 9 })

    const r = await ctrl.criar(
      { ano: 2026, numero_meta: 1, item: '1.1', descricao: 'Meta 1' },
      'uuid-1'
    )

    expect(r).toEqual({ id: 9 })
    expect(mockDb.conn.tx).toHaveBeenCalledTimes(1)
    // A identidade: sem descricao, sem quantidade, sem prazo.
    expect(mockDb.conn.one).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO pit.meta'),
      expect.objectContaining({ ano: 2026, numero_meta: 1, usuarioUuid: 'uuid-1' })
    )
    // A declaracao, na revisao que a autoriza.
    expect(mockDb.conn.one).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO pit.meta_revisao'),
      expect.objectContaining({ revisaoId: 7, descricao: 'Meta 1' })
    )
  })

  test('criar sem revisao aberta recusa, e nao grava nada', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce({ situacao_id: 2 })
    mockDb.conn.oneOrNone.mockResolvedValueOnce(null)

    await expect(ctrl.criar(
      { ano: 2026, numero_meta: 1, item: '1.1', descricao: 'Meta 1' },
      'uuid-1'
    )).rejects.toThrow(/revis/i)

    expect(mockDb.conn.one).not.toHaveBeenCalled()
  })

  test('atualizar atualiza a meta existente', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce({ id: 5 }) // meta existe
    mockDb.conn.oneOrNone.mockResolvedValueOnce({ situacao_id: 2 }) // exercicio
    mockDb.conn.one.mockResolvedValueOnce({ id: 5 }) // UPDATE RETURNING id
    mockDb.conn.oneOrNone.mockResolvedValueOnce({ // a declaracao vigente, igual
      descricao: 'Nova', quantidade_prevista: null, prazo: null,
      demandante: null, cancelada: false
    })

    const r = await ctrl.atualizar(
      5,
      { ano: 2026, numero_meta: 2, item: '2.1', descricao: 'Nova' },
      'uuid'
    )

    expect(r).toEqual({ id: 5 })
    expect(mockDb.conn.one).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE pit.meta'),
      expect.objectContaining({ id: 5, numero_meta: 2 })
    )
  })

  test('atualizar com meta inexistente vira 404', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce(null)
    await expect(
      ctrl.atualizar(99, { ano: 2026, numero_meta: 1 }, 'uuid')
    ).rejects.toMatchObject({ statusCode: httpCode.NotFound })
    expect(mockDb.conn.one).not.toHaveBeenCalled()
  })

  test('deletar bloqueia com 409 quando ha pdr_item/nota_credito vinculados', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce({ id: 1 }) // meta existe
    mockDb.conn.one.mockResolvedValueOnce({ n: 2 }) // COUNT dependentes > 0
    await expect(ctrl.deletar(1)).rejects.toMatchObject({
      statusCode: httpCode.Conflict
    })
    expect(mockDb.conn.none).not.toHaveBeenCalled()
  })

  test('deletar remove quando nao ha vinculados (n:0)', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce({ id: 1 }) // meta existe
    mockDb.conn.one.mockResolvedValueOnce({ n: 0 }) // sem dependentes
    mockDb.conn.none.mockResolvedValueOnce(undefined)
    await ctrl.deletar(1)
    expect(mockDb.conn.none).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM pit.meta'),
      { id: 1 }
    )
  })

  test('deletar com meta inexistente vira 404', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce(null)
    await expect(ctrl.deletar(99)).rejects.toMatchObject({
      statusCode: httpCode.NotFound
    })
  })
})
