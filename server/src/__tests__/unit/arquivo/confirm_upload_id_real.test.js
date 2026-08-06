'use strict'

// O `confirm-upload` DEVOLVE O ID DE `acervo.versao`, NUNCA UM ID DE RASCUNHO.
//
// CONTROLE NEGATIVO. Ate 2026-08-05 os caminhos `add_version` e `add_product`
// respondiam com `upload_versao_temp.id` no campo `versao_id`, e com
// `produto_temp_id`/`versao_temp_id` no lugar dos ids do acervo. As duas
// sequencias eram independentes, entao o numero errado passava por id de acervo
// sem parecer errado: quem gravasse a resposta guardava um ponteiro para outra
// versao, ou para nenhuma.
//
// Desde 06/08/2026 o rascunho e um JSONB em `acervo.upload_session.payload`, e
// nao ha mais id de rascunho a vazar. O teste continua valendo, e o cenario
// abaixo ainda prova o que interessa: os ids da RESPOSTA sao os que os INSERTs
// devolveram, e nao a posicao do item no rascunho. As posicoes aqui (0, 1) sao
// diferentes dos ids reais (9001, 9002, 500), e a assercao cobra o real. Sem
// essa diferenca a comparacao seria satisfeita pelos dois codigos.
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
 * duas vezes. Guarda tambem se a sessao foi APAGADA, que e o outro contrato do
 * confirm.
 */
function fazerTransacao (estado) {
  const gravados = { produtos: [], versoes: [], arquivos: [], sessoesApagadas: [] }
  let proximoProduto = 500
  let proximaVersao = 9001
  let proximoArquivo = 300

  const t = {
    oneOrNone: async (sql) => {
      if (/FROM acervo\.upload_session/.test(sql)) return estado.session
      throw new Error(`oneOrNone inesperado: ${sql}`)
    },
    any: async () => [],
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
    none: async (sql, params) => {
      if (/DELETE FROM acervo\.upload_session/.test(sql)) {
        gravados.sessoesApagadas.push(params[0])
      }
      return undefined
    }
  }

  return { t, gravados }
}

function ligarTransacao (estado) {
  const { t, gravados } = fazerTransacao(estado)
  mockDb.conn.tx.mockImplementation(cb => Promise.resolve().then(() => cb(t)))
  return gravados
}

const arquivoDoRascunho = (marca) => ({
  nome: `Tileserver ${marca}`,
  nome_arquivo: `tile_${marca}`,
  tipo_arquivo_id: TILESERVER,
  status: 'pending',
  error_message: null,
  destination_path: null,
  expected_checksum: null,
  metadado: {},
  situacao_carregamento_id: 1,
  descricao: '',
  crs_original: null,
  volume_armazenamento_id: null,
  extensao: null,
  tamanho_mb: null
})

const versaoDoRascunho = (marca, extra = {}) => ({
  uuid_versao: `uuid-da-versao-${marca}`,
  versao: `1-DSG-${marca}`,
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
  meta_pit_id: null,
  data_prevista: null,
  arquivos: [arquivoDoRascunho(marca)],
  ...extra
})

const produtoDoRascunho = (nome, mi, inom, versoes) => ({
  nome,
  mi,
  inom,
  tipo_escala_id: 1,
  denominador_escala_especial: null,
  tipo_produto_id: 2,
  subtipo_produto_id: null,
  descricao: '',
  geom: 'SRID=4674;POLYGON((-50 -15, -49 -15, -49 -14, -50 -14, -50 -15))',
  versoes
})

beforeEach(() => {
  jest.clearAllMocks()
  mockMiniatura.gerarParaVersoes.mockResolvedValue(undefined)
})

