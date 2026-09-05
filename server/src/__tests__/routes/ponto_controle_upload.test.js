'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')

const request = require('supertest')
const { getApp } = require('../helpers/app')
const { conn, cleanTestData } = require('../helpers/db')
const { generateAdminToken, generateUserToken } = require('../helpers/auth')
const { createProjeto, createLote } = require('../helpers/fixtures')

let app
let volumeDir
let volumeId

beforeAll(async () => {
  app = await getApp()
})

// Um volume DE VERDADE no disco. Sem ele o confirm-upload não teria o que
// conferir, e o teste provaria só que a rota devolve 200.
beforeEach(async () => {
  volumeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sca-pc-'))
  const volume = await conn.one(
    `INSERT INTO acervo.volume_armazenamento (nome, volume, capacidade_gb)
     VALUES ('Volume Ponto de Controle', $1, 100) RETURNING id`,
    [volumeDir]
  )
  volumeId = volume.id
  await conn.none(
    `INSERT INTO acervo.volume_tipo_produto
       (tipo_produto_id, volume_armazenamento_id, primario)
     VALUES (10, $1, TRUE)`,
    [volumeId]
  )
})

afterEach(async () => {
  await cleanTestData()
  fs.rmSync(volumeDir, { recursive: true, force: true })
})

// --- Helpers locais ---------------------------------------------------------

const criaLote = async (nome = 'Missão Teste') => {
  const projeto = await createProjeto({ nome: `Projeto ${nome}` })
  return createLote(projeto.id, { nome, pit: 'PIT-PC-1' })
}

const sha256 = conteudo => crypto.createHash('sha256').update(conteudo).digest('hex')

const CONTEUDO_RINEX = Buffer.from('RINEX 3.04 OBSERVATION DATA\nfim\n')
const CONTEUDO_FOTO = Buffer.from('\xff\xd8\xff\xe0 jpeg de mentira')

// tipo 1 = Pacote do ponto, tipo 2 = Monografia. Sao os dois unicos.
const arquivoDe = (conteudo, overrides = {}) => ({
  tipo_arquivo_id: 1,
  nome_arquivo: 'rastreio',
  extensao: 'zip',
  tamanho_mb: conteudo.length / (1024 * 1024),
  checksum: sha256(conteudo),
  ...overrides
})

const pontoDe = (codPonto, arquivos = [], extras = {}) => ({
  cod_ponto: codPonto,
  latitude: -15.5,
  longitude: -47.9,
  atributos: {
    data_rastreio: '2026-05-12',
    tipo_situacao: 3,
    medidor: '3º Sgt Silva',
    altitude_ortometrica: 1024.35,
    ...extras
  },
  arquivos
})

const preparar = (corpo, token = generateAdminToken()) =>
  request(app)
    .post('/api/ponto_controle/prepare-upload/missao')
    .set('Authorization', token)
    .send(corpo)

const confirmar = (sessionUuid, token = generateAdminToken()) =>
  request(app)
    .post('/api/ponto_controle/confirm-upload')
    .set('Authorization', token)
    .send({ session_uuid: sessionUuid })

/** Copia o conteúdo para o caminho que o prepare mandou, criando a pasta. */
const transferir = (destino, conteudo) => {
  fs.mkdirSync(path.dirname(destino), { recursive: true })
  fs.writeFileSync(destino, conteudo)
}

const contarPontos = async () =>
  (await conn.one('SELECT COUNT(*)::int AS n FROM ponto_controle.ponto')).n

// --- Fase 1 -----------------------------------------------------------------

