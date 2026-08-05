'use strict'

// A EXPIRACAO DO DOWNLOAD VALE NA HORA DO USO.
//
// Ate 2026-08-04 o `confirmDownload` casava so por `status = 'pending'`, e quem
// fechava o token vencido era um cron de hora em hora. Duas consequencias:
//  - o token valia por ate uma hora DEPOIS de expirar;
//  - com o cron parado, valia para sempre.
// O chefe tirou todo cron da aplicacao, entao a regra passou a morar onde o
// token e gasto. Este teste reprova o estado anterior: com a consulta antiga, o
// token vencido confirma e o primeiro `expect` falha.

const { db } = require('../../database')
const { conn, cleanTestData, closeConnection } = require('../helpers/db')
const { createFullProduct } = require('../helpers/fixtures')
const { ADMIN_UUID } = require('../helpers/auth')

const acervoCtrl = require('../../acervo/acervo_ctrl')

// Os controllers leem `db.conn` no momento da chamada; quem o cria e o
// createConn. Mesma razao do integration/exclusao_acervo.test.js.
beforeAll(async () => {
  await db.createConn()
})

afterEach(async () => {
  await cleanTestData()
})

afterAll(async () => {
  await closeConnection()
})

/** Cria um download com a expiracao pedida e devolve o token. */
const criarDownload = async (arquivoId, expiracaoSql) => {
  const d = await conn.one(
    `INSERT INTO acervo.download (arquivo_id, usuario_uuid, status, expiration_time)
     VALUES ($1, $2, 'pending', ${expiracaoSql})
     RETURNING download_token`,
    [arquivoId, ADMIN_UUID]
  )
  return d.download_token
}

describe('confirmDownload: o token vencido nao vale', () => {
  it('recusa o token expirado, mesmo com status pending e sem limpeza', async () => {
    const chain = await createFullProduct()
    const token = await criarDownload(chain.arquivo.id, "NOW() - INTERVAL '1 minute'")

    const [res] = await acervoCtrl.confirmDownload([
      { download_token: token, success: true }
    ])

    expect(res.status).toBe('error')

    // O status NAO muda: quem arruma e a limpeza, e ela nao rodou aqui. O que
    // este teste prova e que a RECUSA independe dela.
    const depois = await conn.one(
      'SELECT status FROM acervo.download WHERE download_token = $1',
      [token]
    )
    expect(depois.status).toBe('pending')
  })

  it('aceita o token dentro do prazo', async () => {
    const chain = await createFullProduct()
    const token = await criarDownload(chain.arquivo.id, "NOW() + INTERVAL '24 hours'")

    const [res] = await acervoCtrl.confirmDownload([
      { download_token: token, success: true }
    ])

    expect(res.status).not.toBe('error')

    const depois = await conn.one(
      'SELECT status FROM acervo.download WHERE download_token = $1',
      [token]
    )
    expect(depois.status).toBe('completed')
  })

  it('aceita o token sem prazo nenhum', async () => {
    const chain = await createFullProduct()
    const token = await criarDownload(chain.arquivo.id, 'NULL')

    const [res] = await acervoCtrl.confirmDownload([
      { download_token: token, success: true }
    ])

    expect(res.status).not.toBe('error')
  })
})

describe('cleanupExpiredDownloads: arruma os dois lados', () => {
  it('fecha o download vencido e conta o que fechou', async () => {
    const chain = await createFullProduct()
    const vencido = await criarDownload(chain.arquivo.id, "NOW() - INTERVAL '1 minute'")
    await criarDownload(chain.arquivo.id, "NOW() + INTERVAL '24 hours'")

    const r = await acervoCtrl.cleanupExpiredDownloads(ADMIN_UUID, null)

    expect(r.fechados).toBe(1)
    expect(r).toHaveProperty('uploads_fechados')

    const depois = await conn.one(
      'SELECT status FROM acervo.download WHERE download_token = $1',
      [vencido]
    )
    expect(depois.status).toBe('failed')
  })
})
