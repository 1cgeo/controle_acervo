'use strict'

// Correcao do NOME FISICO gravado, para o arquivo catalogado onde ele ja estava.
//
// O QUE ESTES TESTES PROTEGEM. A rota existe porque o catalogo pode apontar um
// caminho que nao existe, e a unica prova disso e a ENTRADA DE DIRETORIO. Trocar
// o `readdir` por `fs.access` faria todos os casos passarem no Linux e o caso de
// CAIXA passar no Windows, que e o defeito que a rota conserta: 62 arquivos do
// Lote 1 do Convenio RS ficaram 26 dias com o nome errado porque quem conferiu
// conferiu pelo SMB, onde `Ortoimagem_MI 2952-4-NE.rrd` e
// `ortoimagem_mi 2952-4-ne.rrd` sao o mesmo arquivo.
//
// Por isso os arquivos daqui sao arquivos de verdade, num diretorio temporario
// que faz o papel do volume. Dublê de sistema de arquivos nao testaria a unica
// coisa que importa.

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

beforeAll(async () => {
  app = await getApp()
  raizVolume = await fs.mkdtemp(path.join(os.tmpdir(), 'sca-nome-fisico-'))
}, 60000)

afterAll(async () => {
  await fs.rm(raizVolume, { recursive: true, force: true })
})

// Volume e banco sao dois estados, e os dois vazam entre casos.
afterEach(async () => {
  await cleanTestData()
  await fs.rm(raizVolume, { recursive: true, force: true })
  await fs.mkdir(raizVolume, { recursive: true })
})

const corrigir = (body, token = generateAdminToken()) =>
  request(app)
    .post('/api/arquivo/corrigir-nome-fisico')
    .set('Authorization', token)
    .send({ motivo: 'teste de correcao de nome', ...body })

const gravarNoVolume = async (relativo, conteudo) => {
  const destino = path.join(raizVolume, relativo)
  await fs.mkdir(path.dirname(destino), { recursive: true })
  await fs.writeFile(destino, conteudo)
  return {
    checksum: crypto.createHash('sha256').update(conteudo).digest('hex'),
    tamanho_mb: Buffer.byteLength(conteudo) / (1024 * 1024)
  }
}

// Cria a situacao real do Convenio RS: o byte esta no volume com um nome, e o
// catalogo guarda OUTRO (aqui, o mesmo nome com outra caixa).
const catalogadoComNomeErrado = async ({
  nomeNoDisco = 'LOTE_1/IMAGENS/ortoimagem_mi 2952-4-ne',
  nomeNoCatalogo = 'LOTE_1/IMAGENS/Ortoimagem_MI 2952-4-NE',
  extensao = 'rrd',
  conteudo = 'piramide do erdas'
} = {}) => {
  const volume = await createVolume({
    nome: 'Entregas Convenio (teste)',
    volume: raizVolume,
    layout_origem: true
  })
  const medido = await gravarNoVolume(`${nomeNoDisco}.${extensao}`, conteudo)
  const produto = await createProduto({ mi: '2952-4-NE', inom: 'INOM-2952-4-NE' })
  const versao = await createVersao(produto.id)
  const arquivo = await createArquivo(versao.id, {
    volume_armazenamento_id: volume.id,
    nome_arquivo: nomeNoCatalogo,
    extensao,
    tipo_arquivo_id: 8,
    tamanho_mb: medido.tamanho_mb,
    checksum: medido.checksum,
    tipo_status_id: 2
  })
  return { volume, produto, versao, arquivo, medido, nomeNoDisco, extensao }
}

const lerArquivo = id =>
  conn.one('SELECT nome_arquivo, extensao, tipo_status_id FROM acervo.arquivo WHERE id = $1', [id])

