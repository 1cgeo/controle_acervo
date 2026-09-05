'use strict'

/**
 * O espaço ocupado do acervo mora em DUAS tabelas.
 *
 * `acervo.arquivo` guarda o arquivo do produto e `ponto_controle.arquivo` o do
 * ponto de controle. As duas gravam no MESMO volume físico e disputam a MESMA
 * capacidade. O dashboard contava só a primeira, então o volume do ponto de
 * controle aparecia vazio com dezenas de GB dentro, e o alerta de 80% nunca
 * dispararia para ele.
 */

const request = require('supertest')
const { getApp } = require('../helpers/app')
const { conn, cleanTestData } = require('../helpers/db')
const { generateAdminToken } = require('../helpers/auth')
const { createProjeto, createLote } = require('../helpers/fixtures')

let app

beforeAll(async () => {
  app = await getApp()
})

afterEach(async () => {
  await cleanTestData()
})

/** Um volume com um arquivo de ponto de controle de `mb` megabytes. */
const semearPontoDeControle = async (mb, capacidadeGb = 100) => {
  const projeto = await createProjeto({ nome: 'Projeto PC Armazenamento' })
  const lote = await createLote(projeto.id, { nome: 'Missão PC', pit: 'PIT-PC-ARM' })

  const volume = await conn.one(
    `INSERT INTO acervo.volume_armazenamento (nome, volume, capacidade_gb)
     VALUES ('Volume Ponto de Controle', '/tmp/pc-arm', $1) RETURNING id`,
    [capacidadeGb]
  )
  await conn.none(
    `INSERT INTO acervo.volume_tipo_produto
       (tipo_produto_id, volume_armazenamento_id, primario)
     VALUES (10, $1, TRUE)`, [volume.id]
  )

  const usuario = await conn.one('SELECT uuid FROM dgeo.usuario LIMIT 1')
  const ponto = await conn.one(
    `INSERT INTO ponto_controle.ponto
       (cod_ponto, lote_id, data_rastreio, usuario_cadastramento_uuid, geom)
     VALUES ('RJ-HV-9', $1, '2026-05-12', $2,
             ST_SetSRID(ST_MakePoint(-47.9, -15.5), 4674))
     RETURNING id`, [lote.id, usuario.uuid]
  )
  await conn.none(
    `INSERT INTO ponto_controle.arquivo
       (ponto_id, tipo_arquivo_id, nome_arquivo, extensao, tamanho_mb, checksum,
        volume_armazenamento_id, usuario_cadastramento_uuid)
     VALUES ($1, 1, 'RJ-HV-9_pacote', 'zip', $2, repeat('a', 64), $3, $4)`,
    [ponto.id, mb, volume.id, usuario.uuid]
  )
  return { volume, lote }
}

const totalGb = async () => {
  const res = await request(app)
    .get('/api/dashboard/arquivos_total_gb')
    .set('Authorization', generateAdminToken())
  expect(res.status).toBe(200)
  return Number(res.body.dados.total_gb || 0)
}

/**
 * O ÚLTIMO ponto da série "GB Acumulados".
 *
 * É ele que a tela põe ao lado do cartão "Armazenamento Total", e é por isso que
 * a série precisa somar as MESMAS duas tabelas: divergindo, os dois números
 * aparecem juntos, com o mesmo nome, discordando pelo tamanho do ponto de
 * controle. O mês corrente é sempre o último da série (a consulta gera até
 * `date_trunc('month', NOW())`), então o arquivo semeado agora cai nele em
 * qualquer dia do ano.
 */
const acumuladoFinal = async () => {
  const res = await request(app)
    .get('/api/dashboard/storage_growth_trends')
    .set('Authorization', generateAdminToken())
  expect(res.status).toBe(200)
  const linhas = res.body.dados || []
  if (linhas.length === 0) return 0
  return Number(linhas[linhas.length - 1].cumulative_gb || 0)
}

describe('Dashboard - espaço ocupado', () => {
  it('o total SOMA o arquivo do ponto de controle', async () => {
    const antes = await totalGb()
    await semearPontoDeControle(2048) // 2 GB

    const depois = await totalGb()
    expect(depois - antes).toBeCloseTo(2, 3)
  })

  it('o crescimento acumulado SOMA o arquivo do ponto de controle', async () => {
    const antes = await acumuladoFinal()
    await semearPontoDeControle(2048) // 2 GB

    const depois = await acumuladoFinal()
    expect(depois - antes).toBeCloseTo(2, 3)
  })

  it('o GB por volume mostra o volume do ponto de controle', async () => {
    const { volume } = await semearPontoDeControle(1024)

    const res = await request(app)
      .get('/api/dashboard/gb_volume')
      .set('Authorization', generateAdminToken())
    expect(res.status).toBe(200)

    const linha = res.body.dados.find(
      v => String(v.volume_armazenamento_id) === String(volume.id))
    expect(linha).toBeDefined()
    expect(Number(linha.total_gb)).toBeCloseTo(1, 3)
  })

  it('o alerta de volume cheio enxerga o ponto de controle', async () => {
    // 9 GB num volume de 10 GB passa dos 80% SÓ se o ponto de controle contar.
    const { volume } = await semearPontoDeControle(9216, 10)

    const res = await request(app)
      .get('/api/dashboard/system_health')
      .set('Authorization', generateAdminToken())
    expect(res.status).toBe(200)

    const alerta = (res.body.dados.volumes_alertas || [])
      .find(v => String(v.id) === String(volume.id))
    expect(alerta).toBeDefined()
    expect(Number(alerta.percentual_uso)).toBeGreaterThan(80)
  })
})
