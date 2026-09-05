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
const { generateAdminToken, generateToken, ADMIN_UUID } = require('../helpers/auth')
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

const renovar = (sessionUuid, tk = token()) =>
  request(app)
    .post('/api/arquivo/renovar-upload')
    .set('Authorization', tk)
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

// O PREPARE RESERVA O DESTINO, e a reserva vale entre sessões.
//
// A linha de `acervo.arquivo` só nasce no confirm: enquanto a conferência de
// nome físico olhava SÓ aquela tabela, dois operadores preparando o mesmo
// arquivo recebiam 200 com o MESMO `destination_path`, copiavam por SMB para o
// mesmo caminho e o segundo sobrescrevia os bytes do primeiro sem aviso. O
// comentário do controlador prometia "impede colisão de nome físico no volume
// (sobrescrita silenciosa)" e não entregava.
describe('a reserva do prepare-upload vale entre sessões abertas', () => {
  it('o segundo prepare do mesmo nome físico é recusado com 409', async () => {
    await volumePrimario()
    const produto = await createProduto({ tipo_produto_id: TIPO_PRODUTO })
    const versao = await createVersao(produto.id, { subtipo_produto_id: SUBTIPO })
    const conteudo = Buffer.from('bytes disputados')

    const primeiro = await preparar('prepare-upload/files', {
      arquivos: [{ ...arquivoDeclarado(conteudo), versao_id: versao.id }]
    })
    expect(primeiro.status).toBe(200)

    const segundo = await preparar('prepare-upload/files', {
      arquivos: [{ ...arquivoDeclarado(conteudo), versao_id: versao.id }]
    })
    expect(segundo.status).toBe(409)
    // A mensagem nomeia a sessão que já reservou, para quem tomou o 409 saber
    // com quem falar (ou o que cancelar).
    expect(segundo.body.message).toContain(primeiro.body.dados.session_uuid)

    // Uma sessão só reservou: o segundo prepare não deixou rascunho para trás.
    expect(await sessoes()).toHaveLength(1)
  })

  it('cancelada a primeira sessão, o mesmo nome físico volta a ser aceito', async () => {
    await volumePrimario()
    const produto = await createProduto({ tipo_produto_id: TIPO_PRODUTO })
    const versao = await createVersao(produto.id, { subtipo_produto_id: SUBTIPO })
    const conteudo = Buffer.from('bytes disputados')

    const primeiro = await preparar('prepare-upload/files', {
      arquivos: [{ ...arquivoDeclarado(conteudo), versao_id: versao.id }]
    })
    await cancelar(primeiro.body.dados.session_uuid)

    // CONTROLE POSITIVO: sem ele, uma guarda que recusasse SEMPRE passaria no
    // caso acima.
    const segundo = await preparar('prepare-upload/files', {
      arquivos: [{ ...arquivoDeclarado(conteudo), versao_id: versao.id }]
    })
    expect(segundo.status).toBe(200)
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

// O OPERADOR VE AS SESSOES DELE, e nao as de todo mundo.
//
// `problem-uploads` e `upload-sessions` nao filtravam por usuario e as rotas
// pedem so perfil `operador`: qualquer operador do acervo via o nome de quem
// enviou, o tipo da operacao e, no `problem-uploads`, o RASCUNHO INTEIRO do
// envio alheio (nome de arquivo, produto, versao). Pela regua do sistema, "ver
// tudo da area" e do GERENTE.
describe('o recorte por usuario nas listas de sessao', () => {
  /** Um usuario com perfil no ACERVO (modulo 1) no nivel pedido. */
  const criaUsuarioDoAcervo = async (login, uuid, perfilId) => {
    const row = await conn.one(
      `INSERT INTO dgeo.usuario
         (login, nome, nome_guerra, tipo_posto_grad_id, administrador, ativo, uuid)
       VALUES ($<login>, $<login>, $<login>, 1, FALSE, TRUE, $<uuid>)
       RETURNING id`,
      { login, uuid }
    )
    await conn.none(
      'INSERT INTO dgeo.usuario_perfil (usuario_id, modulo_id, perfil_id) VALUES ($1, 1, $2)',
      [row.id, perfilId]
    )
    return generateToken({ id: Number(row.id), uuid, administrador: false })
  }

  const listar = (caminho, tk) =>
    request(app).get(`/api/arquivo/${caminho}`).set('Authorization', tk)

  it('o operador B nao ve a sessao aberta pelo operador A', async () => {
    await volumePrimario()
    const produto = await createProduto({ tipo_produto_id: TIPO_PRODUTO })
    const versao = await createVersao(produto.id, { subtipo_produto_id: SUBTIPO })

    const tokenA = await criaUsuarioDoAcervo(
      'op_acervo_a', 'd1eebc99-9c0b-4ef8-bb6d-6bb9bd380a41', 2)
    const tokenB = await criaUsuarioDoAcervo(
      'op_acervo_b', 'd1eebc99-9c0b-4ef8-bb6d-6bb9bd380a42', 2)

    const preparo = await request(app)
      .post('/api/arquivo/prepare-upload/files')
      .set('Authorization', tokenA)
      .send({
        arquivos: [{
          ...arquivoDeclarado(Buffer.from('bytes do A')),
          versao_id: versao.id
        }]
      })
    expect(preparo.status).toBe(200)
    const uuidSessao = preparo.body.dados.session_uuid

    const doA = await listar('upload-sessions', tokenA)
    expect(doA.body.dados.map(x => x.uuid_session)).toContain(uuidSessao)

    const doB = await listar('upload-sessions', tokenB)
    expect(doB.body.dados.map(x => x.uuid_session)).not.toContain(uuidSessao)
  })

  it('o gerente do acervo continua vendo a sessao de todo mundo', async () => {
    await volumePrimario()
    const produto = await createProduto({ tipo_produto_id: TIPO_PRODUTO })
    const versao = await createVersao(produto.id, { subtipo_produto_id: SUBTIPO })

    const tokenA = await criaUsuarioDoAcervo(
      'op_acervo_c', 'd1eebc99-9c0b-4ef8-bb6d-6bb9bd380a43', 2)
    const tokenGerente = await criaUsuarioDoAcervo(
      'ger_acervo', 'd1eebc99-9c0b-4ef8-bb6d-6bb9bd380a44', 3)

    const preparo = await request(app)
      .post('/api/arquivo/prepare-upload/files')
      .set('Authorization', tokenA)
      .send({
        arquivos: [{
          ...arquivoDeclarado(Buffer.from('bytes do C')),
          versao_id: versao.id
        }]
      })
    const uuidSessao = preparo.body.dados.session_uuid

    const doGerente = await listar('upload-sessions', tokenGerente)
    expect(doGerente.body.dados.map(x => x.uuid_session)).toContain(uuidSessao)

    // E o administrador tambem.
    const doAdmin = await listar('upload-sessions', token())
    expect(doAdmin.body.dados.map(x => x.uuid_session)).toContain(uuidSessao)
  })
})

// RENOVAR O PRAZO DA SESSAO, em vez de transferir centenas de GB de novo.
//
// O prazo e de 24 horas contadas do prepare, e quem copia os bytes neste caminho
// e o plugin, por SMB: o proprio codigo registra um lote de 362 GB que levou de
// 1h20 a 3h em condicao boa. Ate 2026-09-05 vencer o prazo custava a
// transferencia INTEIRA -- o confirm respondia 400 mandando refazer o prepare e
// copiar tudo outra vez, e o byte ja copiado virava lixo orfao no volume, que
// (como o proprio `cancelUpload` documenta) HOJE NINGUEM RECOLHE.
//
// O QUE ESTE BLOCO PRENDE, e o quarto caso e a razao de a rota existir:
//
//   1. o dono renova, e o prazo anda para a frente;
//   2. sessao de OUTRA pessoa responde 403, como no cancel-upload;
//   3. sessao que nao existe responde 404;
//   4. a sessao que o confirm ja fechou POR VENCIMENTO se renova, e o confirm
//      seguinte GRAVA O ACERVO com os MESMOS bytes que estavam la. Sem este
//      caso a rota poderia aceitar so `pending` e continuar verde -- e seria
//      inutil, porque quem descobre o vencimento e o confirm, e ele fecha a
//      sessao antes de responder o 400 que manda renovar.
describe('POST /api/arquivo/renovar-upload', () => {
  /** Um operador (perfil 2) do ACERVO (modulo 1). */
  const criaOperador = async (login, uuid) => {
    const row = await conn.one(
      `INSERT INTO dgeo.usuario
         (login, nome, nome_guerra, tipo_posto_grad_id, administrador, ativo, uuid)
       VALUES ($<login>, $<login>, $<login>, 1, FALSE, TRUE, $<uuid>)
       RETURNING id`,
      { login, uuid }
    )
    await conn.none(
      'INSERT INTO dgeo.usuario_perfil (usuario_id, modulo_id, perfil_id) VALUES ($1, 1, 2)',
      [row.id]
    )
    return generateToken({ id: Number(row.id), uuid, administrador: false })
  }

  /** Um prepare de arquivos pronto para confirmar, com os bytes ja copiados. */
  const prepararComBytes = async (tk = token()) => {
    await volumePrimario()
    const produto = await createProduto({ tipo_produto_id: TIPO_PRODUTO })
    const versao = await createVersao(produto.id, { subtipo_produto_id: SUBTIPO })
    const conteudo = Buffer.from('bytes que atravessaram o prazo')

    const preparo = await request(app)
      .post('/api/arquivo/prepare-upload/files')
      .set('Authorization', tk)
      .send({
        arquivos: [{ ...arquivoDeclarado(conteudo), versao_id: versao.id }]
      })
    expect(preparo.status).toBe(200)

    await copiarBytes(preparo.body.dados.arquivos[0].destination_path, conteudo)

    return { preparo, versao, conteudo }
  }

  /** Empurra o prazo para o passado, como fariam 25 horas de copia por SMB. */
  const vencer = (uuidSessao) => conn.none(
    `UPDATE acervo.upload_session
        SET expiration_time = NOW() - INTERVAL '1 hour'
      WHERE uuid_session = $1`,
    [uuidSessao]
  )

  const prazoDe = async (uuidSessao) => {
    const linha = await conn.one(
      'SELECT expiration_time FROM acervo.upload_session WHERE uuid_session = $1',
      [uuidSessao]
    )
    return new Date(linha.expiration_time)
  }

  it('o dono renova, e o prazo anda para a frente', async () => {
    const { preparo } = await prepararComBytes()
    const uuidSessao = preparo.body.dados.session_uuid

    await vencer(uuidSessao)
    const antes = await prazoDe(uuidSessao)
    expect(antes.getTime()).toBeLessThan(Date.now())

    const res = await renovar(uuidSessao)

    expect(res.status).toBe(200)
    expect(res.body.dados.session_uuid).toBe(uuidSessao)

    const depois = await prazoDe(uuidSessao)
    expect(depois.getTime()).toBeGreaterThan(Date.now())
    // As mesmas 24 horas que o prepare concede, contadas de agora. A margem e
    // generosa de proposito: o relogio que conta e o do BANCO, e nao o do Node.
    expect(depois.getTime() - Date.now()).toBeGreaterThan(23 * 60 * 60 * 1000)
    expect(depois.getTime() - Date.now()).toBeLessThan(25 * 60 * 60 * 1000)
  })

  it('a sessao de outra pessoa responde 403', async () => {
    const tokenA = await criaOperador('op_renova_a', 'e1eebc99-9c0b-4ef8-bb6d-6bb9bd380a51')
    const tokenB = await criaOperador('op_renova_b', 'e1eebc99-9c0b-4ef8-bb6d-6bb9bd380a52')

    const { preparo } = await prepararComBytes(tokenA)
    const uuidSessao = preparo.body.dados.session_uuid
    const antes = await prazoDe(uuidSessao)

    const res = await renovar(uuidSessao, tokenB)

    expect(res.status).toBe(403)
    // E o prazo NAO andou: a recusa nao pode ter escrito nada.
    const depois = await prazoDe(uuidSessao)
    expect(depois.getTime()).toBe(antes.getTime())
  })

  it('sessao que nao existe responde 404', async () => {
    const res = await renovar('99999999-8888-7777-6666-555555555555')
    expect(res.status).toBe(404)
  })

  // O CASO QUE A ROTA EXISTE PARA RESOLVER, do inicio ao fim.
  it('a sessao vencida e fechada pelo confirm se renova, e o confirm seguinte grava', async () => {
    const { preparo, versao, conteudo } = await prepararComBytes()
    const uuidSessao = preparo.body.dados.session_uuid

    await vencer(uuidSessao)

    // 1. O confirm recusa, e a MENSAGEM diz onde esta a saida.
    const vencido = await confirmar(uuidSessao)
    expect(vencido.status).toBe(400)
    expect(vencido.body.message).toContain('/api/arquivo/renovar-upload')
    expect(vencido.body.message).toMatch(/já copiados continuam valendo/)

    // 2. E ele FECHOU a sessao. E por isso que a renovacao nao pode olhar so
    //    `pending`: quando a mensagem chega, a sessao ja e `failed`.
    const fechada = await conn.one(
      'SELECT status FROM acervo.upload_session WHERE uuid_session = $1', [uuidSessao]
    )
    expect(fechada.status).toBe('failed')

    // 3. Renova.
    const renovacao = await renovar(uuidSessao)
    expect(renovacao.status).toBe(200)

    const reaberta = await conn.one(
      'SELECT status, error_message, payload FROM acervo.upload_session WHERE uuid_session = $1',
      [uuidSessao]
    )
    expect(reaberta.status).toBe('pending')
    expect(reaberta.error_message).toBeNull()
    // O rascunho volta inteiro a `pending`: sessao aberta com arquivo marcado
    // como falho e estado que nenhuma tela sabe ler.
    expect(reaberta.payload.arquivos[0].status).toBe('pending')

    // 4. E o confirm seguinte grava, com os MESMOS bytes que ja estavam la.
    //    Nenhum byte foi copiado de novo entre um confirm e outro.
    const res = await confirmar(uuidSessao)
    expect(res.status).toBe(200)
    expect(res.body.dados.status).toBe('completed')

    const arquivo = await conn.one('SELECT * FROM acervo.arquivo')
    expect(arquivo.versao_id).toBe(versao.id)
    expect(arquivo.checksum).toBe(sha256(conteudo))
    expect(await sessoes()).toHaveLength(0)
  })

  // CONTROLE, e ele separa o RELOGIO do BYTE: a sessao que falhou por checksum
  // nao se renova. Renovar so devolveria o mesmo diagnostico, e a tela de
  // uploads com problema perderia a linha que explica o que aconteceu.
  it('a sessao que falhou por CHECKSUM nao se renova', async () => {
    await volumePrimario()
    const produto = await createProduto({ tipo_produto_id: TIPO_PRODUTO })
    const versao = await createVersao(produto.id, { subtipo_produto_id: SUBTIPO })
    const conteudo = Buffer.from('este chegaria inteiro')

    const preparo = await preparar('prepare-upload/files', {
      arquivos: [{ ...arquivoDeclarado(conteudo), versao_id: versao.id }]
    })
    // Chega truncado: e o que a releitura do checksum existe para pegar.
    await copiarBytes(preparo.body.dados.arquivos[0].destination_path, Buffer.from('meta'))

    const falho = await confirmar(preparo.body.dados.session_uuid)
    expect(falho.body.dados.status).toBe('failed')

    const res = await renovar(preparo.body.dados.session_uuid)
    expect(res.status).toBe(404)

    const sessao = await conn.one(
      'SELECT status FROM acervo.upload_session WHERE uuid_session = $1',
      [preparo.body.dados.session_uuid]
    )
    expect(sessao.status).toBe('failed')
  })
})