describe('Ponto de controle - preparar a importação', () => {
  it('devolve o caminho de cada arquivo e NÃO grava ponto nenhum', async () => {
    const lote = await criaLote()

    const res = await preparar({
      lote_id: lote.id,
      pontos: [
        pontoDe('RJ-HV-1', [arquivoDe(CONTEUDO_RINEX)]),
        pontoDe('RJ-HV-2', [])
      ]
    })

    expect(res.status).toBe(201)
    expect(res.body.dados.session_uuid).toBeTruthy()
    expect(res.body.dados.pontos_novos).toEqual(['RJ-HV-1', 'RJ-HV-2'])
    expect(res.body.dados.arquivos).toHaveLength(1)

    // Uma pasta por ponto: sem isso `foto_1.jpg` de dois pontos ocuparia o
    // mesmo caminho no volume.
    expect(res.body.dados.arquivos[0].destination_path).toBe(
      path.join(volumeDir, 'RJ-HV-1', 'rastreio.zip')
    )

    // O preparo é reserva, não gravação.
    expect(await contarPontos()).toBe(0)
    const temp = await conn.one(
      'SELECT COUNT(*)::int AS n FROM ponto_controle.upload_ponto_temp'
    )
    expect(temp.n).toBe(2)
  })

  it('escolhe o volume pelo tipo de produto, e não deixa o cliente escolher', async () => {
    const lote = await criaLote()
    const outroVolume = await conn.one(
      `INSERT INTO acervo.volume_armazenamento (nome, volume, capacidade_gb)
       VALUES ('Volume Alheio', '/data/alheio', 10) RETURNING id`
    )

    const res = await preparar({
      lote_id: lote.id,
      pontos: [
        pontoDe('RJ-HV-1', [
          arquivoDe(CONTEUDO_RINEX, { volume_armazenamento_id: outroVolume.id })
        ])
      ]
    })

    expect(res.status).toBe(201)
    // O campo foi descartado pelo stripUnknown, e o destino é o volume do
    // tipo 10. Aceitá-lo seria deixar quem importa escrever onde quisesse.
    expect(res.body.dados.arquivos[0].destination_path.startsWith(volumeDir)).toBe(true)
  })

  it('recusa a missão sem volume primário cadastrado', async () => {
    const lote = await criaLote()
    await conn.none('DELETE FROM acervo.volume_tipo_produto WHERE tipo_produto_id = 10')

    const res = await preparar({
      lote_id: lote.id,
      pontos: [pontoDe('RJ-HV-1', [arquivoDe(CONTEUDO_RINEX)])]
    })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/volume primário/i)
  })

  it('faz valer o maximo_por_ponto do domínio', async () => {
    const lote = await criaLote()

    // Com dois tipos, o maximo_por_ponto = 1 deixa de ser teto e vira regra
    // exata: um pacote e uma monografia, nunca dois de cada.
    const res = await preparar({
      lote_id: lote.id,
      pontos: [
        pontoDe('RJ-HV-1', [
          arquivoDe(CONTEUDO_FOTO, { nome_arquivo: 'pacote_a', extensao: 'zip' }),
          arquivoDe(CONTEUDO_RINEX, { nome_arquivo: 'pacote_b', extensao: 'zip' })
        ])
      ]
    })

    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/Pacote do ponto.*máximo é 1/i)
    expect(await contarPontos()).toBe(0)
  })

  it('recusa cod_ponto repetido dentro do próprio pacote', async () => {
    const lote = await criaLote()
    const res = await preparar({
      lote_id: lote.id,
      pontos: [pontoDe('RJ-HV-1'), pontoDe('RJ-HV-1')]
    })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/mais de uma vez/i)
  })

  it('recusa dois arquivos do mesmo ponto indo para o mesmo caminho', async () => {
    const lote = await criaLote()
    const res = await preparar({
      lote_id: lote.id,
      pontos: [
        pontoDe('RJ-HV-1', [
          arquivoDe(CONTEUDO_RINEX),
          arquivoDe(CONTEUDO_FOTO, { tipo_arquivo_id: 2 })
        ])
      ]
    })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/mesmo caminho/i)
  })

  it('recusa tipo de arquivo que não existe', async () => {
    const lote = await criaLote()
    const res = await preparar({
      lote_id: lote.id,
      pontos: [pontoDe('RJ-HV-1', [arquivoDe(CONTEUDO_RINEX, { tipo_arquivo_id: 77 })])]
    })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/Tipo de arquivo 77/i)
  })

  it('relata a coluna que a tabela não tem, em vez de descartá-la calada', async () => {
    const lote = await criaLote()
    const res = await preparar({
      lote_id: lote.id,
      pontos: [pontoDe('RJ-HV-1', [], { medidorr: 'erro de digitação' })]
    })
    expect(res.body.dados.colunas_ignoradas).toEqual(['medidorr'])
  })
})

// --- Fase 2 -----------------------------------------------------------------

