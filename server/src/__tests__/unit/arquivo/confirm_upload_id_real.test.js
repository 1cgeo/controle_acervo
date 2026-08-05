'use strict'

// O `confirm-upload` DEVOLVE O ID DE `acervo.versao`, NUNCA O DA TABELA TEMPORARIA.
//
// CONTROLE NEGATIVO. Ate 2026-08-05 os caminhos `add_version` e `add_product`
// respondiam com `upload_versao_temp.id` no campo `versao_id`, e com
// `produto_temp_id`/`versao_temp_id` no lugar dos ids do acervo. As duas
// sequencias sao independentes, entao o numero errado passa por id de acervo
// sem parecer errado: quem gravasse a resposta guardava um ponteiro para outra
// versao, ou para nenhuma. As linhas `*_temp` ainda somem quando o cron fecha a
// sessao, e ai nao sobra nem de onde reconstruir.
//
// Este teste falha com o codigo antigo: os ids temporarios aqui (70, 71, 40) sao
// DIFERENTES dos reais (9001, 9002, 500), e a assercao cobra o real. Sem essa
// diferenca a comparacao seria satisfeita pelos dois codigos e nao provaria nada.
//
// Banco mockado de proposito: o pacote `rapido` roda sem PostgreSQL, e o que se
// prova aqui e a MONTAGEM da resposta, nao o SQL.

const mockDb = {
  conn: {
    tx: jest.fn(),
    any: jest.fn(),
    one: jest.fn(),
    oneOrNone: jest.fn(),
    none: jest.fn()
  }
}

jest.mock('../../../database', () => ({
  db: mockDb,
  databaseVersion: { nome: '1.0.0', load: jest.fn() }
}))

jest.mock('../../../auditoria', () => ({
  auditoriaCtrl: {
    registrar: jest.fn().mockResolvedValue(undefined),
    lerDepois: jest.fn().mockResolvedValue({})
  }
}))

const mockMiniatura = { gerarParaVersoes: jest.fn().mockResolvedValue(undefined) }
jest.mock('../../../utils/miniatura_varredura', () => mockMiniatura)

jest.mock('../../../utils/serialize_error_loader', () => ({
  serialize: error => ({ message: error.message, stack: error.stack }),
  ready: Promise.resolve()
}))

const arquivoCtrl = require('../../../arquivo/arquivo_ctrl')

const SESSAO = '11111111-2222-3333-4444-555555555555'
const USUARIO = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

// Tileserver (9) e URL, nao byte: o confirm o marca como valido sem tocar no
// disco. E o unico tipo que deixa este teste rodar sem volume nenhum.
const TILESERVER = 9

/**
 * Uma transacao falsa que responde por PADRAO do SQL.
 *
 * Guarda os ids que "o banco" devolveu em cada INSERT, para o teste comparar a
 * resposta contra o que foi de fato gravado, e nao contra um numero digitado
 * duas vezes.
 */