describe('POST /api/arquivo/corrigir-nome-fisico', () => {
  it('exige administrador', async () => {
    const semToken = await request(app)
      .post('/api/arquivo/corrigir-nome-fisico')
      .send({ motivo: 'sem token', arquivos: [{ id: 1, nome_arquivo: 'x' }] })
    expect(semToken.status).toBe(401)

    const comum = await corrigir(
      { arquivos: [{ id: 1, nome_arquivo: 'x' }] },
      generateUserToken()
    )
    expect(comum.status).toBe(403)
  })

  it('planeja a correcao de caixa sem gravar nada', async () => {
    const caso = await catalogadoComNomeErrado()

    const res = await corrigir({
      arquivos: [{ id: Number(caso.arquivo.id), nome_arquivo: caso.nomeNoDisco }]
    })

    expect(res.status).toBe(200)
    expect(res.body.dados.dry_run).toBe(true)
    expect(res.body.dados.corrigidos).toBe(1)
    expect(res.body.dados.falhas).toBe(0)
    expect(res.body.dados.detalhe[0].status).toBe('corrigiria')
    expect(res.body.dados.detalhe[0].checksum_conferido).toBe(true)

    // O plano nao escreve: o catalogo continua com o nome errado.
    const depois = await lerArquivo(caso.arquivo.id)
    expect(depois.nome_arquivo).toBe('LOTE_1/IMAGENS/Ortoimagem_MI 2952-4-NE')
  })

  it('grava o nome do diretorio e nao toca no byte', async () => {
    const caso = await catalogadoComNomeErrado()

    const res = await corrigir({
      arquivos: [{ id: Number(caso.arquivo.id), nome_arquivo: caso.nomeNoDisco }],
      dry_run: false
    })

    expect(res.status).toBe(200)
    expect(res.body.dados.corrigidos).toBe(1)
    expect(res.body.dados.falhas).toBe(0)

    const depois = await lerArquivo(caso.arquivo.id)
    expect(depois.nome_arquivo).toBe(caso.nomeNoDisco)
    expect(depois.extensao).toBe(caso.extensao)

    // O arquivo continua onde estava, com o nome que sempre teve.
    const naPasta = await fs.readdir(path.join(raizVolume, 'LOTE_1', 'IMAGENS'))
    expect(naPasta).toEqual([`ortoimagem_mi 2952-4-ne.${caso.extensao}`])

    // A marca de erro NAO e tirada aqui: quem a pos foi a verificacao do acervo.
    expect(Number(depois.tipo_status_id)).toBe(2)
  })

  it('registra o evento de auditoria com o motivo', async () => {
    const caso = await catalogadoComNomeErrado()

    await corrigir({
      arquivos: [{ id: Number(caso.arquivo.id), nome_arquivo: caso.nomeNoDisco }],
      dry_run: false,
      motivo: 'caixa divergente do dirent'
    })

    const evento = await conn.oneOrNone(`
      SELECT motivo, dados_antes->>'nome_arquivo' AS antes, dados_depois->>'nome_arquivo' AS depois
      FROM auditoria.evento
      WHERE tabela = 'acervo.arquivo' AND registro_id = $1 AND operacao = 'U'
      ORDER BY id DESC LIMIT 1`, [String(caso.arquivo.id)])

    expect(evento).not.toBeNull()
    expect(evento.motivo).toBe('caixa divergente do dirent')
    expect(evento.antes).toBe('LOTE_1/IMAGENS/Ortoimagem_MI 2952-4-NE')
    expect(evento.depois).toBe(caso.nomeNoDisco)
  })

  // ESTE E O CASO QUE REPROVA UMA IMPLEMENTACAO COM `fs.access`. No Windows,
  // `fs.access` aprova o nome com a caixa trocada e a rota gravaria um caminho
  // que o servidor Linux nao acha, que e exatamente o defeito de origem.
  it('recusa nome novo que so existe se a caixa for ignorada', async () => {
    const caso = await catalogadoComNomeErrado()

    const res = await corrigir({
      arquivos: [{
        id: Number(caso.arquivo.id),
        nome_arquivo: 'LOTE_1/IMAGENS/ORTOIMAGEM_MI 2952-4-NE'
      }],
      dry_run: false
    })

    expect(res.body.dados.corrigidos).toBe(0)
    expect(res.body.dados.falhas).toBe(1)
    expect(res.body.dados.detalhe[0].motivo).toMatch(/NÃO existe no volume/)

    const depois = await lerArquivo(caso.arquivo.id)
    expect(depois.nome_arquivo).toBe('LOTE_1/IMAGENS/Ortoimagem_MI 2952-4-NE')
  })

  // O nome do catalogo aqui EXISTE no volume, e o pedido aponta para outro
  // arquivo que tambem existe. Aceitar seria trocar o arquivo da linha por baixo
  // do cadastro, sem mover byte nenhum, que e o pior modo de falhar desta rota.
  //
  // Os dois nomes diferem por mais do que a caixa DE PROPOSITO: no Windows dois
  // nomes que so diferem em caixa nao coexistem no mesmo diretorio, e o teste
  // montado assim passaria por engano.
  it('recusa quando o nome atual ainda existe no volume, que seria renome', async () => {
    const caso = await catalogadoComNomeErrado({
      nomeNoDisco: 'LOTE_1/IMAGENS/Ortoimagem_MI 2952-4-NE',
      nomeNoCatalogo: 'LOTE_1/IMAGENS/Ortoimagem_MI 2952-4-NE'
    })
    await gravarNoVolume(`LOTE_1/IMAGENS/vizinha.${caso.extensao}`, 'piramide do erdas')

    const res = await corrigir({
      arquivos: [{ id: Number(caso.arquivo.id), nome_arquivo: 'LOTE_1/IMAGENS/vizinha' }],
      dry_run: false
    })

    expect(res.body.dados.falhas).toBe(1)
    expect(res.body.dados.detalhe[0].motivo).toMatch(/seria renomear/)

    const depois = await lerArquivo(caso.arquivo.id)
    expect(depois.nome_arquivo).toBe('LOTE_1/IMAGENS/Ortoimagem_MI 2952-4-NE')
  })

  it('recusa quando o tamanho no volume nao bate com o gravado', async () => {
    const caso = await catalogadoComNomeErrado()
    await conn.none('UPDATE acervo.arquivo SET tamanho_mb = $1 WHERE id = $2',
      [caso.medido.tamanho_mb + 5, caso.arquivo.id])

    const res = await corrigir({
      arquivos: [{ id: Number(caso.arquivo.id), nome_arquivo: caso.nomeNoDisco }],
      dry_run: false
    })

    expect(res.body.dados.falhas).toBe(1)
    expect(res.body.dados.detalhe[0].motivo).toMatch(/tamanho no volume/)
  })

  // Tamanho igual e conteudo diferente: e o caso que o `stat` sozinho aprovaria.
  it('recusa quando o sha256 nao bate, com o tamanho igual', async () => {
    const caso = await catalogadoComNomeErrado()
    await gravarNoVolume(`${caso.nomeNoDisco}.${caso.extensao}`, 'PIRAMIDE DO ERDAS')

    const res = await corrigir({
      arquivos: [{ id: Number(caso.arquivo.id), nome_arquivo: caso.nomeNoDisco }],
      dry_run: false
    })

    expect(res.body.dados.falhas).toBe(1)
    expect(res.body.dados.detalhe[0].motivo).toMatch(/sha256/)

    const depois = await lerArquivo(caso.arquivo.id)
    expect(depois.nome_arquivo).toBe('LOTE_1/IMAGENS/Ortoimagem_MI 2952-4-NE')
  })

  it('recusa travessia de caminho', async () => {
    const caso = await catalogadoComNomeErrado()

    const res = await corrigir({
      arquivos: [{ id: Number(caso.arquivo.id), nome_arquivo: '../../etc/passwd' }],
      dry_run: false
    })

    expect(res.body.dados.falhas).toBe(1)
    expect(res.body.dados.detalhe[0].motivo).toMatch(/sairia da raiz do volume/)
  })

  // O alvo aqui e de OUTRA linha do catalogo. O indice unico
  // `unique_nome_fisico_por_volume_ci` barraria igual, mas com uma mensagem que
  // nao diz com quem colidiu, e depois de o servidor ter lido o arquivo inteiro.
  //
  // O alvo difere do nome atual por mais do que a caixa porque aquele indice e
  // CASE-INSENSITIVE: duas linhas do mesmo volume que so diferem em caixa nao
  // podem coexistir, entao o cenario nem se monta.
  it('recusa colisao com outro arquivo do mesmo volume', async () => {
    const caso = await catalogadoComNomeErrado()
    await gravarNoVolume(`LOTE_1/IMAGENS/vizinha.${caso.extensao}`, 'piramide do erdas')
    const outroProduto = await createProduto({ mi: '2952-4-SE', inom: 'INOM-2952-4-SE' })
    const outraVersao = await createVersao(outroProduto.id)
    const vizinha = await createArquivo(outraVersao.id, {
      volume_armazenamento_id: caso.volume.id,
      nome_arquivo: 'LOTE_1/IMAGENS/vizinha',
      extensao: caso.extensao,
      tipo_arquivo_id: 8
    })

    const res = await corrigir({
      arquivos: [{ id: Number(caso.arquivo.id), nome_arquivo: 'LOTE_1/IMAGENS/vizinha' }],
      dry_run: false
    })

    expect(res.body.dados.falhas).toBe(1)
    expect(res.body.dados.detalhe[0].motivo).toMatch(new RegExp(`já é do arquivo ${vizinha.id}`))
  })

  it('nao reclama de arquivo cujo nome ja esta certo', async () => {
    const caso = await catalogadoComNomeErrado({
      nomeNoDisco: 'LOTE_1/IMAGENS/Ortoimagem_MI 2985-2-NE',
      nomeNoCatalogo: 'LOTE_1/IMAGENS/Ortoimagem_MI 2985-2-NE'
    })

    const res = await corrigir({
      arquivos: [{ id: Number(caso.arquivo.id), nome_arquivo: caso.nomeNoDisco }],
      dry_run: false
    })

    expect(res.body.dados.sem_mudanca).toBe(1)
    expect(res.body.dados.falhas).toBe(0)
    expect(res.body.dados.corrigidos).toBe(0)
  })
})