describe('Ponto de controle - confirmar a importação', () => {
  it('lê os arquivos no volume, confere o checksum e grava', async () => {
    const lote = await criaLote()
    const prep = await preparar({
      lote_id: lote.id,
      pontos: [
        pontoDe('RJ-HV-1', [
          arquivoDe(CONTEUDO_RINEX),
          arquivoDe(CONTEUDO_FOTO, {
            tipo_arquivo_id: 2, nome_arquivo: 'monografia', extensao: 'pdf'
          })
        ])
      ]
    })

    for (const arquivo of prep.body.dados.arquivos) {
      transferir(
        arquivo.destination_path,
        arquivo.extensao === 'pdf' ? CONTEUDO_FOTO : CONTEUDO_RINEX
      )
    }

    const res = await confirmar(prep.body.dados.session_uuid)
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.dados.status).toBe('completed')
    expect(res.body.dados.inseridos).toEqual(['RJ-HV-1'])
    expect(res.body.dados.arquivos_novos).toBe(2)

    const ponto = await conn.one(
      `SELECT p.cod_ponto, p.lote_id, p.medidor, p.tipo_situacao,
              ST_X(p.geom) AS lon, ST_Y(p.geom) AS lat
       FROM ponto_controle.ponto AS p WHERE p.cod_ponto = 'RJ-HV-1'`
    )
    expect(ponto.lote_id).toBe(String(lote.id))
    expect(ponto.medidor).toBe('3º Sgt Silva')
    expect(Number(ponto.lon)).toBeCloseTo(-47.9, 6)

    // O tamanho gravado é o MEDIDO no disco, e não o que o manifesto declarou.
    const arquivos = await conn.any(
      `SELECT a.nome_arquivo, a.tamanho_mb, a.checksum, a.volume_armazenamento_id
       FROM ponto_controle.arquivo AS a ORDER BY a.nome_arquivo`
    )
    expect(arquivos).toHaveLength(2)
    expect(arquivos[0].volume_armazenamento_id).toBe(volumeId)
    expect(Number(arquivos[1].tamanho_mb)).toBeCloseTo(
      CONTEUDO_RINEX.length / (1024 * 1024), 8
    )

    const sessao = await conn.one(
      'SELECT status FROM ponto_controle.upload_session'
    )
    expect(sessao.status).toBe('completed')
  })

  it('a GEOMETRIA fica com a posição de dupla precisão, e não com a do atributo', async () => {
    const lote = await criaLote()
    // O plugin manda a posição DUAS vezes: no topo, com a precisão da
    // geometria, e dentro de `atributos`, nas colunas REAL dele. Espalhar
    // `atributos` sobre o objeto sobrescreve a primeira, e a geometria nasce
    // com centímetros de erro.
    const prep = await preparar({
      lote_id: lote.id,
      pontos: [{
        cod_ponto: 'RJ-HV-1',
        latitude: -28.63516511111111,
        longitude: -53.61403358333334,
        atributos: {
          data_rastreio: '2026-05-12',
          // Aprovado, que e a unica situacao que entra no acervo.
          tipo_situacao: 3,
          // O que a coluna REAL do plugin guarda: a mesma posição, truncada.
          latitude: -28.635164,
          longitude: -53.614033
        },
        arquivos: []
      }]
    })
    await confirmar(prep.body.dados.session_uuid)

    const p = await conn.one(
      `SELECT ST_Y(geom) AS lat, ST_X(geom) AS lon, latitude, longitude
       FROM ponto_controle.ponto WHERE cod_ponto = 'RJ-HV-1'`
    )
    // A geometria é a posição autoritativa e guarda double precision.
    expect(Number(p.lat)).toBeCloseTo(-28.63516511111111, 12)
    expect(Number(p.lon)).toBeCloseTo(-53.61403358333334, 12)
    // As colunas REAL do plugin sobrevivem, com a precisão que float4 permite.
    expect(Number(p.latitude)).toBeCloseTo(-28.635164, 5)
  })

  // AS DUAS COISAS SAO DUAS, e o teste vizinho nao conseguia separa-las: la os
  // dois numeros sao o mesmo ponto, e a tolerancia de 5 casas escondia a
  // diferenca. Aqui a coordenada de `atributos` e OUTRA, e o caso mostra que a
  // coluna guarda o que o plugin mandou enquanto a geometria guarda a posicao de
  // dupla precisao da sessao. Enquanto o `ST_MakePoint` lia o mesmo parametro
  // `$<latitude>` que a lista de colunas, a coluna recebia a posicao da SESSAO e
  // o valor do plugin sumia sem erro nenhum.
  it('a COLUNA guarda o atributo do plugin, e a geometria a posição da sessão', async () => {
    const lote = await criaLote()
    const prep = await preparar({
      lote_id: lote.id,
      pontos: [{
        cod_ponto: 'RJ-HV-2',
        latitude: -28.5,
        longitude: -53.5,
        atributos: {
          data_rastreio: '2026-05-12',
          tipo_situacao: 3,
          // Deliberadamente OUTRO ponto, e nao o mesmo truncado.
          latitude: -10.25,
          longitude: -40.75
        },
        arquivos: []
      }]
    })
    await confirmar(prep.body.dados.session_uuid)

    const p = await conn.one(
      `SELECT ST_Y(geom) AS lat, ST_X(geom) AS lon, latitude, longitude
       FROM ponto_controle.ponto WHERE cod_ponto = 'RJ-HV-2'`
    )
    expect(Number(p.lat)).toBeCloseTo(-28.5, 12)
    expect(Number(p.lon)).toBeCloseTo(-53.5, 12)
    expect(Number(p.latitude)).toBeCloseTo(-10.25, 5)
    expect(Number(p.longitude)).toBeCloseTo(-40.75, 5)
  })

  it('o tamanho MEDIDO vence o tamanho declarado', async () => {
    const lote = await criaLote()
    const prep = await preparar({
      lote_id: lote.id,
      pontos: [
        // Declara 999 MB; o arquivo real tem alguns bytes.
        pontoDe('RJ-HV-1', [arquivoDe(CONTEUDO_RINEX, { tamanho_mb: 999 })])
      ]
    })
    transferir(prep.body.dados.arquivos[0].destination_path, CONTEUDO_RINEX)
    await confirmar(prep.body.dados.session_uuid)

    const arquivo = await conn.one('SELECT tamanho_mb FROM ponto_controle.arquivo')
    expect(Number(arquivo.tamanho_mb)).toBeLessThan(1)
  })

  it('checksum que não bate derruba a missão INTEIRA', async () => {
    const lote = await criaLote()
    const prep = await preparar({
      lote_id: lote.id,
      pontos: [
        pontoDe('RJ-HV-1', [arquivoDe(CONTEUDO_RINEX)]),
        pontoDe('RJ-HV-2', [
          arquivoDe(CONTEUDO_FOTO, { nome_arquivo: 'outro', extensao: 'zip' })
        ])
      ]
    })

    // O primeiro chega certo; o segundo chega corrompido.
    const [a1, a2] = prep.body.dados.arquivos
    transferir(a1.destination_path, CONTEUDO_RINEX)
    transferir(a2.destination_path, Buffer.from('conteudo trocado no caminho'))

    // A conferência que reprova devolve 200 com success=false e o relatório,
    // como o confirm-upload do acervo: o valor da resposta é saber QUAL arquivo
    // falhou, e um 400 seco não carrega isso.
    const res = await confirmar(prep.body.dados.session_uuid)
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(false)
    expect(res.body.dados.status).toBe('failed')
    expect(res.body.dados.problemas).toHaveLength(1)
    expect(res.body.dados.problemas[0].nome_arquivo).toBe('outro')
    expect(res.body.dados.problemas[0].erro).toMatch(/Checksum não confere/i)

    // Ponto de controle com metade dos arquivos é pior do que ponto nenhum:
    // parece completo na tela.
    expect(await contarPontos()).toBe(0)

    const sessao = await conn.one(
      'SELECT status, error_message FROM ponto_controle.upload_session'
    )
    expect(sessao.status).toBe('failed')
    expect(sessao.error_message).toMatch(/conferência/i)

    // O motivo por arquivo sobrevive, para saber QUAL falhou.
    const ruim = await conn.one(
      `SELECT status, error_message FROM ponto_controle.upload_arquivo_temp
       WHERE nome_arquivo = 'outro'`
    )
    expect(ruim.status).toBe('failed')
    expect(ruim.error_message).toMatch(/Checksum não confere/i)
  })

  it('arquivo que não chegou ao volume também derruba', async () => {
    const lote = await criaLote()
    const prep = await preparar({
      lote_id: lote.id,
      pontos: [pontoDe('RJ-HV-1', [arquivoDe(CONTEUDO_RINEX)])]
    })

    // Ninguém transferiu nada.
    const res = await confirmar(prep.body.dados.session_uuid)
    expect(res.body.success).toBe(false)
    expect(res.body.dados.problemas[0].erro).toMatch(/não encontrado no volume/i)
    expect(await contarPontos()).toBe(0)

    const arquivo = await conn.one(
      'SELECT error_message FROM ponto_controle.upload_arquivo_temp'
    )
    expect(arquivo.error_message).toMatch(/não encontrado no volume/i)
  })

  it('a mesma sessão não se confirma duas vezes', async () => {
    const lote = await criaLote()
    const prep = await preparar({
      lote_id: lote.id,
      pontos: [pontoDe('RJ-HV-1', [arquivoDe(CONTEUDO_RINEX)])]
    })
    transferir(prep.body.dados.arquivos[0].destination_path, CONTEUDO_RINEX)

    const primeira = await confirmar(prep.body.dados.session_uuid)
    expect(primeira.body.success).toBe(true)

    const segunda = await confirmar(prep.body.dados.session_uuid)
    expect(segunda.status).toBe(404)
    expect(await contarPontos()).toBe(1)
  })

  it('só quem abriu a sessão a confirma', async () => {
    const lote = await criaLote()
    // O usuário comum não tem gerente no acervo, então quem prepara é o admin.
    const prep = await preparar({
      lote_id: lote.id,
      pontos: [pontoDe('RJ-HV-1', [])]
    })

    const alheio = await confirmar(prep.body.dados.session_uuid, generateUserToken())
    // Perfil barra antes da dona da sessão: o usuário comum nem chega lá.
    expect(alheio.status).toBe(403)
    expect(await contarPontos()).toBe(0)
  })

  it('substituir=false recusa ponto que passou a existir entre as duas fases', async () => {
    const lote = await criaLote()

    // Prepara duas sessões para o MESMO código, com o acervo ainda vazio.
    const primeira = await preparar({
      lote_id: lote.id,
      pontos: [pontoDe('RJ-HV-1', [])]
    })
    const segunda = await preparar({
      lote_id: lote.id,
      pontos: [pontoDe('RJ-HV-1', [], { medidor: 'Outro medidor' })]
    })

    expect((await confirmar(primeira.body.dados.session_uuid)).body.success).toBe(true)

    // A segunda foi preparada quando o ponto não existia. Reconferir na hora de
    // gravar é o que impede a sobrescrita silenciosa.
    const res = await confirmar(segunda.body.dados.session_uuid)
    expect(res.status).toBe(409)

    const ponto = await conn.one(
      "SELECT medidor FROM ponto_controle.ponto WHERE cod_ponto = 'RJ-HV-1'"
    )
    expect(ponto.medidor).toBe('3º Sgt Silva')
  })

  it('substituir=true troca o ponto sem duplicá-lo', async () => {
    const lote = await criaLote()
    const primeira = await preparar({
      lote_id: lote.id,
      pontos: [pontoDe('RJ-HV-1', [])]
    })
    await confirmar(primeira.body.dados.session_uuid)

    const segunda = await preparar({
      lote_id: lote.id,
      substituir: true,
      pontos: [pontoDe('RJ-HV-1', [], { medidor: 'Outro medidor' })]
    })
    expect(segunda.body.dados.pontos_substituidos).toEqual(['RJ-HV-1'])

    const res = await confirmar(segunda.body.dados.session_uuid)
    expect(res.body.success).toBe(true)
    expect(res.body.dados.substituidos).toEqual(['RJ-HV-1'])

    const ponto = await conn.one(
      `SELECT medidor, data_modificacao FROM ponto_controle.ponto
       WHERE cod_ponto = 'RJ-HV-1'`
    )
    expect(ponto.medidor).toBe('Outro medidor')
    expect(ponto.data_modificacao).not.toBeNull()
    expect(await contarPontos()).toBe(1)
  })

  it('substituir=true troca os ARQUIVOS, e não acumula a linha velha', async () => {
    // O caso real: refazer a monografia e reenviar o mesmo ponto. O caminho no
    // volume sai do NOME do arquivo, então o novo conteúdo sobrescreve o antigo
    // no disco. Se a linha velha ficasse no banco, o checksum dela passaria a
    // descrever bytes que não existem mais, e o ponto ficaria com dois arquivos
    // de um tipo cujo máximo é um.
    const lote = await criaLote()
    const primeira = await preparar({
      lote_id: lote.id,
      pontos: [
        pontoDe('RJ-HV-1', [
          arquivoDe(CONTEUDO_RINEX, { nome_arquivo: 'RJ-HV-1_pacote', extensao: 'zip' })
        ])
      ]
    })
    for (const a of primeira.body.dados.arquivos) {
      transferir(a.destination_path, CONTEUDO_RINEX)
    }
    await confirmar(primeira.body.dados.session_uuid)

    const CORRIGIDO = Buffer.from('RINEX 3.04 OBSERVATION DATA\ncorrigido\n')
    const segunda = await preparar({
      lote_id: lote.id,
      substituir: true,
      pontos: [
        pontoDe('RJ-HV-1', [
          arquivoDe(CORRIGIDO, { nome_arquivo: 'RJ-HV-1_pacote', extensao: 'zip' })
        ])
      ]
    })
    for (const a of segunda.body.dados.arquivos) {
      transferir(a.destination_path, CORRIGIDO)
    }
    const res = await confirmar(segunda.body.dados.session_uuid)
    expect(res.body.success).toBe(true)

    const arquivos = await conn.any(
      `SELECT a.checksum, a.nome_arquivo FROM ponto_controle.arquivo AS a
       INNER JOIN ponto_controle.ponto AS p ON p.id = a.ponto_id
       WHERE p.cod_ponto = 'RJ-HV-1'`
    )
    expect(arquivos).toHaveLength(1)
    expect(arquivos[0].checksum).toBe(sha256(CORRIGIDO))
    // O nome não mudou, então o arquivo novo ocupou o mesmo caminho: sem órfão.
    expect(res.body.dados.arquivos_orfaos).toEqual([])
  })

  it('substituir com OUTRO nome de arquivo denuncia o órfão no volume', async () => {
    const lote = await criaLote()
    const primeira = await preparar({
      lote_id: lote.id,
      pontos: [
        pontoDe('RJ-HV-1', [
          arquivoDe(CONTEUDO_RINEX, { nome_arquivo: 'nome_velho', extensao: 'zip' })
        ])
      ]
    })
    for (const a of primeira.body.dados.arquivos) {
      transferir(a.destination_path, CONTEUDO_RINEX)
    }
    await confirmar(primeira.body.dados.session_uuid)

    const OUTRO = Buffer.from('outro conteudo\n')
    const segunda = await preparar({
      lote_id: lote.id,
      substituir: true,
      pontos: [
        pontoDe('RJ-HV-1', [
          arquivoDe(OUTRO, { nome_arquivo: 'nome_novo', extensao: 'zip' })
        ])
      ]
    })
    for (const a of segunda.body.dados.arquivos) {
      transferir(a.destination_path, OUTRO)
    }
    const res = await confirmar(segunda.body.dados.session_uuid)

    expect(res.body.dados.arquivos_orfaos).toHaveLength(1)
    expect(res.body.dados.arquivos_orfaos[0]).toContain('nome_velho.zip')
    expect(fs.existsSync(res.body.dados.arquivos_orfaos[0])).toBe(true)
  })
})