function fazerTransacao (estado) {
  const gravados = { produtos: [], versoes: [], arquivos: [] }
  let proximoProduto = 500
  let proximaVersao = 9001
  let proximoArquivo = 300

  const t = {
    oneOrNone: async (sql) => {
      if (/FROM acervo\.upload_session/.test(sql)) return estado.session
      throw new Error(`oneOrNone inesperado: ${sql}`)
    },
    any: async (sql, params) => {
      if (/FROM acervo\.upload_arquivo_temp/.test(sql)) {
        if (/versao_temp_id = \$2/.test(sql)) {
          return estado.arquivos.filter(a => a.versao_temp_id === params[1])
        }
        return estado.arquivos
      }
      if (/FROM acervo\.upload_versao_temp/.test(sql)) {
        if (/produto_temp_id = \$2/.test(sql)) {
          return estado.versoesTemp.filter(v => v.produto_temp_id === params[1])
        }
        if (/produto_id IS NOT NULL/.test(sql)) {
          return estado.versoesTemp.filter(v => v.produto_id != null)
        }
        return estado.versoesTemp
      }
      if (/FROM acervo\.upload_produto_temp/.test(sql)) return estado.produtosTemp
      throw new Error(`any inesperado: ${sql}`)
    },
    one: async (sql) => {
      if (/INSERT INTO acervo\.produto\(/.test(sql)) {
        const linha = { id: proximoProduto++ }
        gravados.produtos.push(linha.id)
        return linha
      }
      if (/INSERT INTO acervo\.versao\(/.test(sql)) {
        const linha = { id: proximaVersao++ }
        gravados.versoes.push(linha.id)
        return linha
      }
      if (/INSERT INTO acervo\.arquivo\(/.test(sql)) {
        const linha = { id: proximoArquivo++ }
        gravados.arquivos.push(linha.id)
        return linha
      }
      throw new Error(`one inesperado: ${sql}`)
    },
    none: async () => undefined
  }

  return { t, gravados }
}

function ligarTransacao (estado) {
  const { t, gravados } = fazerTransacao(estado)
  mockDb.conn.tx.mockImplementation(cb => Promise.resolve().then(() => cb(t)))
  return gravados
}

const arquivoTemp = (id, versaoTempId) => ({
  id,
  versao_id: null,
  versao_temp_id: versaoTempId,
  nome: `Tileserver ${id}`,
  nome_arquivo: `tile_${id}`,
  tipo_arquivo_id: TILESERVER,
  status: 'pending',
  destination_path: null,
  expected_checksum: null,
  metadado: {},
  situacao_carregamento_id: 1,
  descricao: '',
  crs_original: null,
  volume_armazenamento_id: null,
  tamanho_mb: null
})

const versaoTemp = (id, extra) => ({
  id,
  uuid_versao: `uuid-da-versao-${id}`,
  versao: `1-DSG-${id}`,
  nome: null,
  tipo_versao_id: 1,
  subtipo_produto_id: 24,
  lote_id: null,
  metadado: {},
  descricao: '',
  orgao_produtor: 'DSG',
  palavras_chave: [],
  data_criacao: '2026-01-10',
  data_edicao: '2026-02-10',
  produto_id: null,
  produto_temp_id: null,
  ...extra
})

beforeEach(() => {
  jest.clearAllMocks()
  mockMiniatura.gerarParaVersoes.mockResolvedValue(undefined)
})

describe('confirm-upload / add_version: o versao_id e o de acervo.versao', () => {
  // DUAS versoes, com ids temporarios (70, 71) diferentes dos reais (9001,
  // 9002). Uma so nao provaria a correspondencia, porque qualquer id certo
  // casaria com qualquer outro id certo.
  const estado = () => ({
    session: {
      id: 12,
      uuid_session: SESSAO,
      usuario_uuid: USUARIO,
      operation_type: 'add_version',
      status: 'pending'
    },
    versoesTemp: [
      versaoTemp(70, { produto_id: 8100 }),
      versaoTemp(71, { produto_id: 8100 })
    ],
    produtosTemp: [],
    arquivos: [arquivoTemp(1, 70), arquivoTemp(2, 71)]
  })

  it('devolve o id REAL da versao, e nunca o da upload_versao_temp', async () => {
    const gravados = ligarTransacao(estado())

    const res = await arquivoCtrl.confirmUpload(SESSAO, USUARIO, {})

    expect(res.status).toBe('completed')
    expect(res.versoes).toHaveLength(2)

    // A prova: os ids da resposta sao os que o INSERT em acervo.versao devolveu.
    expect(res.versoes.map(v => v.versao_id)).toEqual(gravados.versoes)
    expect(gravados.versoes).toEqual([9001, 9002])

    // E o controle negativo explicito: o codigo antigo respondia 70 e 71.
    expect(res.versoes.map(v => v.versao_id)).not.toEqual([70, 71])
    for (const v of res.versoes) {
      expect([70, 71]).not.toContain(v.versao_id)
    }
  })

  it('o produto_id continua sendo o de acervo.produto', async () => {
    ligarTransacao(estado())

    const res = await arquivoCtrl.confirmUpload(SESSAO, USUARIO, {})

    expect(res.versoes.map(v => v.produto_id)).toEqual([8100, 8100])
  })

  it('cada versao leva os arquivos da SUA linha temporaria', async () => {
    ligarTransacao(estado())

    const res = await arquivoCtrl.confirmUpload(SESSAO, USUARIO, {})

    expect(res.versoes[0].files.map(f => f.nome_arquivo)).toEqual(['tile_1'])
    expect(res.versoes[1].files.map(f => f.nome_arquivo)).toEqual(['tile_2'])
  })

  it('a miniatura dispara com o id REAL da versao', async () => {
    ligarTransacao(estado())

    await arquivoCtrl.confirmUpload(SESSAO, USUARIO, {})

    expect(mockMiniatura.gerarParaVersoes).toHaveBeenCalledWith([9001, 9002])
  })
})

describe('confirm-upload / add_product: os ids sao os do acervo', () => {
  // Dois produtos, para que o agrupamento por produto seja testavel: com um so,
  // qualquer agrupamento acertaria.
  const estado = () => ({
    session: {
      id: 13,
      uuid_session: SESSAO,
      usuario_uuid: USUARIO,
      operation_type: 'add_product',
      status: 'pending'
    },
    versoesTemp: [
      versaoTemp(70, { produto_temp_id: 40 }),
      versaoTemp(71, { produto_temp_id: 40 }),
      versaoTemp(72, { produto_temp_id: 41 })
    ],
    produtosTemp: [
      { id: 40, nome: 'Ortoimagem A', mi: '2965-2', inom: 'SH-22-Y-A-I-2', tipo_escala_id: 1, denominador_escala_especial: null, tipo_produto_id: 2, subtipo_produto_id: null, descricao: '', geom: 'SRID=4674;POLYGON((-50 -15, -49 -15, -49 -14, -50 -14, -50 -15))' },
      { id: 41, nome: 'Ortoimagem B', mi: '2965-3', inom: 'SH-22-Y-A-I-3', tipo_escala_id: 1, denominador_escala_especial: null, tipo_produto_id: 2, subtipo_produto_id: null, descricao: '', geom: 'SRID=4674;POLYGON((-50 -15, -49 -15, -49 -14, -50 -14, -50 -15))' }
    ],
    arquivos: [arquivoTemp(1, 70), arquivoTemp(2, 71), arquivoTemp(3, 72)]
  })

  it('devolve produto_id e versao_id do acervo, e nao os ids temporarios', async () => {
    const gravados = ligarTransacao(estado())

    const res = await arquivoCtrl.confirmUpload(SESSAO, USUARIO, {})

    expect(res.status).toBe('completed')
    expect(res.produtos).toHaveLength(2)

    expect(res.produtos.map(p => p.produto_id)).toEqual(gravados.produtos)
    expect(gravados.produtos).toEqual([500, 501])

    const versoesRespondidas = res.produtos.flatMap(p => p.versoes.map(v => v.versao_id))
    expect(versoesRespondidas).toEqual(gravados.versoes)
    expect(gravados.versoes).toEqual([9001, 9002, 9003])
  })

  it('o corpo NAO carrega mais nenhum campo de id temporario', async () => {
    ligarTransacao(estado())

    const res = await arquivoCtrl.confirmUpload(SESSAO, USUARIO, {})
    const corpo = JSON.stringify(res)

    // O codigo antigo respondia `produto_temp_id` e `versao_temp_id`. Sao ids de
    // linha que o cliente NUNCA viu: o `prepare-upload` nao os devolve.
    expect(corpo).not.toContain('produto_temp_id')
    expect(corpo).not.toContain('versao_temp_id')
  })

  it('agrupa as versoes no produto certo', async () => {
    ligarTransacao(estado())

    const res = await arquivoCtrl.confirmUpload(SESSAO, USUARIO, {})

    expect(res.produtos[0].versoes.map(v => v.versao_id)).toEqual([9001, 9002])
    expect(res.produtos[1].versoes.map(v => v.versao_id)).toEqual([9003])
  })

  it('a miniatura dispara com os ids REAIS das tres versoes', async () => {
    ligarTransacao(estado())

    await arquivoCtrl.confirmUpload(SESSAO, USUARIO, {})

    expect(mockMiniatura.gerarParaVersoes).toHaveBeenCalledWith([9001, 9002, 9003])
  })
})
