'use strict'

// O CICLO COMPLETO DO ENVIO PELO PLUGIN, com o rascunho num documento.
//
// Desde 06/08/2026 o rascunho do envio não mora mais em três tabelas espelho
// (`upload_produto_temp`, `upload_versao_temp`, `upload_arquivo_temp`): ele é um
// JSONB em `acervo.upload_session.payload`. E a sessão morre na finalização, em
// vez de ficar na tabela para sempre.
//
// O QUE SÓ AQUI SE PROVA, e cada item REPROVA o desenho anterior:
//
//   1. O `prepare-upload` grava o rascunho no `payload`, e as três tabelas
//      espelho não existem mais. Com o desenho antigo o `payload` ficaria vazio.
//   2. O `confirm-upload` cria as linhas REAIS a partir do JSON, com os mesmos
//      valores que o cliente declarou, nos quatro tipos de operação.
//   3. A SESSÃO SOME no confirm, e some na MESMA transação: o que falha depois
//      dos INSERTs não deixa acervo gravado com sessão apagada, nem o contrário.
//      Com o desenho antigo ela virava 'completed' e ficava. Produção tinha
//      2.555 dessas.
//   4. O cancelamento também apaga.
//   5. A sessão que FALHA fica, e o `payload` guarda o desfecho de CADA arquivo:
//      é isso que faz `/problem-uploads` dizer QUAL arquivo caiu.
//   6. `meta_pit_id` e `data_prevista` atravessam o rascunho. É o par que em
//      05/08/2026 obrigou a duplicar coluna em `upload_versao_temp`, e é o
//      acoplamento que esta mudança veio tirar.
//
// O volume é um diretório de VERDADE, e os bytes são escritos por este teste no
// lugar do plugin: no caminho do plugin quem copia é o cliente, por SMB, e o
// `confirm-upload` relê o arquivo para conferir o checksum declarado.

const request = require('supertest')
const fs = require('fs').promises
const os = require('os')
const path = require('path')
const crypto = require('crypto')

const { getApp } = require('../helpers/app')
const { conn, cleanTestData } = require('../helpers/db')
const { generateAdminToken, ADMIN_UUID } = require('../helpers/auth')
const { createVolume, createProduto, createVersao } = require('../helpers/fixtures')

let app
let raizVolume

const TIPO_PRODUTO = 4 // Ortoimagem
const SUBTIPO = 4      // Ortoimagem, subtipo do tipo 4
const ANO = 2026

beforeAll(async () => {
  app = await getApp()
  raizVolume = await fs.mkdtemp(path.join(os.tmpdir(), 'sca-upload-ciclo-'))
}, 60000)

afterAll(async () => {
  await fs.rm(raizVolume, { recursive: true, force: true })
})

afterEach(async () => {
  await cleanTestData()
  await fs.rm(raizVolume, { recursive: true, force: true })
  await fs.mkdir(raizVolume, { recursive: true })
})

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex')

const token = () => generateAdminToken()