// --- Download ----------------------------------------------------------------

describe('Ponto de controle - download dos dois arquivos', () => {
  const importaComOsDois = async () => {
    const lote = await criaLote()
    const prep = await preparar({
      lote_id: lote.id,
      pontos: [
        pontoDe('RJ-HV-1', [
          arquivoDe(CONTEUDO_RINEX, { nome_arquivo: 'RJ-HV-1_pacote', extensao: 'zip' }),
          arquivoDe(CONTEUDO_FOTO, {
            tipo_arquivo_id: 2, nome_arquivo: 'RJ-HV-1', extensao: 'pdf'
          })
        ])
      ]
    })
    for (const a of prep.body.dados.arquivos) {
      transferir(a.destination_path, a.extensao === 'pdf' ? CONTEUDO_FOTO : CONTEUDO_RINEX)
    }
    await confirmar(prep.body.dados.session_uuid)
  }

  const baixar = (cod, tipo, token = generateAdminToken()) =>
    request(app)
      .get(`/api/ponto_controle/${cod}/download/${tipo}`)
      .set('Authorization', token)

  it('entrega os BYTES do pacote e da monografia', async () => {
    await importaComOsDois()

    const pacote = await baixar('RJ-HV-1', 'pacote')
    expect(pacote.status).toBe(200)
    // O corpo é o arquivo, e não um caminho de rede: a tela do navegador não
    // enxerga o share, ao contrário do plugin QGIS que baixa o acervo.
    expect(Buffer.from(pacote.body)).toEqual(CONTEUDO_RINEX)
    expect(pacote.headers['content-disposition']).toContain('RJ-HV-1_pacote.zip')
    expect(pacote.headers['x-checksum-sha256']).toBe(sha256(CONTEUDO_RINEX))

    const mono = await baixar('RJ-HV-1', 'monografia')
    expect(mono.status).toBe(200)
    expect(Buffer.from(mono.body)).toEqual(CONTEUDO_FOTO)
    expect(mono.headers['content-disposition']).toContain('RJ-HV-1.pdf')
  })

  it('recusa tipo que não existe', async () => {
    await importaComOsDois()
    const res = await baixar('RJ-HV-1', 'croqui')
    expect(res.status).toBe(400)
  })

  it('404 quando o ponto não tem aquele arquivo', async () => {
    const lote = await criaLote()
    const prep = await preparar({ lote_id: lote.id, pontos: [pontoDe('RJ-HV-9', [])] })
    await confirmar(prep.body.dados.session_uuid)

    const res = await baixar('RJ-HV-9', 'monografia')
    expect(res.status).toBe(404)
  })

  it('registrado mas AUSENTE no volume dá 404, e não um download truncado', async () => {
    await importaComOsDois()
    // Alguém apagou o arquivo do volume por fora.
    fs.rmSync(path.join(volumeDir, 'RJ-HV-1', 'RJ-HV-1_pacote.zip'))

    const res = await baixar('RJ-HV-1', 'pacote')
    expect(res.status).toBe(404)
    expect(res.body.message).toMatch(/não foi encontrado no volume/i)
  })

  it('exige token', async () => {
    const res = await request(app).get('/api/ponto_controle/RJ-HV-1/download/pacote')
    expect(res.status).toBe(401)
  })
})

