'use strict'

// Envio de arquivo pelo NAVEGADOR: prepare, PUT dos bytes, confirm.
//
// O QUE ESTE ARQUIVO GUARDA, em ordem de importancia:
//
//   1. O byte chega ao VOLUME e o checksum gravado e o SHA-256 do conteudo que
//      subiu. Como o servidor mede enquanto escreve, um erro no cano (pedaco
//      perdido, hash alimentado fora de ordem) daria checksum errado sem erro
//      nenhum, e so apareceria muito depois, quando alguem baixasse. Por isso o
//      volume aqui e um diretorio de verdade, e nao um duble.
//   2. O fluxo do PLUGIN continua funcionando e continua CONFERINDO o checksum
//      declarado. O confirm-upload passou a pular a releitura da linha ja
//      medida, e uma condicao larga demais desligaria a unica prova de que a
//      copia por SMB chegou inteira. Regressao aqui e silenciosa: tudo
//      responderia 200.
//   3. As recusas que impedem o corpo da requisicao de escolher onde escrever:
//      travessia de caminho, arquivo de outra sessao, arquivo acima do teto.

const request = require('supertest')
const fs = require('fs').promises
const os = require('os')
const path = require('path')
const crypto = require('crypto')

const { getApp } = require('../helpers/app')
const { conn, cleanTestData } = require('../helpers/db')
const { generateAdminToken, generateUserToken } = require('../helpers/auth')
const { createVolume, createProduto, createVersao } = require('../helpers/fixtures')
const config = require('../../config')

let app
let raizVolume

const TIPO_PRODUTO = 4 // Ortoimagem, o mesmo do teste de catalogacao
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

const arquivoWeb = (overrides = {}) => ({
  nome: 'Ortoimagem',
  nome_arquivo: 'Ortoimagem_MI 2965-1',
  tipo_arquivo_id: 1,
  extensao: 'tif',
  crs_original: '4674',
  ...overrides
})

const corpoProduto = (overrides = {}, arquivos = [arquivoWeb()]) => ({
  produtos: [
    {
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
      versoes: [
        {
          versao: '1-DSG',
          nome: 'Primeira edição',
          tipo_versao_id: 1,
          subtipo_produto_id: 1,
          lote_id: null,
          orgao_produtor: 'DSG',
          data_criacao: '2026-01-10T12:00:00-03:00',
          data_edicao: '2026-02-10T12:00:00-03:00',
          arquivos
        }
      ]
    }
  ]
})

const preparar = (body, token = generateAdminToken()) =>
  request(app)
    .post('/api/arquivo/upload-web/prepare/product')
    .set('Authorization', token)
    .send(body)

const enviarBytes = (sessionUuid, tempId, conteudo, token = generateAdminToken()) =>
  request(app)
    .put(`/api/arquivo/upload-web/${sessionUuid}/arquivo/${tempId}`)
    .set('Authorization', token)
    .attach('arquivo', conteudo, 'ortoimagem.tif')

const confirmar = (sessionUuid, token = generateAdminToken()) =>
  request(app)
    .post('/api/arquivo/confirm-upload')
    .set('Authorization', token)
    .send({ session_uuid: sessionUuid })

const cancelar = (sessionUuid, token = generateAdminToken()) =>
  request(app)
    .post('/api/arquivo/cancel-upload')
    .set('Authorization', token)
    .send({ session_uuid: sessionUuid })

const sha256 = conteudo => crypto.createHash('sha256').update(conteudo).digest('hex')

const existe = caminho => fs.access(caminho).then(() => true).catch(() => false)

/** O destino fisico que o prepare reservou, lido da linha _temp. */
const destinoDe = async tempId =>
  (await conn.one('SELECT destination_path FROM acervo.upload_arquivo_temp WHERE id = $1', [tempId]))
    .destination_path

