'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')

const request = require('supertest')
const { getApp } = require('../helpers/app')
const { conn, cleanTestData } = require('../helpers/db')
const { generateAdminToken, generateUserToken } = require('../helpers/auth')
const { createProduto, createVersao, createArquivo } = require('../helpers/fixtures')

// Download WEB de um arquivo do acervo: o servidor lê o volume e faz stream.
//
// É o caminho do NAVEGADOR, irmão do download de ponto de controle e diferente do
// par prepare/confirm-download, que devolve o caminho do volume para o plugin do
// QGIS copiar do share. Aqui o navegador nunca vê caminho de rede.

let app
let volumeDir
let volumeId

const sha256 = (conteudo) => crypto.createHash('sha256').update(conteudo).digest('hex')

// 300 KB, para a retomada por Range ter o que cortar.
const CONTEUDO = Buffer.alloc(300 * 1024, 'ct')

beforeAll(async () => {
  app = await getApp()
})

// Um volume DE VERDADE no disco. Com volume de mentira o teste provaria só que a
// rota responde, que é justamente o que não interessa aqui.
beforeEach(async () => {
  volumeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sca-acervo-'))
  const volume = await conn.one(
    `INSERT INTO acervo.volume_armazenamento (nome, volume, capacidade_gb)
     VALUES ('Volume Download', $1, 100) RETURNING id`,
    [volumeDir]
  )
  volumeId = volume.id
})

afterEach(async () => {
  await cleanTestData()
  fs.rmSync(volumeDir, { recursive: true, force: true })
})

/**
 * Cria produto, versão e arquivo, e ESCREVE o byte no volume.
 * O nome físico é derivado do cadastro: <volume>/<nome_arquivo>.<extensao>.
 * `conteudo` nulo cadastra o arquivo SEM escrever byte (caso do Tileserver, que
 * é uma URL, e do arquivo que sumiu do volume).
 */
const criaArquivoNoVolume = async (overrides = {}, conteudo = CONTEUDO) => {
  const produto = await createProduto({ tipo_produto_id: 2, tipo_escala_id: 2, mi: '2965-2' })
  const versao = await createVersao(produto.id)
  const arquivo = await createArquivo(versao.id, {
    nome: 'Carta Topográfica 2965-2',
    nome_arquivo: 'ct_2965-2_ed1',
    extensao: 'tif',
    volume_armazenamento_id: volumeId,
    tamanho_mb: conteudo ? conteudo.length / (1024 * 1024) : 0,
    checksum: sha256(conteudo || Buffer.alloc(0)),
    ...overrides
  })

  if (conteudo) {
    fs.writeFileSync(
      path.join(volumeDir, `${arquivo.nome_arquivo}.${arquivo.extensao}`),
      conteudo
    )
  }
  return arquivo
}

const baixar = (uuid, token = generateUserToken()) =>
  request(app)
    .get(`/api/acervo/arquivo/${uuid}/download`)
    .set('Authorization', token)

const auditoria = (arquivoId) => conn.any(
  'SELECT status, error_message FROM acervo.download WHERE arquivo_id = $1 ORDER BY id',
  [arquivoId]
)

/**
 * Espera a linha de auditoria aparecer.
 *
 * O registro é gravado DEPOIS que o último byte sai, então o cliente pode ver a
 * resposta inteira antes de o INSERT terminar. Não é atraso da aplicação: é a
 * ordem certa (registrar o desfecho REAL, e não a intenção), e o teste espera em
 * vez de fingir que a escrita é síncrona.
 */
const aguardarAuditoria = async (arquivoId, quantidade = 1) => {
  for (let tentativa = 0; tentativa < 40; tentativa++) {
    const linhas = await auditoria(arquivoId)
    if (linhas.length >= quantidade) return linhas
    await new Promise((r) => setTimeout(r, 25))
  }
  return auditoria(arquivoId)
}