// --- Sessões ----------------------------------------------------------------

describe('Ponto de controle - sessões de importação', () => {
  it('lista as sessões com o que falta em cada uma', async () => {
    const lote = await criaLote()
    await preparar({
      lote_id: lote.id,
      pontos: [pontoDe('RJ-HV-1', [arquivoDe(CONTEUDO_RINEX)])]
    })

    const res = await request(app)
      .get('/api/ponto_controle/upload-sessions')
      .set('Authorization', generateAdminToken())

    expect(res.status).toBe(200)
    expect(res.body.dados).toHaveLength(1)
    expect(res.body.dados[0].status).toBe('pending')
    expect(res.body.dados[0].lote).toBe('Missão Teste')
    expect(res.body.dados[0].pontos).toBe(1)
    expect(res.body.dados[0].arquivos).toBe(1)
  })

  it('cancelar fecha a sessão e ela não se confirma mais', async () => {
    const lote = await criaLote()
    const prep = await preparar({
      lote_id: lote.id,
      pontos: [pontoDe('RJ-HV-1', [arquivoDe(CONTEUDO_RINEX)])]
    })
    transferir(prep.body.dados.arquivos[0].destination_path, CONTEUDO_RINEX)

    const cancel = await request(app)
      .post('/api/ponto_controle/cancel-upload')
      .set('Authorization', generateAdminToken())
      .send({ session_uuid: prep.body.dados.session_uuid })
    expect(cancel.status).toBe(200)

    // Mesmo com os arquivos no lugar, sessão cancelada não grava.
    const res = await confirmar(prep.body.dados.session_uuid)
    expect(res.status).toBe(404)
    expect(await contarPontos()).toBe(0)
  })

  it('/upload-sessions não é confundida com um código de ponto', async () => {
    // '/:cod_ponto' casa com qualquer segmento. Declarada antes, engoliria esta
    // rota e devolveria um 400 de código inválido, que não explica nada.
    const res = await request(app)
      .get('/api/ponto_controle/upload-sessions')
      .set('Authorization', generateAdminToken())
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.dados)).toBe(true)
  })
})