describe('PUT /api/arquivo/upload-web/:session_uuid/arquivo/:temp_id', () => {
  it('exige o perfil de operador', async () => {
    const semToken = await request(app)
      .post('/api/arquivo/upload-web/prepare/product')
      .send(corpoProduto())
    expect(semToken.status).toBe(401)

    const consulta = await preparar(corpoProduto(), generateUserToken())
    expect(consulta.status).toBe(403)
  })

  // O caso central: os bytes sobem por HTTP, o servidor os grava no volume e o
  // checksum que fica no acervo e o do conteudo REAL, medido na escrita.
  it('grava no volume e cadastra com o checksum que o servidor mediu', async () => {
    await volumePrimario()
    const conteudo = Buffer.from('pixels da ortoimagem que subiu pelo navegador')

    const preparado = await preparar(corpoProduto())
    expect(preparado.status).toBe(200)

    const { session_uuid: sessionUuid, arquivos } = preparado.body.dados
    expect(arquivos).toHaveLength(1)
    expect(arquivos[0].nome_arquivo).toBe('Ortoimagem_MI 2965-1')
    expect(arquivos[0].extensao).toBe('tif')
    // Caminho de volume nao sai para o navegador: ele nao tem o que fazer com
    // um caminho de rede, e caminho de maquina nao deve vazar para o cliente.
    expect(arquivos[0].destination_path).toBeUndefined()

    const envio = await enviarBytes(sessionUuid, arquivos[0].temp_id, conteudo)
    expect(envio.status).toBe(200)
    expect(envio.body.dados.checksum).toBe(sha256(conteudo))
    expect(envio.body.dados.bytes).toBe(conteudo.length)

    // O arquivo esta no volume, com o nome DEFINITIVO e o conteudo inteiro.
    const destino = path.join(raizVolume, 'Ortoimagem_MI 2965-1.tif')
    expect(await existe(destino)).toBe(true)
    expect((await fs.readFile(destino)).equals(conteudo)).toBe(true)

    // E o `.parcial` nao sobrou: ele e nome de arquivo incompleto, e o envio
    // terminou. Sobrando, o volume acumularia uma copia de cada upload.
    expect(await existe(destino + '.parcial')).toBe(false)

    const confirmado = await confirmar(sessionUuid)
    expect(confirmado.status).toBe(200)
    expect(confirmado.body.dados.status).toBe('completed')

    const gravado = await conn.one(`
      SELECT a.checksum, a.tamanho_mb, a.nome_arquivo, a.extensao, a.tipo_status_id,
             v.versao, p.inom
      FROM acervo.arquivo a
      JOIN acervo.versao v ON v.id = a.versao_id
      JOIN acervo.produto p ON p.id = v.produto_id
    `)
    expect(gravado.checksum).toBe(sha256(conteudo))
    expect(gravado.nome_arquivo).toBe('Ortoimagem_MI 2965-1')
    expect(gravado.extensao).toBe('tif')
    expect(Number(gravado.tamanho_mb)).toBeGreaterThan(0)
    expect(gravado.versao).toBe('1-DSG')
    expect(gravado.inom).toBe('SH-22-Y-A-I-1')
  })

  it('grava versão nova de produto que já existe', async () => {
    await volumePrimario()
    const produto = await createProduto({
      mi: '2965-1',
      inom: 'SH-22-Y-A-I-1',
      tipo_produto_id: TIPO_PRODUTO,
      subtipo_produto_id: null
    })
    await createVersao(produto.id, { versao: '1-DSG' })

    const conteudo = Buffer.from('segunda edicao da mesma folha')
    const preparado = await request(app)
      .post('/api/arquivo/upload-web/prepare/version')
      .set('Authorization', generateAdminToken())
      .send({
        versoes: [
          {
            produto_id: Number(produto.id),
            versao: {
              versao: '2-DSG',
              nome: 'Segunda edição',
              tipo_versao_id: 1,
              subtipo_produto_id: 1,
              lote_id: null,
              orgao_produtor: 'DSG',
              data_criacao: '2026-01-10T12:00:00-03:00',
              data_edicao: '2026-02-10T12:00:00-03:00'
            },
            arquivos: [arquivoWeb({ nome_arquivo: 'Ortoimagem_MI 2965-1_2-DSG' })]
          }
        ]
      })

    expect(preparado.status).toBe(200)
    const { session_uuid: sessionUuid, arquivos } = preparado.body.dados

    expect((await enviarBytes(sessionUuid, arquivos[0].temp_id, conteudo)).status).toBe(200)
    const confirmado = await confirmar(sessionUuid)
    expect(confirmado.body.dados.status).toBe('completed')

    const nova = await conn.one(
      `SELECT a.checksum FROM acervo.arquivo a
       JOIN acervo.versao v ON v.id = a.versao_id
       WHERE v.versao = '2-DSG'`
    )
    expect(nova.checksum).toBe(sha256(conteudo))
  })

  // `path.join` nao protege contra `..`, entao sem esta recusa o corpo da
  // requisicao escolheria qualquer caminho da maquina para o servidor GRAVAR.
  it('recusa no prepare o caminho que sai da raiz do volume', async () => {
    await volumePrimario()

    const res = await preparar(
      corpoProduto({}, [arquivoWeb({ nome_arquivo: 'LOTE_1/../../../etc/passwd' })])
    )

    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/sairia da raiz do volume/i)
    expect((await conn.one('SELECT count(*)::int AS n FROM acervo.upload_session')).n).toBe(0)
  })

  it('recusa no prepare caminho absoluto, letra de unidade e contrabarra', async () => {
    await volumePrimario()
    const comCaminho = nome_arquivo => preparar(corpoProduto({}, [arquivoWeb({ nome_arquivo })]))

    // Os marcadores `path-ok` sao o uso legitimo do escape do guard: a linha e o
    // exemplo da propria regra, e o que ela prova e que a rota RECUSA.
    expect((await comCaminho('/etc/passwd')).status).toBe(400)
    expect((await comCaminho('W:/entregas/carta')).status).toBe(400) // path-ok
    expect((await comCaminho('LOTE_1\\IMAGENS\\carta')).status).toBe(400) // path-ok
  })

  // Casar so pelo id do arquivo deixaria qualquer operador gravar no destino
  // que um colega reservou.
  it('recusa arquivo que pertence a OUTRA sessão', async () => {
    await volumePrimario()

    const primeira = await preparar(corpoProduto())
    const segunda = await preparar(
      corpoProduto({ mi: '2965-2', inom: 'SH-22-Y-A-I-2' }, [
        arquivoWeb({ nome_arquivo: 'Ortoimagem_MI 2965-2' })
      ])
    )
    expect(segunda.status).toBe(200)

    const res = await enviarBytes(
      primeira.body.dados.session_uuid,
      segunda.body.dados.arquivos[0].temp_id,
      Buffer.from('bytes de qualquer coisa')
    )

    expect(res.status).toBe(404)
    expect(res.body.message).toMatch(/não encontrado nesta sessão/i)
  })

  it('recusa arquivo acima do teto, mandando usar o plugin', async () => {
    await volumePrimario()

    const preparado = await preparar(corpoProduto())
    const { session_uuid: sessionUuid, arquivos } = preparado.body.dados

    // O teto e lido do config a cada requisicao justamente para poder ser
    // exercitado: 2 GB de verdade nao cabem num teste.
    config.UPLOAD_WEB_MAX_GB = 0.000001 // ~1 KB

    const res = await enviarBytes(sessionUuid, arquivos[0].temp_id, Buffer.alloc(200 * 1024, 7))

    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/plugin do QGIS/i)
    // Nada foi gravado: nem o definitivo nem o parcial.
    const destino = await destinoDe(arquivos[0].temp_id)
    expect(await existe(destino)).toBe(false)
    expect(await existe(destino + '.parcial')).toBe(false)
  })
})

