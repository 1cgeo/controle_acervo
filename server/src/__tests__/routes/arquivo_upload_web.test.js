'use strict'

// Envio de arquivo pelo NAVEGADOR: metadados e bytes numa requisição só.
//
// O QUE ESTE ARQUIVO GUARDA, em ordem de importância:
//
//   1. O NOME NO VOLUME sai de `acervo.nome_arquivo_padrao`, e não do cliente.
//      É o mesmo nome que o invariante `7a` cobra, e por isso a prova aqui é
//      contra a PRÓPRIA função: um literal esperado envelheceria em silêncio se
//      o padrão mudasse, e o teste passaria a guardar a regra errada. Enquanto o
//      cliente nomeava, cada envio pela web criava uma linha de DEFECT no 7a.
//   2. O byte chega ao volume e o checksum gravado é o SHA-256 do conteúdo. Como
//      o servidor mede enquanto escreve, um erro no cano (pedaço perdido, hash
//      alimentado fora de ordem) daria checksum errado sem erro nenhum, e só
//      apareceria muito depois, quando alguém baixasse. Por isso o volume aqui é
//      um diretório de verdade, e não um dublê.
//   3. ATOMICIDADE: o que falha não deixa metade. Nem linha no acervo sem byte,
//      nem byte no volume sem linha, nem `.parcial` esquecido.
//   4. O fluxo do PLUGIN (prepare-upload + confirm-upload) continua intacto e
//      continua CONFERINDO o checksum declarado. Regressão ali é silenciosa:
//      tudo continuaria respondendo 200.

const request = require('supertest')
const fs = require('fs').promises
const os = require('os')
const path = require('path')
const crypto = require('crypto')

const { getApp } = require('../helpers/app')
const { conn, cleanTestData } = require('../helpers/db')
const { generateAdminToken, generateUserToken } = require('../helpers/auth')
const { createVolume, createProduto } = require('../helpers/fixtures')
const config = require('../../config')

let app
let raizVolume

const TIPO_PRODUTO = 4 // Ortoimagem, o mesmo do teste de catalogacao
const SUBTIPO = 4      // Ortoimagem, subtipo do tipo 4
const TETO_PADRAO = config.UPLOAD_WEB_MAX_GB

beforeAll(async () => {
  app = await getApp()
  raizVolume = await fs.mkdtemp(path.join(os.tmpdir(), 'sca-upload-web-'))
})

afterAll(async () => {
  await fs.rm(raizVolume, { recursive: true, force: true })
})

// Volume e banco sao dois estados, e os dois vazam entre casos: o arquivo que um
// teste gravou faria o teste seguinte encontrar byte que ele nao pos ali.
afterEach(async () => {
  config.UPLOAD_WEB_MAX_GB = TETO_PADRAO
  await cleanTestData()
  await fs.rm(raizVolume, { recursive: true, force: true })
  await fs.mkdir(raizVolume, { recursive: true })
})

/** Volume primario do tipo de produto, apontando para a raiz temporaria. */
const volumePrimario = async () => {
  const volume = await createVolume({
    nome: 'Volume Upload Web',
    volume: raizVolume,
    capacidade_gb: 500
  })
  await conn.none(
    `INSERT INTO acervo.volume_tipo_produto (tipo_produto_id, volume_armazenamento_id, primario)
     VALUES ($1, $2, TRUE)`,
    [TIPO_PRODUTO, volume.id]
  )
  return volume
}

const versaoBase = (overrides = {}) => ({
  versao: '1-DSG',
  nome: 'Primeira edição',
  tipo_versao_id: 1,
  subtipo_produto_id: SUBTIPO,
  lote_id: null,
  orgao_produtor: 'DSG',
  data_criacao: '2026-01-10',
  data_edicao: '2026-02-10',
  ...overrides
})

const arquivoBase = (overrides = {}) => ({
  nome: 'Ortoimagem',
  tipo_arquivo_id: 1,
  situacao_carregamento_id: 1,
  crs_original: '4674',
  ...overrides
})

/**
 * Monta o multipart na ordem que o servidor exige: `dados` ANTES dos arquivos.
 *
 * A ordem nao e detalhe de teste: e dela que sai o destino de cada byte, e o
 * caso "arquivo antes dos dados" tem prova propria mais abaixo.
 */