describe('Acervo - download de um arquivo pelo navegador', () => {
  it('entrega os BYTES do volume, com nome, tamanho e checksum no cabeçalho', async () => {
    const arquivo = await criaArquivoNoVolume()

    const res = await baixar(arquivo.uuid_arquivo)

    expect(res.status).toBe(200)
    expect(Buffer.from(res.body)).toEqual(CONTEUDO)
    expect(res.headers['content-type']).toContain('application/octet-stream')
    expect(res.headers['content-disposition']).toContain('ct_2965-2_ed1.tif')
    expect(res.headers['content-length']).toBe(String(CONTEUDO.length))
    // Quem baixou consegue conferir o que chegou, sem abrir o arquivo.
    expect(res.headers['x-checksum-sha256']).toBe(sha256(CONTEUDO))
    // Sem isto o navegador não tenta retomar, e o arquivo de 500 MB que cai no
    // meio recomeça do zero.
    expect(res.headers['accept-ranges']).toBe('bytes')
  })

  it('registra o download na auditoria DEPOIS de entregar, com o desfecho real', async () => {
    const arquivo = await criaArquivoNoVolume()
    expect(await auditoria(arquivo.id)).toHaveLength(0)

    await baixar(arquivo.uuid_arquivo)

    const linhas = await aguardarAuditoria(arquivo.id)
    expect(linhas).toHaveLength(1)
    expect(linhas[0].status).toBe('completed')
  })

  describe('retomada por Range', () => {
    it('devolve 206 com a fatia pedida e o Content-Range', async () => {
      const arquivo = await criaArquivoNoVolume()

      const res = await request(app)
        .get(`/api/acervo/arquivo/${arquivo.uuid_arquivo}/download`)
        .set('Authorization', generateUserToken())
        .set('Range', 'bytes=100-199')

      expect(res.status).toBe(206)
      expect(res.headers['content-range']).toBe(`bytes 100-199/${CONTEUDO.length}`)
      expect(res.headers['content-length']).toBe('100')
      expect(Buffer.from(res.body)).toEqual(CONTEUDO.slice(100, 200))
      // O checksum é do arquivo INTEIRO: mandá-lo junto de uma fatia convidaria a
      // comparar o que não é comparável.
      expect(res.headers['x-checksum-sha256']).toBeUndefined()
    })

    it('sem o fim da faixa, entrega do byte pedido até o final', async () => {
      const arquivo = await criaArquivoNoVolume()

      const res = await request(app)
        .get(`/api/acervo/arquivo/${arquivo.uuid_arquivo}/download`)
        .set('Authorization', generateUserToken())
        .set('Range', `bytes=${CONTEUDO.length - 10}-`)

      expect(res.status).toBe(206)
      expect(Buffer.from(res.body)).toEqual(CONTEUDO.slice(-10))
    })

    it('faixa fora do arquivo dá 416, e não vira linha de auditoria', async () => {
      const arquivo = await criaArquivoNoVolume()

      const res = await request(app)
        .get(`/api/acervo/arquivo/${arquivo.uuid_arquivo}/download`)
        .set('Authorization', generateUserToken())
        .set('Range', 'bytes=999999999-')

      expect(res.status).toBe(416)
      // Requisição inválida não é download falhado: nada saiu do servidor.
      expect(await auditoria(arquivo.id)).toHaveLength(0)
    })
  })

  describe('o que a rota recusa', () => {
    it('registrado mas AUSENTE no volume dá 404, e não um download truncado', async () => {
      const arquivo = await criaArquivoNoVolume()
      // Alguém apagou o byte do volume por fora do sistema.
      fs.rmSync(path.join(volumeDir, 'ct_2965-2_ed1.tif'))

      const res = await baixar(arquivo.uuid_arquivo)

      expect(res.status).toBe(404)
      expect(res.body.message).toMatch(/não foi encontrado no volume/i)
      expect(await auditoria(arquivo.id)).toHaveLength(0)
    })

    // Status 2 é 'Erro no carregamento': o byte no volume pode estar pela metade.
    // Entregar isso é pior que recusar, porque o arquivo chega com o nome certo.
    it('arquivo com status de erro não é baixável', async () => {
      const arquivo = await criaArquivoNoVolume({ tipo_status_id: 2 })

      const res = await baixar(arquivo.uuid_arquivo)

      expect(res.status).toBe(400)
      expect(res.body.message).toMatch(/status de erro/i)
    })

    // Tileserver (tipo 9) é uma URL de serviço: não existe byte em volume nenhum.
    // O próprio DDL já obriga a linha a nascer assim (nome_arquivo com http, e
    // volume, extensão, tamanho e checksum nulos), e é por isso que o fixture
    // parece estranho: ele está obedecendo ao CHECK da tabela.
    it('Tileserver não é baixável', async () => {
      const arquivo = await criaArquivoNoVolume({
        tipo_arquivo_id: 9,
        nome_arquivo: 'https://tiles.example/servico/{z}/{x}/{y}.png',
        volume_armazenamento_id: null,
        extensao: null,
        tamanho_mb: null,
        checksum: null
      }, null)

      const res = await baixar(arquivo.uuid_arquivo)

      expect(res.status).toBe(400)
      expect(res.body.message).toMatch(/tileserver/i)
    })

    it('uuid que não existe dá 404', async () => {
      const res = await baixar('11111111-1111-1111-1111-111111111111')
      expect(res.status).toBe(404)
    })

    it('uuid mal formado dá 400 antes de tocar o banco', async () => {
      const res = await baixar('nao-e-uuid')
      expect(res.status).toBe(400)
    })

    it('exige token', async () => {
      const arquivo = await criaArquivoNoVolume()
      const res = await request(app).get(`/api/acervo/arquivo/${arquivo.uuid_arquivo}/download`)
      expect(res.status).toBe(401)
    })

    // Perfil de consulta no acervo basta: baixar é leitura. O teste existe para
    // fixar isso, porque a rota vizinha (prepare-download) tem o mesmo nível e um
    // relatório futuro poderia endurecer as duas juntas por engano.
    it('perfil de consulta basta, e admin também baixa', async () => {
      const arquivo = await criaArquivoNoVolume()

      expect((await baixar(arquivo.uuid_arquivo, generateUserToken())).status).toBe(200)
      expect((await baixar(arquivo.uuid_arquivo, generateAdminToken())).status).toBe(200)
    })
  })
})