describe('POST /api/arquivo/cancel-upload com upload web', () => {
  // Antes de o servidor gravar byte, cancelar nao tocava em disco: quem copiava
  // era o plugin. Agora a sessao cancelada no meio do envio deixa `.parcial` no
  // acervo, e lixo que ninguem apaga vira lixo que ninguem reconhece depois.
  it('apaga o .parcial da sessão e PRESERVA o arquivo definitivo', async () => {
    await volumePrimario()

    const preparado = await preparar(corpoProduto())
    const { session_uuid: sessionUuid, arquivos } = preparado.body.dados
    const destino = await destinoDe(arquivos[0].temp_id)

    // O que um envio interrompido deixa para tras, e um homonimo definitivo que
    // o cancelamento nao tem o direito de apagar.
    await fs.writeFile(destino + '.parcial', Buffer.from('metade dos bytes'))
    await fs.writeFile(destino, Buffer.from('arquivo definitivo de outro envio'))

    const res = await cancelar(sessionUuid)
    expect(res.status).toBe(200)

    expect(await existe(destino + '.parcial')).toBe(false)
    expect(await existe(destino)).toBe(true)

    const sessao = await conn.one('SELECT status FROM acervo.upload_session WHERE uuid_session = $1', [sessionUuid])
    expect(sessao.status).toBe('cancelled')
  })
})