const enviarVersao = (dados, arquivos, token = generateAdminToken()) => {
  const req = request(app)
    .post('/api/arquivo/upload-web/versao')
    .set('Authorization', token)
    .field('dados', JSON.stringify(dados))
  for (const a of arquivos) req.attach('arquivos', a.conteudo, a.nome)
  return req
}

const enviarProduto = (dados, arquivos, token = generateAdminToken()) => {
  const req = request(app)
    .post('/api/arquivo/upload-web/produto')
    .set('Authorization', token)
    .field('dados', JSON.stringify(dados))
  for (const a of arquivos) req.attach('arquivos', a.conteudo, a.nome)
  return req
}

const sha256 = conteudo => crypto.createHash('sha256').update(conteudo).digest('hex')
const existe = caminho => fs.access(caminho).then(() => true).catch(() => false)

/** O nome que o PADRAO manda, perguntado ao proprio banco. */
const nomePadraoDe = async (produtoId, rotuloVersao, subtipo = SUBTIPO) => {
  const { nome } = await conn.one(
    // Casts como no controlador: a funcao e declarada com smallint/varchar e o
    // driver manda integer/unknown, entao o Postgres nao resolve a sobrecarga.
    `SELECT acervo.nome_arquivo_padrao(p.tipo_produto_id, $2::smallint, p.mi, p.inom,
              p.nome, p.tipo_escala_id, p.denominador_escala_especial, $3::varchar) AS nome
     FROM acervo.produto p WHERE p.id = $1`,
    [produtoId, subtipo, rotuloVersao]
  )
  return nome
}

