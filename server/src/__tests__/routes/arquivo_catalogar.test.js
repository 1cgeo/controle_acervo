'use strict'

// Catalogacao de produto que JA ESTA no volume.
//
// O teste que importa e o do CHECKSUM: a rota inteira existe para nao ler o
// arquivo duas vezes, entao provar que o que ficou gravado e o sha256 do byte
// REAL (e nao um valor que o cliente mandou) e o que separa a otimizacao do
// atalho. Por isso os arquivos daqui sao arquivos de verdade, num diretorio
// temporario que faz o papel do volume, e nao dublês.
//
// O segundo bloco e a travessia de caminho. A rota aceita subpasta por decisao
// (layout do fornecedor), e `path.join` nao protege contra `..`: sem a recusa,
// o corpo da requisicao escolheria qualquer arquivo da maquina.

const request = require('supertest')
const fs = require('fs').promises
const os = require('os')
const path = require('path')
const crypto = require('crypto')

const { getApp } = require('../helpers/app')
const { conn, cleanTestData } = require('../helpers/db')
const { generateAdminToken, generateUserToken } = require('../helpers/auth')
const { createVolume, createProduto, createVersao, createArquivo } = require('../helpers/fixtures')

let app
let raizVolume

// O TIMEOUT do hook vai EXPLÍCITO (2026-08-04). O `testTimeout: 30000` do
// jest.config vale para o teste e NÃO para o `beforeAll`, que fica nos 5.000 ms
// padrão. Este arquivo é dos mais pesados da suíte, e o `getApp()` abre conexão
// de banco: com a suíte inteira em paralelo, o arranque passa dos 5 s e os 12
// casos caem juntos com "Exceeded timeout for a hook" -- falha que se lê como
// defeito e é contenção de máquina. Isolado, o arquivo sempre passou.
beforeAll(async () => {
  app = await getApp()
  raizVolume = await fs.mkdtemp(path.join(os.tmpdir(), 'sca-catalogo-'))
}, 60000)

afterAll(async () => {
  await fs.rm(raizVolume, { recursive: true, force: true })
})

// O volume tambem se limpa entre os casos, e nao so o banco: o arquivo que um
// teste gravou faria o teste do arquivo AUSENTE encontrar byte e passar por
// engano. Volume e banco sao dois estados, e os dois vazam.
afterEach(async () => {
  await cleanTestData()
  await fs.rm(raizVolume, { recursive: true, force: true })
  await fs.mkdir(raizVolume, { recursive: true })
})

const catalogar = (body, token = generateAdminToken()) =>
  request(app)
    .post('/api/arquivo/catalogar/product')
    .set('Authorization', token)
    .send(body)

// Grava um arquivo de verdade sob a raiz que faz o papel do volume e devolve o
// sha256 do que foi gravado, para a rota ter o que bater.
const gravarNoVolume = async (relativo, conteudo) => {
  const destino = path.join(raizVolume, relativo)
  await fs.mkdir(path.dirname(destino), { recursive: true })
  await fs.writeFile(destino, conteudo)
  return crypto.createHash('sha256').update(conteudo).digest('hex')
}

const volumeDeOrigem = (overrides = {}) =>
  createVolume({
    nome: 'Entregas Convenio',
    volume: raizVolume,
    layout_origem: true,
    ...overrides
  })

const arquivo = (overrides = {}) => ({
  nome: 'Ortoimagem',
  nome_arquivo: 'LOTE_1/IMAGENS/Ortoimagem_MI 2965-1',
  tipo_arquivo_id: 1,
  extensao: 'img',
  crs_original: '4674',
  ...overrides
})

const corpo = (volumeId, overrides = {}) => ({
  volume_armazenamento_id: volumeId,
  produtos: [
    {
      produto: {
        nome: 'Ortoimagem Convenio',
        mi: '2965-1',
        inom: 'SH-22-Y-A-I-1',
        tipo_escala_id: 1,
        denominador_escala_especial: null,
        tipo_produto_id: 4,
        subtipo_produto_id: null,
        descricao: 'Entrega do convenio',
        geom: 'SRID=4674;POLYGON((-50 -15, -49 -15, -49 -14, -50 -14, -50 -15))'
      },
      versoes: [
        {
          versao: '1-DSG',
          nome: 'Primeira entrega',
          tipo_versao_id: 1,
          subtipo_produto_id: 1,
          lote_id: null,
          orgao_produtor: 'Convenio RS',
          data_criacao: '2026-01-10T12:00:00-03:00',
          data_edicao: '2026-02-10T12:00:00-03:00',
          arquivos: [arquivo()]
        }
      ]
    }
  ],
  ...overrides
})

