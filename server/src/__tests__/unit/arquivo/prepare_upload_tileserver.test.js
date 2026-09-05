'use strict'

// O TILESERVER PASSA PELO `prepare-upload`, e passa nas TRES rotas.
//
// O QUE ISTO GUARDA. O `nome_arquivo` do Tileserver e uma URL
// (`https://host/serv/x`), e nao um caminho dentro do volume: ele nem tem
// volume, por CHECK de `acervo.arquivo`. O `motivoCaminhoInseguro`, que protege
// contra travessia (`..`) no nome que vem do cliente, le o `//` da URL como um
// SEGMENTO VAZIO e recusa -- corretamente, porque para ele aquilo e um caminho
// relativo. Por isso a guarda so vale FORA do Tileserver, e o `prepareAddFiles`
// ja a chamava assim.
//
// O `prepararVersao` e o `prepararProduto` a chamavam SEM a condicao, entao toda
// sessao com um Tileserver morria com 400 dizendo que o caminho "sairia da raiz
// do volume" -- e o proprio schema aponta o prepare-upload como a porta do
// Tileserver ("cadastre-o pelo prepare-upload", em `arquivoWebCampos` e em
// `arquivoCatalogoCampos`). Nenhuma outra rota o aceita.
//
// Banco mockado: o pacote `rapido` roda sem PostgreSQL, e o que se prova aqui e
// a DECISAO do controlador antes de qualquer byte, nao o SQL.

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

jest.mock('../../../utils/miniatura_varredura', () => ({
  gerarParaVersoes: jest.fn().mockResolvedValue(undefined)
}))

jest.mock('../../../utils/serialize_error_loader', () => ({
  serialize: error => ({ message: error.message, stack: error.stack }),
  ready: Promise.resolve()
}))

const arquivoCtrl = require('../../../arquivo/arquivo_ctrl')

const USUARIO = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const SESSAO = '33333333-4444-5555-6666-777777777777'
const TILESERVER = 9

const URL_DO_SERVICO = 'https://servico.exemplo/tiles/carta/{z}/{x}/{y}.png'

const arquivoTileserver = () => ({
  nome: 'Serviço de tiles',
  nome_arquivo: URL_DO_SERVICO,
  tipo_arquivo_id: TILESERVER,
  extensao: null,
  tamanho_mb: null,
  checksum: null,
  metadado: {},
  situacao_carregamento_id: 1,
  descricao: '',
  crs_original: null
})

const versaoBase = () => ({
  uuid_versao: null,
  versao: '1-DSG',
  nome: null,
  tipo_versao_id: 1,
  subtipo_produto_id: 2,
  lote_id: null,
  metadado: {},
  descricao: '',
  orgao_produtor: '1º CGEO',
  palavras_chave: [],
  data_criacao: '2026-07-01',
  data_edicao: '2026-08-01'
})

/**
 * Transacao falsa que responde por PADRAO do SQL, e guarda o payload da sessao.
 *
 * O payload e o que interessa: e dele que o confirm le o `destination_path`, e
 * no Tileserver ele tem de ser a URL crua, sem raiz de volume na frente.
 */
function ligarTransacao () {
  const gravado = { payload: null }

  const t = {
    any: async (sql) => {
      if (/FROM acervo\.versao v\s+JOIN acervo\.produto/.test(sql)) {
        return [{ id: 55, produto_id: 7, tipo_produto_id: 2 }]
      }
      if (/FROM acervo\.produto WHERE id IN/.test(sql)) {
        return [{ id: 7, tipo_produto_id: 2 }]
      }
      if (/FROM acervo\.volume_tipo_produto/.test(sql)) {
        return [{
          tipo_produto_id: 2,
          volume_armazenamento_id: 3,
          volume: '/volumes/acervo',
          capacidade_gb: 1000
        }]
      }
      throw new Error(`any inesperado: ${sql}`)
    },
    oneOrNone: async () => null,
    one: async (sql, params) => {
      if (/espaco_disponivel/.test(sql)) return { espaco_disponivel: 900 }
      if (/INSERT INTO acervo\.upload_session/.test(sql)) {
        // `[usuarioUuid, operation_type, payload]`: o terceiro e o rascunho que
        // vai para `acervo.upload_session.payload`.
        gravado.payload = params[2]
        return { uuid_session: SESSAO }
      }
      throw new Error(`one inesperado: ${sql}`)
    },
    none: async () => undefined
  }

  mockDb.conn.tx.mockImplementation(cb => Promise.resolve().then(() => cb(t)))

  return gravado
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('prepare-upload com Tileserver', () => {
  it('prepare-upload/version aceita o Tileserver e guarda a URL como destino', async () => {
    const gravado = ligarTransacao()

    const dados = await arquivoCtrl.prepareAddVersion({
      versoes: [{
        produto_id: 7,
        versao: versaoBase(),
        arquivos: [arquivoTileserver()]
      }]
    }, USUARIO)

    expect(dados.session_uuid).toBe(SESSAO)
    expect(dados.versoes[0].arquivos[0].destination_path).toBe(URL_DO_SERVICO)
    // O RETORNO e o PAYLOAD saem de caminhos diferentes do controlador
    // (`arquivosInfo` contra `arquivoDoRascunho`), e quem o confirm le e o
    // payload: por isso os dois sao cobrados.
    expect(gravado.payload.versoes[0].arquivos[0].destination_path)
      .toBe(URL_DO_SERVICO)
  })

  it('prepare-upload/product aceita o Tileserver e guarda a URL como destino', async () => {
    const gravado = ligarTransacao()

    const dados = await arquivoCtrl.prepareAddProduct({
      produtos: [{
        produto: {
          nome: 'Folha',
          mi: null,
          inom: null,
          tipo_escala_id: 1,
          denominador_escala_especial: null,
          tipo_produto_id: 2,
          subtipo_produto_id: null,
          descricao: '',
          geom: 'SRID=4674;POLYGON((-51 -23, -50 -23, -50 -22, -51 -22, -51 -23))'
        },
        versoes: [{ ...versaoBase(), arquivos: [arquivoTileserver()] }]
      }]
    }, USUARIO)

    expect(dados.session_uuid).toBe(SESSAO)
    expect(dados.produtos[0].versoes[0].arquivos[0].destination_path).toBe(URL_DO_SERVICO)
    expect(gravado.payload.produtos[0].versoes[0].arquivos[0].destination_path)
      .toBe(URL_DO_SERVICO)
  })

  // CONTROLE NEGATIVO: a guarda de travessia continua valendo para o arquivo de
  // verdade. Sem este caso, remover a chamada inteira faria os dois acima
  // passarem.
  it('continua recusando travessia no nome do arquivo comum', async () => {
    ligarTransacao()

    await expect(arquivoCtrl.prepareAddVersion({
      versoes: [{
        produto_id: 7,
        versao: versaoBase(),
        arquivos: [{
          ...arquivoTileserver(),
          tipo_arquivo_id: 1,
          nome_arquivo: '../../../etc/passwd',
          extensao: 'tif',
          tamanho_mb: 1,
          checksum: 'a'.repeat(64)
        }]
      }]
    }, USUARIO)).rejects.toThrow(/raiz do volume/i)
  })
})