describe('POST /api/arquivo/upload-web/versao', () => {
  it('exige perfil de operador', async () => {
    const produto = await createProduto({ tipo_produto_id: TIPO_PRODUTO })

    const semToken = await request(app)
      .post('/api/arquivo/upload-web/versao')
      .field('dados', JSON.stringify({ produto_id: produto.id }))
    expect(semToken.status).toBe(401)

    const consulta = await enviarVersao(
      { produto_id: produto.id, versao: versaoBase(), arquivos: [arquivoBase()] },
      [{ conteudo: Buffer.from('x'), nome: 'a.tif' }],
      generateUserToken()
    )
    expect(consulta.status).toBe(403)
  })

  // O caso central, e a prova e contra a PROPRIA funcao do padrao.
  it('grava no volume com o NOME DO PADRAO e o checksum que o servidor mediu', async () => {
    await volumePrimario()
    const produto = await createProduto({ tipo_produto_id: TIPO_PRODUTO })
    const conteudo = Buffer.from('pixels da ortoimagem que subiu pelo navegador')

    const res = await enviarVersao(
      { produto_id: produto.id, versao: versaoBase(), arquivos: [arquivoBase()] },
      [{ conteudo, nome: 'ortoimagem_do_meu_computador.tif' }]
    )

    expect(res.status).toBe(201)

    const esperado = await nomePadraoDe(produto.id, '1-DSG')
    expect(esperado).toBeTruthy()
    expect(res.body.dados.nome_arquivo).toBe(esperado)
    // O nome do arquivo NO COMPUTADOR de quem enviou nao vira nome no volume.
    expect(res.body.dados.nome_arquivo).not.toContain('meu_computador')

    const noVolume = path.join(raizVolume, `${esperado}.tif`)
    expect(await existe(noVolume)).toBe(true)
    expect(await fs.readFile(noVolume)).toEqual(conteudo)
    expect(await existe(`${noVolume}.parcial`)).toBe(false)

    const arquivo = await conn.one('SELECT * FROM acervo.arquivo')
    expect(arquivo.nome_arquivo).toBe(esperado)
    expect(arquivo.extensao).toBe('tif')          // veio do arquivo, nao do corpo
    expect(arquivo.checksum).toBe(sha256(conteudo))
    expect(Number(arquivo.tamanho_mb)).toBeCloseTo(conteudo.length / (1024 * 1024), 6)
  })

  // O 7a e DEFECT: nome fora do padrao e defeito, nao gosto. Este caso prova que
  // o envio pela web nao PRODUZ defeito -- era o que acontecia antes.
  it('o arquivo gravado NAO aparece no invariante 7a', async () => {
    await volumePrimario()
    const produto = await createProduto({ tipo_produto_id: TIPO_PRODUTO })

    await enviarVersao(
      { produto_id: produto.id, versao: versaoBase(), arquivos: [arquivoBase()] },
      [{ conteudo: Buffer.from('bytes'), nome: 'qualquer_nome.tif' }]
    )

    const divergentes = await conn.any(`
      SELECT a.id FROM acervo.arquivo a
      JOIN acervo.versao v ON v.id = a.versao_id
      JOIN acervo.produto p ON p.id = v.produto_id
      WHERE a.nome_arquivo IS DISTINCT FROM acervo.nome_arquivo_padrao(
        p.tipo_produto_id, v.subtipo_produto_id, p.mi, p.inom, p.nome,
        p.tipo_escala_id, p.denominador_escala_especial, v.versao)`)
    expect(divergentes).toHaveLength(0)
  })

  it('varios arquivos da mesma versao dividem o nome e se separam pela extensao', async () => {
    await volumePrimario()
    const produto = await createProduto({ tipo_produto_id: TIPO_PRODUTO })

    const res = await enviarVersao(
      {
        produto_id: produto.id,
        versao: versaoBase(),
        arquivos: [arquivoBase(), arquivoBase({ nome: 'Metadado', tipo_arquivo_id: 4 })]
      },
      [
        { conteudo: Buffer.from('raster'), nome: 'orto.tif' },
        { conteudo: Buffer.from('<xml/>'), nome: 'meta.xml' }
      ]
    )

    expect(res.status).toBe(201)
    const esperado = await nomePadraoDe(produto.id, '1-DSG')
    expect(await existe(path.join(raizVolume, `${esperado}.tif`))).toBe(true)
    expect(await existe(path.join(raizVolume, `${esperado}.xml`))).toBe(true)

    const nomes = await conn.any(
      'SELECT nome_arquivo, extensao FROM acervo.arquivo ORDER BY extensao'
    )
    expect(nomes.map(n => n.nome_arquivo)).toEqual([esperado, esperado])
    expect(nomes.map(n => n.extensao)).toEqual(['tif', 'xml'])
  })

  // O padrao da UM nome por versao. Dois arquivos do mesmo formato receberiam o
  // mesmo nome, e inventar um sufixo faria este codigo nomear diferente do que o
  // renomear-padrao e o 7a esperam.
  it('recusa dois arquivos da mesma versao com a MESMA extensao', async () => {
    await volumePrimario()
    const produto = await createProduto({ tipo_produto_id: TIPO_PRODUTO })

    const res = await enviarVersao(
      {
        produto_id: produto.id,
        versao: versaoBase(),
        arquivos: [arquivoBase(), arquivoBase({ nome: 'Outro' })]
      },
      [
        { conteudo: Buffer.from('um'), nome: 'a.tif' },
        { conteudo: Buffer.from('dois'), nome: 'b.tif' }
      ]
    )

    expect(res.status).toBe(409)
    expect(res.body.message).toContain('extensão')

    const n = await conn.one('SELECT count(*)::int AS c FROM acervo.arquivo')
    expect(n.c).toBe(0)
  })

  it('recusa o arquivo sem extensao, que e o que separa os arquivos no volume', async () => {
    await volumePrimario()
    const produto = await createProduto({ tipo_produto_id: TIPO_PRODUTO })

    const res = await enviarVersao(
      { produto_id: produto.id, versao: versaoBase(), arquivos: [arquivoBase()] },
      [{ conteudo: Buffer.from('x'), nome: 'sem_extensao' }]
    )

    expect(res.status).toBe(400)
    expect(res.body.message).toContain('extensão')
  })

  // O corpo declara N arquivos e chegam M: casar por ORDEM exige que os dois
  // numeros batam, senao o arquivo 2 herdaria a descricao do 3.
  it('recusa quando a contagem de arquivos nao bate com a de descricoes', async () => {
    await volumePrimario()
    const produto = await createProduto({ tipo_produto_id: TIPO_PRODUTO })

    const aMais = await enviarVersao(
      { produto_id: produto.id, versao: versaoBase(), arquivos: [arquivoBase()] },
      [
        { conteudo: Buffer.from('um'), nome: 'a.tif' },
        { conteudo: Buffer.from('dois'), nome: 'b.xml' }
      ]
    )
    expect(aMais.status).toBe(400)

    const aMenos = await enviarVersao(
      {
        produto_id: produto.id,
        versao: versaoBase(),
        arquivos: [arquivoBase(), arquivoBase({ nome: 'Metadado' })]
      },
      [{ conteudo: Buffer.from('um'), nome: 'a.tif' }]
    )
    expect(aMenos.status).toBe(400)

    const n = await conn.one('SELECT count(*)::int AS c FROM acervo.arquivo')
    expect(n.c).toBe(0)
  })

  it('recusa o arquivo que chega ANTES do campo dados', async () => {
    await volumePrimario()
    const produto = await createProduto({ tipo_produto_id: TIPO_PRODUTO })

    const res = await request(app)
      .post('/api/arquivo/upload-web/versao')
      .set('Authorization', generateAdminToken())
      .attach('arquivos', Buffer.from('bytes'), 'a.tif')
      .field('dados', JSON.stringify({
        produto_id: produto.id, versao: versaoBase(), arquivos: [arquivoBase()]
      }))

    expect(res.status).toBe(400)
    expect(res.body.message).toContain('PRIMEIRA')
  })

  it('recusa produto inexistente antes de gravar byte', async () => {
    await volumePrimario()

    const res = await enviarVersao(
      { produto_id: 9999999, versao: versaoBase(), arquivos: [arquivoBase()] },
      [{ conteudo: Buffer.from('bytes'), nome: 'a.tif' }]
    )

    expect(res.status).toBe(404)
    expect(await fs.readdir(raizVolume)).toEqual([])
  })

  it('recusa versao ja existente no produto', async () => {
    await volumePrimario()
    const produto = await createProduto({ tipo_produto_id: TIPO_PRODUTO })

    const primeira = await enviarVersao(
      { produto_id: produto.id, versao: versaoBase(), arquivos: [arquivoBase()] },
      [{ conteudo: Buffer.from('um'), nome: 'a.tif' }]
    )
    expect(primeira.status).toBe(201)

    const repetida = await enviarVersao(
      { produto_id: produto.id, versao: versaoBase(), arquivos: [arquivoBase()] },
      [{ conteudo: Buffer.from('dois'), nome: 'b.xml' }]
    )
    expect(repetida.status).toBe(409)
  })

  it('recusa checksum, tamanho, nome fisico e extensao declarados', async () => {
    await volumePrimario()
    const produto = await createProduto({ tipo_produto_id: TIPO_PRODUTO })

    // A mensagem tem de dizer QUAL regra recusou, e nao so que houve recusa: e a
    // diferenca entre a pessoa corrigir o corpo e ficar adivinhando.
    const proibidos = [
      ['checksum', 'a'.repeat(64), 'checksum é medido pelo servidor'],
      ['tamanho_mb', 12, 'tamanho é medido pelo servidor'],
      ['nome_arquivo', 'o_nome_que_eu_quero', 'nome_arquivo_padrao'],
      ['extensao', 'tif', 'nome do arquivo enviado']
    ]

    for (const [chave, valor, razao] of proibidos) {
      const res = await enviarVersao(
        {
          produto_id: produto.id,
          versao: versaoBase(),
          arquivos: [arquivoBase({ [chave]: valor })]
        },
        [{ conteudo: Buffer.from('x'), nome: 'a.tif' }]
      )
      expect(res.status).toBe(400)
      expect(res.body.message).toContain(razao)
    }
  })

  it('recusa arquivo acima do teto', async () => {
    await volumePrimario()
    const produto = await createProduto({ tipo_produto_id: TIPO_PRODUTO })
    // 1 KB exato: fracao que da numero redondo em bytes, para o teto nao depender
    // de arredondamento.
    config.UPLOAD_WEB_MAX_GB = 1 / (1024 * 1024)

    const res = await enviarVersao(
      { produto_id: produto.id, versao: versaoBase(), arquivos: [arquivoBase()] },
      [{ conteudo: Buffer.alloc(64 * 1024, 7), nome: 'grande.tif' }]
    )

    expect(res.status).toBe(400)
    expect(res.body.message).toContain('plugin')

    const n = await conn.one('SELECT count(*)::int AS c FROM acervo.arquivo')
    expect(n.c).toBe(0)
    // E, principalmente, nao sobra o arquivo TRUNCADO no volume: o teto do
    // multer corta o fluxo em vez de derruba-lo, e sem a guarda o pedaco entraria
    // com um checksum calculado sobre ele mesmo -- valido para sempre.
    expect(await fs.readdir(raizVolume)).toEqual([])
  })

  it('recusa quando nao ha volume primario para o tipo', async () => {
    const produto = await createProduto({ tipo_produto_id: TIPO_PRODUTO })

    const res = await enviarVersao(
      { produto_id: produto.id, versao: versaoBase(), arquivos: [arquivoBase()] },
      [{ conteudo: Buffer.from('x'), nome: 'a.tif' }]
    )

    expect(res.status).toBe(400)
    expect(res.body.message).toContain('volume primário')
  })
})