describe('confirm-upload confere que o arquivo AINDA esta no volume', () => {
  // O confirm nao rele o CONTEUDO da linha ja medida -- reler seria refazer os
  // 362 GB do LOTE_1 dentro da transacao. Mas ele confere a EXISTENCIA, que e um
  // `access` de microssegundos e independe do tamanho.
  //
  // A janela e real: a sessao vale 24 h, e entre o PUT e o confirm alguem pode
  // ter mexido no volume. Sem esta conferencia o acervo cadastraria um caminho
  // vazio, e o defeito so apareceria quando alguem fosse baixar -- longe daqui,
  // e sem nada que ligue o download quebrado ao envio que o originou.
  it('recusa quando o arquivo gravado sumiu entre o envio e a confirmacao', async () => {
    await volumePrimario()

    const preparado = await preparar(corpoProduto())
    const { session_uuid: sessionUuid, arquivos } = preparado.body.dados
    const destino = await destinoDe(arquivos[0].temp_id)

    const envio = await enviarBytes(sessionUuid, arquivos[0].temp_id, Buffer.from('bytes que vao sumir'))
    expect(envio.status).toBe(200)
    expect(await existe(destino)).toBe(true)

    // O que aconteceria se alguem limpasse o volume no meio da sessao.
    await fs.rm(destino)

    const res = await confirmar(sessionUuid)
    expect(res.body.success).toBe(false)
    expect(JSON.stringify(res.body)).toContain('não está mais lá')

    // E nada foi cadastrado: produto sem o arquivo que o define nao entra.
    const { count } = await conn.one('SELECT count(*)::int FROM acervo.arquivo')
    expect(count).toBe(0)
  })
})

// REGRESSAO. O upload web fez o confirm-upload pular a releitura da linha que
// ja foi medida na escrita. O fluxo do plugin NAO passa por ali: a linha dele
// continua 'pending' e o checksum foi DECLARADO pelo cliente, entao a releitura
// e a unica coisa que prova que a copia por SMB chegou inteira. Uma condicao
// larga demais desligaria essa prova sem quebrar teste nenhum: tudo continuaria
// respondendo 200, e o acervo passaria a aceitar copia truncada.
describe('REGRESSÃO: prepare-upload/product + confirm-upload (fluxo do plugin)', () => {
  const arquivoPlugin = (overrides = {}) => ({
    nome: 'Ortoimagem',
    nome_arquivo: 'Ortoimagem_MI 2965-1',
    tipo_arquivo_id: 1,
    extensao: 'tif',
    tamanho_mb: 0.001,
    checksum: 'nao-usado',
    crs_original: '4674',
    ...overrides
  })

  const prepararPlugin = (arquivos) =>
    request(app)
      .post('/api/arquivo/prepare-upload/product')
      .set('Authorization', generateAdminToken())
      .send(corpoProduto({}, arquivos))

  it('continua cadastrando quando o checksum declarado bate com o arquivo copiado', async () => {
    await volumePrimario()
    const conteudo = Buffer.from('bytes que o plugin copiou por SMB')

    const preparado = await prepararPlugin([arquivoPlugin({ checksum: sha256(conteudo) })])
    expect(preparado.status).toBe(200)

    const { session_uuid: sessionUuid, produtos } = preparado.body.dados
    const destino = produtos[0].versoes[0].arquivos[0].destination_path

    // O papel do plugin: copiar os bytes para o destino que o prepare reservou.
    await fs.writeFile(destino, conteudo)

    const confirmado = await confirmar(sessionUuid)
    expect(confirmado.status).toBe(200)
    expect(confirmado.body.dados.status).toBe('completed')

    const gravado = await conn.one('SELECT checksum FROM acervo.arquivo')
    expect(gravado.checksum).toBe(sha256(conteudo))
  })

  it('continua RECUSANDO quando o arquivo copiado não bate com o checksum declarado', async () => {
    await volumePrimario()

    const preparado = await prepararPlugin([arquivoPlugin({ checksum: 'a'.repeat(64) })])
    const { session_uuid: sessionUuid, produtos } = preparado.body.dados
    const destino = produtos[0].versoes[0].arquivos[0].destination_path

    await fs.writeFile(destino, Buffer.from('outro conteudo, copia truncada'))

    const confirmado = await confirmar(sessionUuid)
    expect(confirmado.body.dados.status).toBe('failed')
    expect(JSON.stringify(confirmado.body.dados)).toMatch(/checksum/i)

    // E nada entrou no acervo.
    expect((await conn.one('SELECT count(*)::int AS n FROM acervo.arquivo')).n).toBe(0)
    expect((await conn.one('SELECT count(*)::int AS n FROM acervo.produto')).n).toBe(0)
  })

  it('continua recusando quando o arquivo nem chegou ao volume', async () => {
    await volumePrimario()

    const preparado = await prepararPlugin([arquivoPlugin({ checksum: 'b'.repeat(64) })])
    const confirmado = await confirmar(preparado.body.dados.session_uuid)

    expect(confirmado.body.dados.status).toBe('failed')
    expect((await conn.one('SELECT count(*)::int AS n FROM acervo.arquivo')).n).toBe(0)
  })
})
