'use strict'

// Teste unitario do controller de anexos. Mocka o banco (mockDb). Os bytes do
// arquivo ficam no proprio banco (coluna conteudo BYTEA), entao nao ha disco.
// Cobre: listagem normalizada, substituicao no single (NC/DFD) por DELETE+INSERT
// na transacao, dono inexistente (404), insert no multi (PDR) e exclusao.

const { createMockDb } = require('../../helpers/orcamento/mockDb')

const mockDb = createMockDb()
jest.mock('../../../database', () => ({
  db: mockDb,
  databaseVersion: { nome: '1.1.0', load: jest.fn() }
}))

const arquivoCtrl = require('../../../orcamento/arquivo/arquivo_ctrl')

const fileFake = (over = {}) => ({
  originalname: 'novo.pdf',
  buffer: Buffer.from('%PDF-1.4 conteudo'),
  mimetype: 'application/pdf',
  size: 17,
  ...over
})

beforeEach(() => {
  mockDb.reset()
})

describe('listarPorVinculo', () => {
  test('normaliza o vinculo (NC) com nulls nos ausentes', async () => {
    mockDb.conn.any.mockResolvedValueOnce([{ id: 1 }])
    const dados = await arquivoCtrl.listarPorVinculo({ nota_credito_id: 5 })
    expect(dados).toHaveLength(1)
    const [, params] = mockDb.conn.any.mock.calls[0]
    expect(params).toEqual({ notaCreditoId: 5, dfdId: null, pdrAno: null })
  })
})

describe('criar (single NC) substitui o anexo anterior', () => {
  test('apaga a linha antiga e insere a nova na transacao', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce({ '?column?': 1 }) // NC existe
    mockDb.conn.any.mockResolvedValueOnce([{ id: 99, nome_original: 'novo.pdf' }]) // lista final

    const dados = await arquivoCtrl.criar(
      fileFake(),
      { nota_credito_id: 3 },
      'user-uuid'
    )

    // roda na transacao: DELETE do antigo + INSERT do novo
    expect(mockDb.conn.tx).toHaveBeenCalledTimes(1)
    expect(mockDb.conn.none).toHaveBeenCalledTimes(2)
    // o INSERT recebe os bytes do arquivo em conteudo
    const [, meta] = mockDb.conn.none.mock.calls[1]
    expect(Buffer.isBuffer(meta.conteudo)).toBe(true)
    expect(meta.tamanhoBytes).toBe(meta.conteudo.length)
    expect(dados).toEqual([{ id: 99, nome_original: 'novo.pdf' }])
  })

  test('dono inexistente: lanca 404 sem inserir', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce(null) // NC nao existe

    await expect(
      arquivoCtrl.criar(fileFake(), { nota_credito_id: 999 }, 'user-uuid')
    ).rejects.toMatchObject({ statusCode: 404 })

    expect(mockDb.conn.none).not.toHaveBeenCalled()
    expect(mockDb.conn.tx).not.toHaveBeenCalled()
  })
})

describe('criar: nome com acento (UTF-8)', () => {
  test('refaz o originalname latin1 do multer para UTF-8', async () => {
    mockDb.conn.any.mockResolvedValueOnce([{ id: 1 }]) // lista final
    // Simula o que o multer entrega: bytes UTF-8 lidos como latin1.
    const originalLatin1 = Buffer.from('relatório.pdf', 'utf8').toString('latin1')

    await arquivoCtrl.criar(
      fileFake({ originalname: originalLatin1 }),
      { pdr_ano: 2026 },
      'user-uuid'
    )

    const [, meta] = mockDb.conn.none.mock.calls[0]
    expect(meta.nomeOriginal).toBe('relatório.pdf')
    expect(meta.extensao).toBe('pdf')
  })
})

describe('criar (multi PDR)', () => {
  test('nao checa dono e apenas insere', async () => {
    mockDb.conn.any.mockResolvedValueOnce([{ id: 1 }]) // lista final

    await arquivoCtrl.criar(
      fileFake({ originalname: 'pdr.xlsx', buffer: Buffer.from('planilha') }),
      { pdr_ano: 2026 },
      'user-uuid'
    )

    expect(mockDb.conn.oneOrNone).not.toHaveBeenCalled() // PDR nao tem dono
    expect(mockDb.conn.tx).not.toHaveBeenCalled() // multi nao substitui
    expect(mockDb.conn.none).toHaveBeenCalledTimes(1) // so o INSERT
    const [, meta] = mockDb.conn.none.mock.calls[0]
    expect(meta).toMatchObject({
      pdrAno: 2026,
      notaCreditoId: null,
      dfdId: null,
      nomeOriginal: 'pdr.xlsx',
      extensao: 'xlsx'
    })
    expect(meta.conteudo.toString()).toBe('planilha')
  })
})

describe('deletar', () => {
  test('remove a linha', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce({ id: 9 })

    await arquivoCtrl.deletar(9)

    expect(mockDb.conn.none).toHaveBeenCalledTimes(1)
  })

  test('inexistente vira 404', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce(null)
    await expect(arquivoCtrl.deletar(123)).rejects.toMatchObject({
      statusCode: 404
    })
    expect(mockDb.conn.none).not.toHaveBeenCalled()
  })
})