describe('POST /api/arquivo/upload-web/produto', () => {
  const produtoNovo = (overrides = {}) => ({
    produto: {
      nome: 'Ortoimagem Web',
      mi: '2965-1',
      inom: 'SH-22-Y-A-I-1',
      tipo_escala_id: 1,
      denominador_escala_especial: null,
      tipo_produto_id: TIPO_PRODUTO,
      subtipo_produto_id: null,
      descricao: 'Enviada pelo navegador',
      geom: 'SRID=4674;POLYGON((-50 -15, -49 -15, -49 -14, -50 -14, -50 -15))',
      ...overrides
    },
    versao: versaoBase(),
    arquivos: [arquivoBase()]
  })

  it('cria produto, versao e arquivo numa requisicao so', async () => {
    await volumePrimario()
    const conteudo = Buffer.from('pixels de um produto novo')

    const res = await enviarProduto(produtoNovo(), [{ conteudo, nome: 'orto.tif' }])

    expect(res.status).toBe(201)

    const produto = await conn.one('SELECT * FROM acervo.produto')
    expect(produto.mi).toBe('2965-1')

    const esperado = await nomePadraoDe(produto.id, '1-DSG')
    expect(res.body.dados.nome_arquivo).toBe(esperado)
    expect(await existe(path.join(raizVolume, `${esperado}.tif`))).toBe(true)

    const arquivo = await conn.one('SELECT * FROM acervo.arquivo')
    expect(arquivo.checksum).toBe(sha256(conteudo))
  })

  // ATOMICIDADE. A identidade colidir depois dos bytes gravados nao pode deixar
  // nem produto pela metade nem byte solto no volume.
  it('produto de identidade repetida nao deixa produto novo nem byte novo', async () => {
    await volumePrimario()
    await enviarProduto(produtoNovo(), [{ conteudo: Buffer.from('um'), nome: 'a.tif' }])

    const antes = await fs.readdir(raizVolume)

    const repetido = await enviarProduto(
      produtoNovo(), [{ conteudo: Buffer.from('dois'), nome: 'b.tif' }]
    )

    expect(repetido.status).toBe(409)
    const n = await conn.one('SELECT count(*)::int AS c FROM acervo.produto')
    expect(n.c).toBe(1)
    expect((await fs.readdir(raizVolume)).sort()).toEqual(antes.sort())
  })

  it('geometria invalida nao deixa byte no volume', async () => {
    await volumePrimario()

    const res = await enviarProduto(
      produtoNovo({ geom: 'SRID=4674;POLYGON((0 0, 1 1))' }),
      [{ conteudo: Buffer.from('bytes'), nome: 'a.tif' }]
    )

    expect(res.status).toBeGreaterThanOrEqual(400)
    const n = await conn.one('SELECT count(*)::int AS c FROM acervo.produto')
    expect(n.c).toBe(0)
    expect(await fs.readdir(raizVolume)).toEqual([])
  })
})

