'use strict'

// Teste unitario das duas exportacoes em ZIP do acervo (banco mockado):
//   - getSituacaoGeralJSON: um .geojson por escala, para o site de produtos
//   - getPlanilhaCSV:       um .csv por escala e tipo, no formato da planilha ASC
//
// Por que este arquivo existe: as duas rotas dependem do pacote `archiver`, e
// sem teste nesse caminho subir a versao maior dele e ato de fe.
//
// O teste NAO confia no tipo do retorno. Ele abre o ZIP na mao (fim do diretorio
// central, entradas, cabecalho local) e DESCOMPRIME cada arquivo, conferindo que
// os bytes voltam iguais ao que entrou. Buffer com assinatura PK certa e conteudo
// corrompido passaria num teste de tipo e reprova neste.

const zlib = require('zlib')

const mockDb = {
  conn: {
    any: jest.fn(),
    task: jest.fn(),
    one: jest.fn(),
    oneOrNone: jest.fn(),
    none: jest.fn()
  }
}

jest.mock('../../database', () => ({
  db: mockDb,
  databaseVersion: { nome: '1.0.0', load: jest.fn() }
}))

jest.mock('../../utils/serialize_error_loader', () => ({
  serialize: error => ({ message: error.message, stack: error.stack }),
  ready: Promise.resolve()
}))

const acervoCtrl = require('../../acervo/acervo_ctrl')