describe('confirm-upload / add_version: o versao_id e o de acervo.versao', () => {
  // DUAS versoes, para a correspondencia ser testavel: com uma so, qualquer id
  // certo casaria com qualquer outro id certo.
  const estado = () => ({
    session: {
      id: 12,
      uuid_session: SESSAO,
      usuario_uuid: USUARIO,
      operation_type: 'add_version',
      status: 'pending',
      payload: {
        versoes: [
          versaoDoRascunho('a', { produto_id: 8100 }),
          versaoDoRascunho('b', { produto_id: 8100 })
        ]
      }
    }
  })

  it('devolve o id REAL da versao, e nunca a posicao no rascunho', async () => {
    const gravados = ligarTransacao(estado())

    const res = await arquivoCtrl.confirmUpload(SESSAO, USUARIO, {})

    expect(res.status).toBe('completed')
    expect(res.versoes).toHaveLength(2)

    // A prova: os ids da resposta sao os que o INSERT em acervo.versao devolveu.
    expect(res.versoes.map(v => v.versao_id)).toEqual(gravados.versoes)
    expect(gravados.versoes).toEqual([9001, 9002])

    // E o controle negativo explicito: nem a posicao no rascunho, nem os ids
    // temporarios que o codigo antigo respondia.
    for (const v of res.versoes) {
      expect([0, 1, 70, 71]).not.toContain(v.versao_id)
    }
  })

  it('o produto_id continua sendo o de acervo.produto', async () => {
    ligarTransacao(estado())

    const res = await arquivoCtrl.confirmUpload(SESSAO, USUARIO, {})

    expect(res.versoes.map(v => v.produto_id)).toEqual([8100, 8100])
  })

  it('cada versao leva os arquivos da SUA linha do rascunho', async () => {
    ligarTransacao(estado())

    const res = await arquivoCtrl.confirmUpload(SESSAO, USUARIO, {})

    expect(res.versoes[0].files.map(f => f.nome_arquivo)).toEqual(['tile_a'])
    expect(res.versoes[1].files.map(f => f.nome_arquivo)).toEqual(['tile_b'])
  })

  it('a miniatura dispara com o id REAL da versao', async () => {
    ligarTransacao(estado())

    await arquivoCtrl.confirmUpload(SESSAO, USUARIO, {})

    expect(mockMiniatura.gerarParaVersoes).toHaveBeenCalledWith([9001, 9002])
  })

  // A sessao morre no confirm. Sem esta assercao o teste passaria com a sessao
  // ficando na tabela, que e o desenho que produziu 2.555 linhas mortas.
  it('apaga a sessao na mesma transacao', async () => {
    const gravados = ligarTransacao(estado())

    await arquivoCtrl.confirmUpload(SESSAO, USUARIO, {})

    expect(gravados.sessoesApagadas).toEqual([12])
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
      status: 'pending',
      payload: {
        produtos: [
          produtoDoRascunho('Ortoimagem A', '2965-2', 'SH-22-Y-A-I-2', [
            versaoDoRascunho('a'),
            versaoDoRascunho('b')
          ]),
          produtoDoRascunho('Ortoimagem B', '2965-3', 'SH-22-Y-A-I-3', [
            versaoDoRascunho('c')
          ])
        ]
      }
    }
  })

  it('devolve produto_id e versao_id do acervo, e nao a posicao no rascunho', async () => {
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

  it('o corpo NAO carrega nenhum campo interno do rascunho', async () => {
    ligarTransacao(estado())

    const res = await arquivoCtrl.confirmUpload(SESSAO, USUARIO, {})
    const corpo = JSON.stringify(res)

    // O codigo antigo respondia `produto_temp_id` e `versao_temp_id`. Sao ids de
    // linha que o cliente NUNCA viu: o `prepare-upload` nao os devolve. O
    // `produto_indice` e o sucessor deles, e existe so para agrupar aqui dentro.
    expect(corpo).not.toContain('produto_temp_id')
    expect(corpo).not.toContain('versao_temp_id')
    expect(corpo).not.toContain('produto_indice')
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

  it('apaga a sessao na mesma transacao', async () => {
    const gravados = ligarTransacao(estado())

    await arquivoCtrl.confirmUpload(SESSAO, USUARIO, {})

    expect(gravados.sessoesApagadas).toEqual([13])
  })
})