describe('POST /api/arquivo/catalogar/product', () => {
  it('should require the operador profile', async () => {
    const semToken = await request(app)
      .post('/api/arquivo/catalogar/product')
      .send({ volume_armazenamento_id: 1, produtos: [] })
    expect(semToken.status).toBe(401)

    const consulta = await catalogar(
      { volume_armazenamento_id: 1, produtos: [] },
      generateUserToken()
    )
    expect(consulta.status).toBe(403)
  })

  // O coracao da rota: o checksum gravado e o do byte que esta no volume, medido
  // pelo servidor, e o cliente nao teve como influenciar.
  it('should store the sha256 the server measured from the file on the volume', async () => {
    const volume = await volumeDeOrigem()
    const sha = await gravarNoVolume(
      'LOTE_1/IMAGENS/Ortoimagem_MI 2965-1.img',
      Buffer.from('pixels da ortoimagem do convenio')
    )

    const res = await catalogar(corpo(volume.id))

    expect(res.status).toBe(201)
    const catalogado = res.body.dados.produtos[0].versoes[0].arquivos[0]
    expect(catalogado.checksum).toBe(sha)

    const gravado = await conn.one(
      'SELECT checksum, nome_arquivo, extensao, tamanho_mb, volume_armazenamento_id FROM acervo.arquivo WHERE id = $1',
      [catalogado.arquivo_id]
    )
    expect(gravado.checksum).toBe(sha)
    expect(Number(gravado.volume_armazenamento_id)).toBe(Number(volume.id))
    // O nome fisico e o caminho relativo do fornecedor, gravado como veio: a
    // rota nao renomeia, e a subpasta faz parte do nome.
    expect(gravado.nome_arquivo).toBe('LOTE_1/IMAGENS/Ortoimagem_MI 2965-1')
    expect(gravado.extensao).toBe('img')
    expect(gravado.tamanho_mb).toBeGreaterThan(0)
  })

  it('should create produto, versao and arquivo and return their ids', async () => {
    const volume = await volumeDeOrigem()
    await gravarNoVolume('LOTE_1/IMAGENS/Ortoimagem_MI 2965-1.img', Buffer.from('conteudo'))

    const res = await catalogar(corpo(volume.id))

    expect(res.status).toBe(201)
    const produto = res.body.dados.produtos[0]
    expect(res.body.dados.total_arquivos).toBe(1)

    const linha = await conn.one(
      `SELECT p.inom, v.versao, count(a.id)::int AS arquivos
       FROM acervo.produto p
       JOIN acervo.versao v ON v.produto_id = p.id
       JOIN acervo.arquivo a ON a.versao_id = v.id
       WHERE p.id = $1
       GROUP BY p.inom, v.versao`,
      [produto.produto_id]
    )
    expect(linha.inom).toBe('SH-22-Y-A-I-1')
    expect(linha.versao).toBe('1-DSG')
    expect(linha.arquivos).toBe(1)
  })

  // A marca do volume e a porta da rota. Sem ela, catalogar sem conferir
  // transferencia viraria atalho para pular o confirm-upload no acervo comum.
  it('should refuse a volume that does not keep the supplier layout', async () => {
    const comum = await createVolume({
      nome: 'Volume Comum',
      volume: raizVolume,
      layout_origem: false
    })
    await gravarNoVolume('LOTE_1/IMAGENS/Ortoimagem_MI 2965-1.img', Buffer.from('conteudo'))

    const res = await catalogar(corpo(comum.id))

    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/layout de origem/i)
    expect((await conn.one('SELECT count(*)::int AS n FROM acervo.produto')).n).toBe(0)
  })

  it('should refuse a path that escapes the volume root', async () => {
    const volume = await volumeDeOrigem()

    const res = await catalogar(
      corpo(volume.id, {
        produtos: corpo(volume.id).produtos.map(p => ({
          ...p,
          versoes: p.versoes.map(v => ({
            ...v,
            arquivos: [arquivo({ nome_arquivo: 'LOTE_1/../../../etc/passwd' })]
          }))
        }))
      })
    )

    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/sairia da raiz do volume/i)
    expect((await conn.one('SELECT count(*)::int AS n FROM acervo.produto')).n).toBe(0)
  })

  it('should refuse an absolute path and a drive letter', async () => {
    const volume = await volumeDeOrigem()
    const comCaminho = nome_arquivo =>
      catalogar(
        corpo(volume.id, {
          produtos: corpo(volume.id).produtos.map(p => ({
            ...p,
            versoes: p.versoes.map(v => ({ ...v, arquivos: [arquivo({ nome_arquivo })] }))
          }))
        })
      )

    // Os dois marcadores `path-ok` abaixo sao o uso legitimo do escape: a linha
    // e o exemplo da propria regra, e o que ela prova e que a rota RECUSA a
    // letra de unidade e a contrabarra. Nenhum caminho real aparece aqui.
    expect((await comCaminho('/etc/passwd')).status).toBe(400)
    expect((await comCaminho('W:/entregas/carta')).status).toBe(400) // path-ok
    expect((await comCaminho('LOTE_1\\IMAGENS\\carta')).status).toBe(400) // path-ok
  })

  // Nada se copia, entao o arquivo tem de estar la ANTES. Cadastrar sem conferir
  // existencia encheria o acervo de registro que aponta para o vazio.
  it('should refuse to catalog a file that is not on the volume', async () => {
    const volume = await volumeDeOrigem()

    const res = await catalogar(corpo(volume.id))

    expect(res.status).toBe(404)
    expect(res.body.message).toMatch(/não encontrado no volume/i)
    // A leitura acontece ANTES da transacao, entao nao sobra produto orfao.
    expect((await conn.one('SELECT count(*)::int AS n FROM acervo.produto')).n).toBe(0)
  })

  // Descartar em silencio faria o cliente acreditar que gravou o checksum que
  // mandou. Quem mede e o servidor, e o contrato diz isso na cara.
  it('should refuse a checksum or a size declared by the client', async () => {
    const volume = await volumeDeOrigem()
    const comCampo = extra =>
      catalogar(
        corpo(volume.id, {
          produtos: corpo(volume.id).produtos.map(p => ({
            ...p,
            versoes: p.versoes.map(v => ({ ...v, arquivos: [arquivo(extra)] }))
          }))
        })
      )

    const comChecksum = await comCampo({ checksum: 'a'.repeat(64) })
    expect(comChecksum.status).toBe(400)
    expect(comChecksum.body.message).toMatch(/medido pelo servidor/i)

    const comTamanho = await comCampo({ tamanho_mb: 12.5 })
    expect(comTamanho.status).toBe(400)
    expect(comTamanho.body.message).toMatch(/medido pelo servidor/i)
  })

  it('should refuse a tileserver entry, which has no byte on the volume', async () => {
    const volume = await volumeDeOrigem()

    const res = await catalogar(
      corpo(volume.id, {
        produtos: corpo(volume.id).produtos.map(p => ({
          ...p,
          versoes: p.versoes.map(v => ({
            ...v,
            arquivos: [arquivo({ tipo_arquivo_id: 9, nome_arquivo: 'https://tiles/x' })]
          }))
        }))
      })
    )

    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/prepare-upload/i)
  })

  // A unicidade fisica nao afrouxa no volume de layout de origem: dois registros
  // com o mesmo trio disputariam o mesmo byte.
  it('should refuse a physical name already taken on the volume', async () => {
    const volume = await volumeDeOrigem()
    await gravarNoVolume('LOTE_1/IMAGENS/Ortoimagem_MI 2965-1.img', Buffer.from('conteudo'))

    const produtoExistente = await createProduto({ mi: '9999', inom: 'INOM-OCUPADO' })
    const versaoExistente = await createVersao(produtoExistente.id)
    await createArquivo(versaoExistente.id, {
      volume_armazenamento_id: volume.id,
      nome_arquivo: 'LOTE_1/IMAGENS/Ortoimagem_MI 2965-1',
      extensao: 'img'
    })

    const res = await catalogar(corpo(volume.id))

    expect(res.status).toBe(409)
    expect(res.body.message).toMatch(/nome f/i)
  })

  it('should refuse two files of the same request resolving to one physical name', async () => {
    const volume = await volumeDeOrigem()
    await gravarNoVolume('LOTE_1/IMAGENS/Ortoimagem_MI 2965-1.img', Buffer.from('conteudo'))

    const res = await catalogar(
      corpo(volume.id, {
        produtos: corpo(volume.id).produtos.map(p => ({
          ...p,
          versoes: p.versoes.map(v => ({
            ...v,
            arquivos: [arquivo(), arquivo({ nome: 'Repetido' })]
          }))
        }))
      })
    )

    expect(res.status).toBe(409)
  })

  it('should refuse a product whose identity already exists', async () => {
    const volume = await volumeDeOrigem()
    await gravarNoVolume('LOTE_1/IMAGENS/Ortoimagem_MI 2965-1.img', Buffer.from('conteudo'))
    await createProduto({
      mi: '2965-1',
      inom: 'SH-22-Y-A-I-1',
      tipo_produto_id: 4,
      subtipo_produto_id: null
    })

    const res = await catalogar(corpo(volume.id))

    expect(res.status).toBe(409)
    expect(res.body.message).toMatch(/INOM/i)
  })
})