// --- Só ponto aprovado entra no acervo ---------------------------------------

describe('Ponto de controle - só o APROVADO entra', () => {
  // O acervo é o que a tropa consulta para ajustar trabalho, e ponto não
  // revisado ali é pior do que ponto nenhum.
  const comSituacao = (cod, situacao) =>
    pontoDe(cod, [], { tipo_situacao: situacao })

  it('recusa o ponto que não está aprovado, e diz por quê', async () => {
    const lote = await criaLote()
    const res = await preparar({
      lote_id: lote.id,
      pontos: [
        comSituacao('RJ-HV-1', 1),   // Não medido
        comSituacao('RJ-HV-2', 2),   // Aguardando revisão
        comSituacao('RJ-HV-3', 4),   // Reprovado
      ]
    })

    expect(res.status).toBe(201)
    expect(res.body.dados.pontos_novos).toEqual([])
    expect(res.body.dados.recusados.map(r => r.cod_ponto).sort())
      .toEqual(['RJ-HV-1', 'RJ-HV-2', 'RJ-HV-3'])
    expect(res.body.dados.recusados[0].motivo).toMatch(/APROVADO/)
  })

  it('a missão MISTURADA importa a parte aprovada, e não é derrubada', async () => {
    // Missão com mistura é caso normal em campo. Derrubar tudo obrigaria a
    // separar a mão o que o acervo sabe separar sozinho.
    const lote = await criaLote()
    const res = await preparar({
      lote_id: lote.id,
      pontos: [comSituacao('RJ-HV-1', 3), comSituacao('RJ-HV-2', 2)]
    })

    expect(res.status).toBe(201)
    expect(res.body.dados.pontos_novos).toEqual(['RJ-HV-1'])
    expect(res.body.dados.recusados.map(r => r.cod_ponto)).toEqual(['RJ-HV-2'])

    const confirmado = await confirmar(res.body.dados.session_uuid)
    expect(confirmado.body.dados.inseridos).toEqual(['RJ-HV-1'])
    expect(await contarPontos()).toBe(1)
  })

  // `data_rastreio` E `DATE NOT NULL` sem DEFAULT, e nada nesta fase a cobrava:
  // o ponto sem ela passava com 201, quem importa copiava centenas de MB para o
  // volume, e so na fase 2 o INSERT estourava -- derrubando a transacao INTEIRA,
  // ou seja, TODOS os pontos da missao, com os arquivos de todos eles orfaos no
  // volume e fora ate do relatorio de `arquivos_orfaos`.
  it('ponto sem data_rastreio e recusado no PREPARE, e a missao segue', async () => {
    const lote = await criaLote()
    const semData = pontoDe('RJ-HV-2', [])
    delete semData.atributos.data_rastreio

    const res = await preparar({
      lote_id: lote.id,
      pontos: [pontoDe('RJ-HV-1', []), semData]
    })

    expect(res.status).toBe(201)
    expect(res.body.dados.pontos_novos).toEqual(['RJ-HV-1'])
    expect(res.body.dados.recusados.map(r => r.cod_ponto)).toEqual(['RJ-HV-2'])
    expect(res.body.dados.recusados[0].motivo).toMatch(/data_rastreio/)

    // A parte boa da missao entra inteira, sem a transacao 2 cair.
    const confirmado = await confirmar(res.body.dados.session_uuid)
    expect(confirmado.status).toBe(200)
    expect(confirmado.body.dados.inseridos).toEqual(['RJ-HV-1'])
  })

  it('ponto SEM situação nenhuma não entra', async () => {
    // O 9999 do modelo do plugin é "a ser preenchido", e ausente é o mesmo
    // caso: não se sabe se foi conferido, então não é acervo.
    const lote = await criaLote()
    const semSituacao = pontoDe('RJ-HV-1', [])
    delete semSituacao.atributos.tipo_situacao

    const res = await preparar({ lote_id: lote.id, pontos: [semSituacao] })
    expect(res.body.dados.pontos_novos).toEqual([])
    expect(res.body.dados.recusados).toHaveLength(1)
  })
})