// O TOKEN DE DOWNLOAD E DE QUEM O PEDIU.
//
// `confirmDownload` casava so por `download_token`: qualquer conta com perfil
// `consulta` no acervo que conhecesse um token pendente de outra pessoa podia
// fecha-lo, e o dono recebia depois "Download nao encontrado" sem entender por
// que. As duas rotas irmas (`confirmUpload` e `cancelUpload`) ja conferiam o
// dono.
describe('POST /api/acervo/confirm-download - o dono do token', () => {
  // `Number(...)`: `acervo.arquivo.id` e BIGSERIAL e o driver o entrega como
  // STRING, e o `arquivosIds` e `Joi.number().integer().strict()`. Sem o cast o
  // prepare responde 400 antes de chegar ao controlador.
  const prepararDownload = async (arquivoId, token) =>
    request(app)
      .post('/api/acervo/prepare-download/arquivos')
      .set('Authorization', token)
      .send({ arquivos_ids: [Number(arquivoId)] })

  const confirmar = (downloadToken, token) =>
    request(app)
      .post('/api/acervo/confirm-download')
      .set('Authorization', token)
      .send({ confirmations: [{ download_token: downloadToken, success: true }] })

  it('o dono fecha o proprio download', async () => {
    const arquivo = await criaArquivoNoVolume()
    const preparo = await prepararDownload(arquivo.id, generateUserToken())
    expect(preparo.status).toBe(200)
    const downloadToken = preparo.body.dados[0].download_token

    const res = await confirmar(downloadToken, generateUserToken())
    expect(res.status).toBe(200)
    expect(res.body.dados[0].status).toBe('completed')
  })

  it('outro usuario NAO fecha o download alheio', async () => {
    const arquivo = await criaArquivoNoVolume()
    const preparo = await prepararDownload(arquivo.id, generateUserToken())
    const downloadToken = preparo.body.dados[0].download_token

    // O administrador tambem nao: o token e do dono, e nao ha "fechar pelo
    // outro". O que ele faz e a limpeza (`cleanup-expired-downloads`).
    const res = await confirmar(downloadToken, generateAdminToken())
    expect(res.status).toBe(200)
    expect(res.body.dados[0].status).toBe('error')

    // E o download continua pendente para o dono.
    const linha = await conn.one(
      'SELECT status FROM acervo.download WHERE download_token = $1',
      [downloadToken]
    )
    expect(linha.status).toBe('pending')
  })
})