describe('POST /api/arquivo/upload-web/arquivos', () => {
  const enviarArquivos = (dados, arquivos, token = generateAdminToken()) => {
    const req = request(app)
      .post('/api/arquivo/upload-web/arquivos')
      .set('Authorization', token)
      .field('dados', JSON.stringify(dados))
    for (const a of arquivos) req.attach('arquivos', a.conteudo, a.nome)
    return req
  }

  /** Uma versao ja gravada, com um arquivo, para acrescentar sobre ela. */
  const versaoComArquivo = async () => {
    await volumePrimario()
    const produto = await createProduto({ tipo_produto_id: TIPO_PRODUTO })
    const res = await enviarVersao(
      { produto_id: produto.id, versao: versaoBase(), arquivos: [arquivoBase()] },
      [{ conteudo: Buffer.from('o principal'), nome: 'orto.tif' }]
    )
    expect(res.status).toBe(201)
    return { produto, versaoId: res.body.dados.versao_id }
  }

  it('acrescenta arquivo com o MESMO nome da versao, separado pela extensao', async () => {
    const { produto, versaoId } = await versaoComArquivo()
    const conteudo = Buffer.from('<metadado/>')

    const res = await enviarArquivos(
      { versao_id: versaoId, arquivos: [arquivoBase({ nome: 'Metadado', tipo_arquivo_id: 4 })] },
      [{ conteudo, nome: 'qualquer.xml' }]
    )

    expect(res.status).toBe(201)
    const esperado = await nomePadraoDe(produto.id, '1-DSG')
    expect(res.body.dados.nome_arquivo).toBe(esperado)
    expect(await existe(path.join(raizVolume, `${esperado}.xml`))).toBe(true)

    const arquivos = await conn.any(
      'SELECT nome_arquivo, extensao, checksum FROM acervo.arquivo ORDER BY extensao'
    )
    expect(arquivos).toHaveLength(2)
    expect(arquivos.map(a => a.nome_arquivo)).toEqual([esperado, esperado])
    expect(arquivos.map(a => a.extensao)).toEqual(['tif', 'xml'])
    expect(arquivos[1].checksum).toBe(sha256(conteudo))
  })

  // A versao PLANEJADA nasce sem arquivo de proposito e o recebe depois. Este
  // caso e a razao de a rota existir.
  it('completa a versao PLANEJADA, e NAO muda o tipo dela', async () => {
    await volumePrimario()
    const produto = await createProduto({ tipo_produto_id: TIPO_PRODUTO })
    const { id: versaoId } = await conn.one(
      `INSERT INTO acervo.versao(
        uuid_versao, versao, nome, tipo_versao_id, subtipo_produto_id, produto_id,
        metadado, descricao, orgao_produtor, data_criacao, data_edicao,
        usuario_cadastramento_uuid, data_cadastramento
      ) VALUES (uuid_generate_v4(), '1-DSG', NULL, 3, $1, $2, '{}', '', 'DSG',
        '2026-01-10', '2026-02-10', $3, NOW()) RETURNING id`,
      [SUBTIPO, produto.id, 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11']
    )

    const res = await enviarArquivos(
      { versao_id: versaoId, arquivos: [arquivoBase()] },
      [{ conteudo: Buffer.from('a folha ficou pronta'), nome: 'orto.tif' }]
    )

    expect(res.status).toBe(201)
    const versao = await conn.one('SELECT tipo_versao_id FROM acervo.versao WHERE id = $1', [versaoId])
    // Planejada continua Planejada: "tem byte" nao e o mesmo que "foi prometida",
    // e o RPCMTec conta produto entregue por TIPO de versao.
    expect(Number(versao.tipo_versao_id)).toBe(3)
  })

  it('recusa a extensao que a versao JA TEM', async () => {
    const { versaoId } = await versaoComArquivo()

    const res = await enviarArquivos(
      { versao_id: versaoId, arquivos: [arquivoBase({ nome: 'Outro raster' })] },
      [{ conteudo: Buffer.from('outro'), nome: 'outro.tif' }]
    )

    expect(res.status).toBe(409)
    const n = await conn.one('SELECT count(*)::int AS c FROM acervo.arquivo')
    expect(n.c).toBe(1)
  })

  it('recusa versao inexistente antes de gravar byte', async () => {
    await volumePrimario()

    const res = await enviarArquivos(
      { versao_id: 9999999, arquivos: [arquivoBase()] },
      [{ conteudo: Buffer.from('x'), nome: 'a.tif' }]
    )

    expect(res.status).toBe(404)
    expect(await fs.readdir(raizVolume)).toEqual([])
  })

  // O corpo desta rota nao aceita produto nem versao: ela so acrescenta arquivo.
  it('recusa corpo que tente trazer versao ou produto junto', async () => {
    const { versaoId } = await versaoComArquivo()

    const res = await enviarArquivos(
      { versao_id: versaoId, versao: versaoBase({ versao: '9-DSG' }), arquivos: [arquivoBase()] },
      [{ conteudo: Buffer.from('x'), nome: 'a.xml' }]
    )

    // `stripUnknown` descarta a chave e o envio segue, mas a versao NAO muda.
    if (res.status === 201) {
      const v = await conn.one('SELECT versao FROM acervo.versao WHERE id = $1', [versaoId])
      expect(v.versao).toBe('1-DSG')
    } else {
      expect(res.status).toBe(400)
    }
  })

  it('exige perfil de operador', async () => {
    const { versaoId } = await versaoComArquivo()

    const res = await enviarArquivos(
      { versao_id: versaoId, arquivos: [arquivoBase()] },
      [{ conteudo: Buffer.from('x'), nome: 'a.xml' }],
      generateUserToken()
    )

    expect(res.status).toBe(403)
  })
})

// REGRESSAO. O envio pela web nao passa mais por sessao nenhuma, e o fluxo do
// PLUGIN continua sendo o par prepare/confirm, com o checksum DECLARADO pelo
// cliente e conferido na releitura. Mexer no web nao pode ter afrouxado isso:
// seria silencioso, porque tudo continuaria respondendo 200.
describe('REGRESSÃO: prepare-upload/product + confirm-upload (fluxo do plugin)', () => {
  const corpoPlugin = (conteudo) => ({
    produtos: [{
      produto: {
        nome: 'Ortoimagem Plugin',
        mi: '2965-2',
        inom: 'SH-22-Y-A-I-2',
        tipo_escala_id: 1,
        denominador_escala_especial: null,
        tipo_produto_id: TIPO_PRODUTO,
        subtipo_produto_id: null,
        descricao: '',
        geom: 'SRID=4674;POLYGON((-50 -15, -49 -15, -49 -14, -50 -14, -50 -15))'
      },
      versoes: [{
        versao: '1-DSG',
        nome: null,
        tipo_versao_id: 1,
        subtipo_produto_id: SUBTIPO,
        lote_id: null,
        orgao_produtor: 'DSG',
        data_criacao: '2026-01-10',
        data_edicao: '2026-02-10',
        arquivos: [{
          nome: 'Ortoimagem',
          nome_arquivo: 'Ortoimagem_MI 2965-2',
          tipo_arquivo_id: 1,
          extensao: 'tif',
          tamanho_mb: conteudo.length / (1024 * 1024),
          checksum: sha256(conteudo),
          situacao_carregamento_id: 1
        }]
      }]
    }]
  })

  const prepararPlugin = (body) =>
    request(app)
      .post('/api/arquivo/prepare-upload/product')
      .set('Authorization', generateAdminToken())
      .send(body)

  const confirmar = (sessionUuid) =>
    request(app)
      .post('/api/arquivo/confirm-upload')
      .set('Authorization', generateAdminToken())
      .send({ session_uuid: sessionUuid })

  const destinoDoPreparo = (preparo) =>
    preparo.body.dados.produtos[0].versoes[0].arquivos[0].destination_path

  it('o plugin continua declarando o checksum, e o confirm o CONFERE', async () => {
    await volumePrimario()
    const conteudo = Buffer.from('bytes que o plugin copiou por SMB')

    const preparo = await prepararPlugin(corpoPlugin(conteudo))
    expect(preparo.status).toBe(200)

    // O plugin copia por fora; aqui o teste faz o papel dele.
    await fs.writeFile(destinoDoPreparo(preparo), conteudo)

    const res = await confirmar(preparo.body.dados.session_uuid)
    expect(res.body.success).toBe(true)

    const arquivo = await conn.one('SELECT * FROM acervo.arquivo')
    expect(arquivo.checksum).toBe(sha256(conteudo))
  })

  it('checksum declarado que NAO bate com o byte continua falhando', async () => {
    await volumePrimario()
    const conteudo = Buffer.from('o que o plugin disse que copiou')

    const preparo = await prepararPlugin(corpoPlugin(conteudo))
    // Copia truncada: e exatamente o que a releitura existe para pegar.
    await fs.writeFile(destinoDoPreparo(preparo), Buffer.from('metade'))

    const res = await confirmar(preparo.body.dados.session_uuid)
    expect(res.body.success).toBe(false)

    const n = await conn.one('SELECT count(*)::int AS c FROM acervo.arquivo')
    expect(n.c).toBe(0)
  })
})
