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

// A FORMA do INSERT mudou: ele passou de `none` para `one`, com
// `RETURNING` das colunas de METADADO. Nao e `RETURNING *` de proposito -- isso
// devolveria o BYTEA recem-gravado so para joga-lo fora.
describe('criar (single NC) substitui o anexo anterior', () => {
  test('apaga a linha antiga e insere a nova na transacao', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce({ '?column?': 1 }) // NC existe
    mockDb.conn.any
      .mockResolvedValueOnce([]) // anexos anteriores, para o rastro da substituicao
      .mockResolvedValueOnce([{ id: 99, nome_original: 'novo.pdf' }]) // lista final
    mockDb.conn.one.mockResolvedValueOnce({ id: 99, nota_credito_id: 3 }) // INSERT

    const dados = await arquivoCtrl.criar(
      fileFake(),
      { nota_credito_id: 3 },
      'user-uuid'
    )

    // roda na transacao: DELETE do antigo + INSERT do novo
    expect(mockDb.conn.tx).toHaveBeenCalledTimes(1)
    expect(mockDb.conn.none).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM orcamento.arquivo'),
      expect.anything()
    )
    // o INSERT recebe os bytes do arquivo em conteudo
    const [, meta] = mockDb.conn.one.mock.calls[0]
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
    mockDb.conn.one.mockResolvedValueOnce({ id: 1, pdr_ano: 2026 }) // INSERT
    // Simula o que o multer entrega: bytes UTF-8 lidos como latin1.
    const originalLatin1 = Buffer.from('relatório.pdf', 'utf8').toString('latin1')

    await arquivoCtrl.criar(
      fileFake({ originalname: originalLatin1 }),
      { pdr_ano: 2026 },
      'user-uuid'
    )

    const [, meta] = mockDb.conn.one.mock.calls[0]
    expect(meta.nomeOriginal).toBe('relatório.pdf')
    expect(meta.extensao).toBe('pdf')
  })
})

describe('criar (multi PDR)', () => {
  test('nao checa dono e apenas insere, mas AGORA em transacao', async () => {
    mockDb.conn.any.mockResolvedValueOnce([{ id: 1 }]) // lista final
    mockDb.conn.one.mockResolvedValueOnce({ id: 1, pdr_ano: 2026 }) // INSERT

    await arquivoCtrl.criar(
      fileFake({ originalname: 'pdr.xlsx', buffer: Buffer.from('planilha') }),
      { pdr_ano: 2026 },
      'user-uuid'
    )

    expect(mockDb.conn.oneOrNone).not.toHaveBeenCalled() // PDR nao tem dono
    // O ramo do PDR tambem abre transacao: o rastro cai JUNTO com a escrita,
    // ou nao cai.
    expect(mockDb.conn.tx).toHaveBeenCalledTimes(1)
    // multi nao substitui: nenhum DELETE. (O `none` e chamado, sim, mas para
    // gravar o evento de auditoria.)
    const deletes = mockDb.conn.none.mock.calls
      .filter(([sql]) => String(sql).includes('DELETE FROM orcamento.arquivo'))
    expect(deletes).toHaveLength(0)
    const [, meta] = mockDb.conn.one.mock.calls[0]
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
  test('remove a linha, e o rastro sabe de que VINCULO ela era', async () => {
    // A linha inteira dos METADADOS: sem o vinculo, o evento de exclusao nao
    // teria dono e nao apareceria na ficha da NC.
    mockDb.conn.oneOrNone.mockResolvedValueOnce({
      id: 9, nota_credito_id: 3, nome_original: 'siafi.pdf'
    })

    await arquivoCtrl.deletar(9, 'uuid')

    expect(mockDb.conn.none).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM orcamento.arquivo'),
      expect.anything()
    )
    // E o rastro da exclusao foi gravado na MESMA transacao.
    expect(mockDb.conn.none).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO auditoria.evento'),
      expect.objectContaining({ operacao: 'D', entidadeId: '3' })
    )
  })

  test('inexistente vira 404', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce(null)
    await expect(arquivoCtrl.deletar(123, 'uuid')).rejects.toMatchObject({
      statusCode: 404
    })
    expect(mockDb.conn.none).not.toHaveBeenCalled()
  })
})