// --- leitor de ZIP sem dependencia ------------------------------------------
// Le o diretorio central, que e a fonte autoritativa de nome e tamanho. O
// cabecalho local pode trazer tamanho zero quando o escritor usa data
// descriptor, e o archiver usa: por isso os tamanhos saem daqui.
function lerZip (buf) {
  const EOCD_SIG = 0x06054b50
  let eocd = -1
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('ZIP invalido: fim do diretorio central nao encontrado')

  const total = buf.readUInt16LE(eocd + 10)
  let ponteiro = buf.readUInt32LE(eocd + 16)
  const entradas = []

  for (let n = 0; n < total; n++) {
    if (buf.readUInt32LE(ponteiro) !== 0x02014b50) {
      throw new Error(`ZIP invalido: entrada ${n} sem assinatura de diretorio central`)
    }
    const metodo = buf.readUInt16LE(ponteiro + 10)
    const tamComprimido = buf.readUInt32LE(ponteiro + 20)
    const tamOriginal = buf.readUInt32LE(ponteiro + 24)
    const tamNome = buf.readUInt16LE(ponteiro + 28)
    const tamExtra = buf.readUInt16LE(ponteiro + 30)
    const tamComentario = buf.readUInt16LE(ponteiro + 32)
    const offsetLocal = buf.readUInt32LE(ponteiro + 42)
    const nome = buf.toString('utf8', ponteiro + 46, ponteiro + 46 + tamNome)

    if (buf.readUInt32LE(offsetLocal) !== 0x04034b50) {
      throw new Error(`ZIP invalido: cabecalho local de ${nome} sem assinatura`)
    }
    const nomeLocal = buf.readUInt16LE(offsetLocal + 26)
    const extraLocal = buf.readUInt16LE(offsetLocal + 28)
    const inicio = offsetLocal + 30 + nomeLocal + extraLocal
    const bruto = buf.subarray(inicio, inicio + tamComprimido)
    const conteudo = metodo === 8 ? zlib.inflateRawSync(bruto) : Buffer.from(bruto)

    if (conteudo.length !== tamOriginal) {
      throw new Error(`ZIP corrompido: ${nome} descomprimiu ${conteudo.length} bytes, esperava ${tamOriginal}`)
    }
    entradas.push({ nome, conteudo: conteudo.toString('utf8') })
    ponteiro += 46 + tamNome + tamExtra + tamComentario
  }
  return entradas
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('getSituacaoGeralJSON (ZIP de GeoJSON)', () => {
  const celulas = [
    { type: 'Feature', properties: { identificadorMI: '2962-4-NE' }, geometry: null }
  ]

  beforeEach(() => {
    jest.spyOn(acervoCtrl, 'getSituacaoGeralCells').mockResolvedValue(celulas)
  })

  afterEach(() => {
    acervoCtrl.getSituacaoGeralCells.mockRestore()
  })

  test('sem escala escolhida, exporta as quatro', async () => {
    const zip = await acervoCtrl.getSituacaoGeralJSON({})
    const entradas = lerZip(zip)

    expect(entradas.map(e => e.nome).sort()).toEqual([
      'situacao-geral-ct-100k.geojson',
      'situacao-geral-ct-250k.geojson',
      'situacao-geral-ct-25k.geojson',
      'situacao-geral-ct-50k.geojson'
    ])
  })

  test('escala escolhida entra sozinha, e o JSON de dentro e valido', async () => {
    const zip = await acervoCtrl.getSituacaoGeralJSON({ '50k': true })
    const entradas = lerZip(zip)

    expect(entradas).toHaveLength(1)
    expect(entradas[0].nome).toBe('situacao-geral-ct-50k.geojson')

    // O conteudo tem que voltar como JSON parseavel, nao so como bytes.
    const geojson = JSON.parse(entradas[0].conteudo)
    expect(geojson.type).toBe('FeatureCollection')
    expect(geojson.name).toBe('situacao-geral-ct-50k')
    expect(geojson.features).toEqual(celulas)
  })

  test('erro do banco rejeita a promessa em vez de devolver ZIP vazio', async () => {
    acervoCtrl.getSituacaoGeralCells.mockRejectedValue(new Error('banco fora'))
    await expect(acervoCtrl.getSituacaoGeralJSON({ '25k': true })).rejects.toThrow('banco fora')
  })
})

describe('getPlanilhaCSV (ZIP de CSV)', () => {
  test('uma aba por escala e tipo, com BOM e cabecalho', async () => {
    mockDb.conn.any.mockResolvedValue([])
    const zip = await acervoCtrl.getPlanilhaCSV({ '250k': true })
    const entradas = lerZip(zip)

    // Uma escala, dois tipos de produto. O nome carrega o sufixo de escala
    // ('250k'), e nao o rotulo da aba da planilha ('T250') que o comentario do
    // controller promete. Divergencia real, anotada aqui em vez de mascarada.
    expect(entradas.map(e => e.nome).sort()).toEqual(['O250k.csv', 'T250k.csv'])
    for (const e of entradas) {
      expect(e.conteudo.charCodeAt(0)).toBe(0xfeff) // BOM, para o Excel abrir certo
      expect(e.conteudo).toContain('Cont_Edicao,MI,INOM')
    }
  })

  test('linha de dado sai escapada no padrao CSV', async () => {
    mockDb.conn.any.mockResolvedValue([
      {
        cont_edicao: '4', mi: '2962-4-NE', inom: 'SF-22-Y-D-VI-1-NE',
        tipo_produto: 'C. Topo', subtipo: 'T34-700',
        nome: 'CERRO DA GLORIA, RS', // a virgula obriga o campo a sair entre aspas
        orgao_produtor: '1o CGEO', epsg: '4674', ano_dados: 2015,
        ano_edicao: 2017, versao: '4a Edicao', lote: '2017_SAICA_25K', tem_arquivo: 2
      }
    ])
    const entradas = lerZip(await acervoCtrl.getPlanilhaCSV({ '25k': true }))
    const t25 = entradas.find(e => e.nome === 'T25k.csv')

    expect(t25.conteudo).toContain('"CERRO DA GLORIA, RS"')
    expect(t25.conteudo).toContain('2962-4-NE')
    expect(t25.conteudo.split('\r\n')).toHaveLength(2) // cabecalho + 1 linha
  })

  test('erro do banco rejeita a promessa', async () => {
    mockDb.conn.any.mockRejectedValue(new Error('timeout no banco'))
    await expect(acervoCtrl.getPlanilhaCSV({ '25k': true })).rejects.toThrow('timeout no banco')
  })
})