/** Volume primário do tipo de produto, apontando para a raiz temporária. */
const volumePrimario = async () => {
  const volume = await createVolume({
    nome: 'Volume Ciclo',
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

/** Um item de meta do PIT, para provar que o vínculo atravessa o rascunho. */
const itemDoPit = async () => {
  await conn.none(
    `INSERT INTO pit.pit (ano, usuario_cadastramento_uuid)
     VALUES ($1, $2) ON CONFLICT (ano) DO NOTHING`,
    [ANO, ADMIN_UUID]
  )
  const meta = await conn.one(
    `INSERT INTO pit.meta (ano, numero_meta, nome, usuario_cadastramento_uuid)
     VALUES ($1, 1, 'Producao de Geoinformacao', $2) RETURNING id`,
    [ANO, ADMIN_UUID]
  )
  return conn.one(
    `INSERT INTO pit.meta_item (meta_id, item, unidade_id, usuario_cadastramento_uuid)
     VALUES ($1, '1.1', 1, $2) RETURNING id`,
    [meta.id, ADMIN_UUID]
  )
}

const arquivoDeclarado = (conteudo, overrides = {}) => ({
  nome: 'Ortoimagem',
  nome_arquivo: 'ORTO_ciclo',
  tipo_arquivo_id: 1,
  extensao: 'tif',
  tamanho_mb: conteudo.length / (1024 * 1024),
  checksum: sha256(conteudo),
  situacao_carregamento_id: 1,
  ...overrides
})

const versaoDeclarada = (overrides = {}) => ({
  versao: '1-DSG',
  nome: 'Primeira edição',
  tipo_versao_id: 1,
  subtipo_produto_id: SUBTIPO,
  lote_id: null,
  orgao_produtor: 'DSG',
  descricao: 'Versão do ciclo',
  palavras_chave: ['ciclo', 'teste'],
  data_criacao: '2026-01-10',
  data_edicao: '2026-02-10',
  ...overrides
})

const produtoDeclarado = (overrides = {}) => ({
  nome: 'Ortoimagem Ciclo',
  mi: '2965-2',
  inom: 'SH-22-Y-A-I-2',
  tipo_escala_id: 1,
  denominador_escala_especial: null,
  tipo_produto_id: TIPO_PRODUTO,
  subtipo_produto_id: null,
  descricao: 'Produto do ciclo',
  geom: 'SRID=4674;POLYGON((-50 -15, -49 -15, -49 -14, -50 -14, -50 -15))',
  ...overrides
})

const preparar = (rota, body) =>
  request(app).post(`/api/arquivo/${rota}`).set('Authorization', token()).send(body)

const confirmar = (sessionUuid) =>
  request(app)
    .post('/api/arquivo/confirm-upload')
    .set('Authorization', token())
    .send({ session_uuid: sessionUuid })

const cancelar = (sessionUuid) =>
  request(app)
    .post('/api/arquivo/cancel-upload')
    .set('Authorization', token())
    .send({ session_uuid: sessionUuid })

/** O plugin copiaria os bytes por SMB. Aqui o teste faz o papel dele. */
const copiarBytes = (destino, conteudo) => fs.writeFile(destino, conteudo)

const sessoes = () => conn.any('SELECT * FROM acervo.upload_session')

// ---------------------------------------------------------------------------

describe('add_product: rascunho em JSONB, do prepare ao confirm', () => {
  const corpo = (conteudo, extras = {}) => ({
    produtos: [{
      produto: produtoDeclarado(),
      versoes: [{ ...versaoDeclarada(extras), arquivos: [arquivoDeclarado(conteudo)] }]
    }]
  })

  it('o prepare grava a árvore inteira no payload, e não em tabela espelho', async () => {
    await volumePrimario()
    const conteudo = Buffer.from('bytes do produto novo')

    const preparo = await preparar('prepare-upload/product', corpo(conteudo))
    expect(preparo.status).toBe(200)

    const [sessao] = await sessoes()
    expect(sessao.status).toBe('pending')
    expect(sessao.operation_type).toBe('add_product')

    // A PROVA que reprova o desenho anterior: com três tabelas espelho, o
    // `payload` ficaria no default `{}` e este acesso seria undefined.
    const produto = sessao.payload.produtos[0]
    expect(produto.mi).toBe('2965-2')
    expect(produto.tipo_produto_id).toBe(TIPO_PRODUTO)

    const versao = produto.versoes[0]
    expect(versao.versao).toBe('1-DSG')
    expect(versao.subtipo_produto_id).toBe(SUBTIPO)
    // As datas atravessam em TEXTO. Convertê-las para Date faria AAAA-MM-DD
    // virar instante UTC e recuar um dia, que é o defeito que o `.raw()` do Joi
    // existe para impedir.
    expect(versao.data_edicao).toBe('2026-02-10')

    const arquivo = versao.arquivos[0]
    expect(arquivo.expected_checksum).toBe(sha256(conteudo))
    expect(arquivo.status).toBe('pending')
    expect(arquivo.destination_path).toContain('ORTO_ciclo.tif')

    // As três tabelas espelho não existem mais. Sem esta asserção, o teste
    // passaria mesmo se o prepare continuasse escrevendo nelas em paralelo.
    const espelhos = await conn.any(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'acervo'
        AND table_name IN ('upload_produto_temp', 'upload_versao_temp', 'upload_arquivo_temp')
    `)
    expect(espelhos).toHaveLength(0)
  })

  it('o confirm cria produto, versão e arquivo com o que foi declarado', async () => {
    await volumePrimario()
    const conteudo = Buffer.from('bytes do produto novo, conferidos')

    const preparo = await preparar('prepare-upload/product', corpo(conteudo))
    const destino = preparo.body.dados.produtos[0].versoes[0].arquivos[0].destination_path
    await copiarBytes(destino, conteudo)

    const res = await confirmar(preparo.body.dados.session_uuid)
    expect(res.status).toBe(200)
    expect(res.body.dados.status).toBe('completed')

    const produto = await conn.one('SELECT * FROM acervo.produto')
    expect(produto.mi).toBe('2965-2')
    expect(produto.tipo_produto_id).toBe(TIPO_PRODUTO)

    const versao = await conn.one('SELECT * FROM acervo.versao')
    expect(versao.produto_id).toBe(produto.id)
    expect(versao.versao).toBe('1-DSG')
    expect(versao.orgao_produtor).toBe('DSG')
    expect(versao.palavras_chave).toEqual(['ciclo', 'teste'])

    const arquivo = await conn.one('SELECT * FROM acervo.arquivo')
    expect(arquivo.versao_id).toBe(versao.id)
    expect(arquivo.checksum).toBe(sha256(conteudo))
    // O tamanho gravado é o MEDIDO na releitura, e não o declarado.
    expect(Number(arquivo.tamanho_mb)).toBeCloseTo(conteudo.length / (1024 * 1024), 6)

    // Os ids da resposta são os do ACERVO.
    expect(res.body.dados.produtos[0].produto_id).toBe(produto.id)
    expect(res.body.dados.produtos[0].versoes[0].versao_id).toBe(versao.id)
  })

  // O CORAÇÃO DA MUDANÇA. Este caso REPROVA o desenho anterior, em que a sessão
  // virava 'completed' e ficava na tabela.
  it('a sessão SOME no confirm', async () => {
    await volumePrimario()
    const conteudo = Buffer.from('bytes que fecham a sessão')

    const preparo = await preparar('prepare-upload/product', corpo(conteudo))
    await copiarBytes(
      preparo.body.dados.produtos[0].versoes[0].arquivos[0].destination_path,
      conteudo
    )
    expect(await sessoes()).toHaveLength(1)

    await confirmar(preparo.body.dados.session_uuid)

    expect(await sessoes()).toHaveLength(0)
  })

  // ATOMICIDADE, e ela só se prova com uma falha que estoure DEPOIS do primeiro
  // INSERT. O gatilho `acervo.validate_version` recusa versão de subtipo 24
  // (Carta Topográfica Militar, `define_produto = true`) em produto de subtipo
  // nulo, e nenhum check do prepare cobre isso: o produto já entrou quando a
  // exceção sai. Ou tudo entra e a sessão some, ou nada entra e a sessão fica.
  it('falha no meio não grava acervo pela metade nem apaga a sessão', async () => {
    await volumePrimario()
    const conteudo = Buffer.from('bytes de um envio que vai falhar')

    const preparo = await preparar(
      'prepare-upload/product',
      corpo(conteudo, { subtipo_produto_id: 24 })
    )
    expect(preparo.status).toBe(200)

    await copiarBytes(
      preparo.body.dados.produtos[0].versoes[0].arquivos[0].destination_path,
      conteudo
    )

    const res = await confirmar(preparo.body.dados.session_uuid)
    expect(res.status).toBeGreaterThanOrEqual(400)

    // Nada entrou: o rollback levou o produto junto.
    expect(await conn.any('SELECT id FROM acervo.produto')).toHaveLength(0)
    expect(await conn.any('SELECT id FROM acervo.versao')).toHaveLength(0)
    expect(await conn.any('SELECT id FROM acervo.arquivo')).toHaveLength(0)

    // E a sessão FICOU, marcada como falha: é ela que explica o que aconteceu.
    const [sessao] = await sessoes()
    expect(sessao.status).toBe('failed')
    expect(sessao.error_message).toContain('Subtipo 24')
  })

  it('o cancelamento também apaga a sessão', async () => {
    await volumePrimario()
    const conteudo = Buffer.from('bytes de um envio desistido')

    const preparo = await preparar('prepare-upload/product', corpo(conteudo))
    expect(await sessoes()).toHaveLength(1)

    const res = await cancelar(preparo.body.dados.session_uuid)
    expect(res.status).toBe(200)

    expect(await sessoes()).toHaveLength(0)
    // Cancelar não inventa acervo.
    expect(await conn.any('SELECT id FROM acervo.produto')).toHaveLength(0)
  })
})

describe('add_version: versão nova em produto que já existe', () => {
  it('atravessa o rascunho e nasce ligada ao produto certo', async () => {
    await volumePrimario()
    const produto = await createProduto({ tipo_produto_id: TIPO_PRODUTO })
    const conteudo = Buffer.from('bytes da versão nova')

    const preparo = await preparar('prepare-upload/version', {
      versoes: [{
        produto_id: produto.id,
        versao: versaoDeclarada(),
        arquivos: [arquivoDeclarado(conteudo)]
      }]
    })
    expect(preparo.status).toBe(200)

    const [sessao] = await sessoes()
    expect(sessao.payload.versoes[0].produto_id).toBe(Number(produto.id))

    await copiarBytes(
      preparo.body.dados.versoes[0].arquivos[0].destination_path,
      conteudo
    )
    const res = await confirmar(preparo.body.dados.session_uuid)
    expect(res.body.dados.status).toBe('completed')

    const versao = await conn.one('SELECT * FROM acervo.versao')
    expect(versao.produto_id).toBe(produto.id)
    expect(res.body.dados.versoes[0].versao_id).toBe(versao.id)
    expect(await sessoes()).toHaveLength(0)
  })

  // O PAR QUE MOTIVOU A MUDANÇA. Em 05/08/2026 `meta_pit_id` e `data_prevista`
  // precisaram atravessar a cadeia e obrigaram a duplicar coluna em
  // `upload_versao_temp`. Com o rascunho como documento, eles atravessam sem que
  // nada no meio precise saber deles.
  it('meta_pit_id e data_prevista atravessam o rascunho até acervo.versao', async () => {
    await volumePrimario()
    const produto = await createProduto({ tipo_produto_id: TIPO_PRODUTO })
    const item = await itemDoPit()
    const conteudo = Buffer.from('bytes de uma versão com meta do PIT')

    const preparo = await preparar('prepare-upload/version', {
      versoes: [{
        produto_id: produto.id,
        versao: versaoDeclarada({
          meta_pit_id: Number(item.id),
          data_prevista: '2026-12-31'
        }),
        arquivos: [arquivoDeclarado(conteudo)]
      }]
    })
    expect(preparo.status).toBe(200)

    const [sessao] = await sessoes()
    expect(Number(sessao.payload.versoes[0].meta_pit_id)).toBe(Number(item.id))
    expect(sessao.payload.versoes[0].data_prevista).toBe('2026-12-31')

    await copiarBytes(
      preparo.body.dados.versoes[0].arquivos[0].destination_path,
      conteudo
    )
    await confirmar(preparo.body.dados.session_uuid)

    const versao = await conn.one(
      'SELECT meta_pit_id, data_prevista::text AS data_prevista FROM acervo.versao'
    )
    expect(Number(versao.meta_pit_id)).toBe(Number(item.id))
    expect(versao.data_prevista).toBe('2026-12-31')
  })
})

describe('add_files: arquivos numa versão que já existe', () => {
  it('grava o arquivo na versão declarada e fecha a sessão', async () => {
    await volumePrimario()
    const produto = await createProduto({ tipo_produto_id: TIPO_PRODUTO })
    const versao = await createVersao(produto.id, { subtipo_produto_id: SUBTIPO })
    const conteudo = Buffer.from('bytes acrescentados a uma versão existente')

    const preparo = await preparar('prepare-upload/files', {
      arquivos: [{ ...arquivoDeclarado(conteudo), versao_id: versao.id }]
    })
    expect(preparo.status).toBe(200)

    const [sessao] = await sessoes()
    expect(sessao.payload.arquivos[0].versao_id).toBe(Number(versao.id))

    await copiarBytes(preparo.body.dados.arquivos[0].destination_path, conteudo)
    const res = await confirmar(preparo.body.dados.session_uuid)
    expect(res.body.dados.status).toBe('completed')
    expect(res.body.dados.versoes[0].versao_id).toBe(versao.id)

    const arquivo = await conn.one('SELECT * FROM acervo.arquivo')
    expect(arquivo.versao_id).toBe(versao.id)
    expect(arquivo.checksum).toBe(sha256(conteudo))
    expect(await sessoes()).toHaveLength(0)
  })
})

describe('replace_files: troca o conteúdo do arquivo no lugar', () => {
  it('apaga o antigo, insere o novo e fecha a sessão', async () => {
    await volumePrimario()
    const produto = await createProduto({ tipo_produto_id: TIPO_PRODUTO })
    const versao = await createVersao(produto.id, { subtipo_produto_id: SUBTIPO })

    const antigo = Buffer.from('conteudo velho')
    const primeiro = await preparar('prepare-upload/files', {
      arquivos: [{ ...arquivoDeclarado(antigo), versao_id: versao.id }]
    })
    await copiarBytes(primeiro.body.dados.arquivos[0].destination_path, antigo)
    await confirmar(primeiro.body.dados.session_uuid)

    const novo = Buffer.from('conteudo novo, recomprimido')
    const segundo = await preparar('prepare-upload/replace-files', {
      arquivos: [{ ...arquivoDeclarado(novo), versao_id: versao.id }]
    })
    await copiarBytes(segundo.body.dados.arquivos[0].destination_path, novo)
    const res = await confirmar(segundo.body.dados.session_uuid)
    expect(res.body.dados.status).toBe('completed')

    // Um arquivo no slot, com o checksum NOVO, e o antigo na lápide.
    const arquivo = await conn.one('SELECT * FROM acervo.arquivo')
    expect(arquivo.checksum).toBe(sha256(novo))
    const deletado = await conn.one('SELECT checksum FROM acervo.arquivo_deletado')
    expect(deletado.checksum).toBe(sha256(antigo))

    expect(await sessoes()).toHaveLength(0)
  })
})

describe('a sessão que falha guarda o desfecho de CADA arquivo', () => {
  // Dois arquivos, e SÓ UM quebrado. Com um só, uma implementação que marcasse
  // todos como falhos passaria igual.
  it('marca só o arquivo que reprovou, e /problem-uploads o mostra', async () => {
    await volumePrimario()
    const produto = await createProduto({ tipo_produto_id: TIPO_PRODUTO })
    const versao = await createVersao(produto.id, { subtipo_produto_id: SUBTIPO })

    const bom = Buffer.from('este chegou inteiro')
    const ruim = Buffer.from('este foi truncado no caminho')

    const preparo = await preparar('prepare-upload/files', {
      arquivos: [
        { ...arquivoDeclarado(bom, { nome: 'Bom', nome_arquivo: 'ORTO_bom' }), versao_id: versao.id },
        { ...arquivoDeclarado(ruim, { nome: 'Ruim', nome_arquivo: 'ORTO_ruim' }), versao_id: versao.id }
      ]
    })
    expect(preparo.status).toBe(200)

    const destinos = preparo.body.dados.arquivos
    await copiarBytes(destinos[0].destination_path, bom)
    // O segundo chega truncado: é o que a releitura do checksum existe para pegar.
    await copiarBytes(destinos[1].destination_path, Buffer.from('meta'))

    const res = await confirmar(preparo.body.dados.session_uuid)
    expect(res.body.dados.status).toBe('failed')

    // Nada entrou no acervo: o envio é indivisível.
    expect(await conn.any('SELECT id FROM acervo.arquivo')).toHaveLength(0)

    // O RASCUNHO GUARDOU O DESFECHO POR ARQUIVO. Sem isto, a tela de problemas
    // só saberia que a sessão falhou.
    const [sessao] = await sessoes()
    expect(sessao.status).toBe('failed')
    const porNome = Object.fromEntries(
      sessao.payload.arquivos.map(a => [a.nome, a])
    )
    expect(porNome.Bom.status).toBe('completed')
    expect(porNome.Ruim.status).toBe('failed')
    expect(porNome.Ruim.error_message).toContain('checksum')

    const problemas = await request(app)
      .get('/api/arquivo/problem-uploads')
      .set('Authorization', token())

    expect(problemas.status).toBe(200)
    const [detalhe] = problemas.body.dados
    expect(detalhe.operation_type).toBe('add_files')
    expect(detalhe.versoes_com_problema).toHaveLength(1)
    expect(detalhe.versoes_com_problema[0].versao_id).toBe(Number(versao.id))

    const nomes = detalhe.versoes_com_problema[0].arquivos_com_problema.map(a => a.nome)
    expect(nomes).toEqual(['Ruim'])
  })
})

describe('POST /api/arquivo/cleanup-expired-uploads', () => {
  const limpar = () => request(app)
    .post('/api/arquivo/cleanup-expired-uploads')
    .set('Authorization', token())

  const criarSessao = (expiracaoSql, status) => conn.one(
    `INSERT INTO acervo.upload_session
       (operation_type, status, expiration_time, usuario_uuid, payload)
     VALUES ('add_files', $2, ${expiracaoSql}, $1, '{}'::jsonb)
     RETURNING id`,
    [ADMIN_UUID, status]
  )

  it('devolve QUANTAS fechou e QUANTAS apagou, e não só "sucesso"', async () => {
    await criarSessao("NOW() - INTERVAL '1 hour'", 'pending')
    await criarSessao("NOW() - INTERVAL '40 days'", 'completed')
    const viva = await criarSessao("NOW() + INTERVAL '12 hours'", 'pending')

    const res = await limpar()

    expect(res.status).toBe(200)
    expect(res.body.dados).toEqual({ fechadas: 1, apagadas: 1 })
    expect(res.body.message).toContain('1')

    // A que está no prazo continua pendente: a contagem não é o total da tabela.
    const restante = await conn.one(
      'SELECT status FROM acervo.upload_session WHERE id = $1', [viva.id]
    )
    expect(restante.status).toBe('pending')
  })

  it('registra QUEM mandou rodar', async () => {
    await criarSessao("NOW() - INTERVAL '1 hour'", 'pending')

    await limpar()

    const eventos = await conn.any(
      "SELECT usuario_uuid, dados_depois FROM auditoria.evento WHERE tabela = 'acervo.upload_expirado'"
    )
    expect(eventos).toHaveLength(1)
    expect(eventos[0].usuario_uuid).toBe(ADMIN_UUID)
    expect(eventos[0].dados_depois).toEqual({ fechadas: 1, apagadas: 0 })

    await conn.none("DELETE FROM auditoria.evento WHERE tabela = 'acervo.upload_expirado'")
  })

  it('exige administrador', async () => {
    const res = await request(app)
      .post('/api/arquivo/cleanup-expired-uploads')
      .set('Authorization', require('../helpers/auth').generateUserToken())

    expect(res.status).toBe(403)
  })
})
