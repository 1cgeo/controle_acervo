'use strict'

// O `confirm-upload` RECUSA a sessao VENCIDA, na hora do uso.
//
// POR QUE ISTO NAO E DETALHE. Nao ha agendador neste sistema (ver
// `docs/decisoes.md`, "Estrutura e convencoes"): a `acervo.cleanup_expired_uploads()`
// so roda quando um administrador aperta o botao da tela de Manutencao. Sem uma
// guarda na hora do uso, a sessao vencida continua `pending` por dias e o
// confirm a aceita como se o destino reservado ainda valesse. E o
// `destination_path` daquela reserva pode ter mudado de dono desde entao: o
// `renomear-padrao` so se recusa a mover byte ENQUANTO ha sessao aberta, e uma
// sessao vencida ja nao o segura.
//
// E a MESMA regra que o `confirmDownload` ao lado ja aplicava ("A EXPIRACAO VALE
// AQUI, na hora do uso, e nao so quando alguem limpa") e que o
// `ponto_controle/upload_ctrl.js` aplica na importacao de missao.
//
// Banco mockado de proposito: o pacote `rapido` roda sem PostgreSQL, e o que se
// prova aqui e a DECISAO do controlador, nao o SQL.

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

const arquivoDoRascunho = () => ({
  nome: 'Tileserver a',
  nome_arquivo: 'tile_a',
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

const sessao = (expirationTime) => ({
  id: 42,
  uuid_session: SESSAO,
  usuario_uuid: USUARIO,
  operation_type: 'add_files',
  status: 'pending',
  expiration_time: expirationTime,
  payload: { arquivos: [{ ...arquivoDoRascunho(), versao_id: 9001 }] }
})

/**
 * Liga a transacao falsa e devolve o que "o banco" recebeu.
 *
 * Guarda os INSERTs e os DELETEs porque o ponto do caso vencido e que NENHUM
 * dos dois aconteca: uma assercao so sobre a mensagem passaria com a sessao
 * gravando as linhas antes de estourar.
 */
function ligarTransacao (session) {
  const gravados = { arquivos: [], sessoesApagadas: [] }

  const t = {
    oneOrNone: async (sql) => {
      if (/FROM acervo\.upload_session/.test(sql)) return session
      throw new Error(`oneOrNone inesperado: ${sql}`)
    },
    any: async () => [],
    one: async (sql) => {
      if (/INSERT INTO acervo\.arquivo\(/.test(sql)) {
        const linha = { id: 300 + gravados.arquivos.length }
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

  mockDb.conn.tx.mockImplementation(cb => Promise.resolve().then(() => cb(t)))
  return gravados
}

const emHoras = (h) => new Date(Date.now() + h * 60 * 60 * 1000).toISOString()

beforeEach(() => {
  jest.clearAllMocks()
  mockMiniatura.gerarParaVersoes.mockResolvedValue(undefined)
  mockDb.conn.none.mockResolvedValue(undefined)
})

describe('confirm-upload / sessao vencida', () => {
  it('RECUSA a sessao cuja expiration_time ja passou', async () => {
    ligarTransacao(sessao(emHoras(-1)))

    await expect(arquivoCtrl.confirmUpload(SESSAO, USUARIO, {}))
      .rejects.toThrow(/expirada/i)
  })

  it('nao grava arquivo nem apaga a sessao quando ela venceu', async () => {
    const gravados = ligarTransacao(sessao(emHoras(-1)))

    await expect(arquivoCtrl.confirmUpload(SESSAO, USUARIO, {})).rejects.toThrow()

    expect(gravados.arquivos).toEqual([])
    expect(gravados.sessoesApagadas).toEqual([])
  })

  // O UPDATE de `failed` sai FORA da transacao (`db.conn.none`), porque a
  // excecao acima aborta a transacao e o rollback desfaria um UPDATE feito
  // dentro dela. Sem ele a sessao ficaria `pending` para sempre, e a proxima
  // tentativa tomaria o mesmo erro sem nada mudar na tela de uploads.
  it('marca a sessao como falha FORA da transacao', async () => {
    ligarTransacao(sessao(emHoras(-1)))

    await expect(arquivoCtrl.confirmUpload(SESSAO, USUARIO, {})).rejects.toThrow()

    const chamada = mockDb.conn.none.mock.calls.find(
      ([sql]) => /UPDATE acervo\.upload_session/.test(sql)
    )
    expect(chamada).toBeDefined()
    expect(chamada[0]).toMatch(/status = 'failed'/)
    expect(chamada[1][0]).toMatch(/expirada/i)
    expect(chamada[1][1]).toBe(42)
  })

  // O RASCUNHO VAI JUNTO, com cada arquivo marcado.
  //
  // A tela de "uploads com problema" existe para dizer QUAL arquivo falhou. O
  // `processingFailure` so escrevia `status` e `error_message` da SESSAO, entao
  // a sessao vencida aparecia la com a lista de arquivos VAZIA: todo arquivo
  // continuava `pending`, e quem abrisse a tela nao sabia o que estava sendo
  // enviado. E a mesma gravacao que o ramo do checksum divergente ja fazia.
  it('leva o payload com os arquivos marcados como falhos', async () => {
    ligarTransacao(sessao(emHoras(-1)))

    await expect(arquivoCtrl.confirmUpload(SESSAO, USUARIO, {})).rejects.toThrow()

    const chamada = mockDb.conn.none.mock.calls.find(
      ([sql]) => /UPDATE acervo\.upload_session/.test(sql)
    )
    expect(chamada[0]).toMatch(/payload = COALESCE/)

    const payload = chamada[1][2]
    expect(payload).toBeTruthy()
    expect(payload.arquivos[0].status).toBe('failed')
    expect(payload.arquivos[0].error_message).toMatch(/expirada/i)
  })

  // CONTROLE POSITIVO: sem ele o teste acima passaria com o confirm recusando
  // TODA sessao, vencida ou nao.
  it('a sessao dentro do prazo continua sendo confirmada', async () => {
    const gravados = ligarTransacao(sessao(emHoras(+1)))

    const res = await arquivoCtrl.confirmUpload(SESSAO, USUARIO, {})

    expect(res.status).toBe('completed')
    expect(gravados.arquivos).toHaveLength(1)
    expect(gravados.sessoesApagadas).toEqual([42])
  })
})
