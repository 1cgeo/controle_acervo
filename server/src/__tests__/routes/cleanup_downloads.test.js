'use strict'

/**
 * `POST /api/acervo/cleanup-expired-downloads`: fecha o download pendente cuja
 * validade venceu.
 *
 * Duas coisas que faltavam, e as duas eram sobre prova:
 *
 * 1. Ela era a ÚNICA das quatro operações de manutenção sem autor no rastro,
 *    apesar de o comentário de `registrarOperacao` afirmar que as quatro
 *    registravam.
 * 2. O retorno era descartado, e a tela anunciava sucesso sem número. A
 *    confirmação era eco da própria chamada, e não medida do que mudou.
 */

const request = require('supertest')
const { getApp } = require('../helpers/app')
const { conn, cleanTestData } = require('../helpers/db')
const { generateAdminToken, ADMIN_UUID } = require('../helpers/auth')
const { createFullProduct, createArquivo } = require('../helpers/fixtures')

let app

beforeAll(async () => {
  app = await getApp()
})

afterEach(async () => {
  await cleanTestData()
  await conn.none("DELETE FROM auditoria.evento WHERE tabela = 'acervo.download_expirado'")
})

const token = () => generateAdminToken()

const limpar = () => request(app)
  .post('/api/acervo/cleanup-expired-downloads')
  .set('Authorization', token())

/** Um download pendente, vencido ou não. */
const criarDownload = async (arquivoId, vencido) => conn.one(`
  INSERT INTO acervo.download (arquivo_id, usuario_uuid, download_token, status, expiration_time)
  VALUES ($<arquivoId>, $<uuid>, gen_random_uuid(), 'pending',
          NOW() + ($<horas> || ' hours')::interval)
  RETURNING id
`, { arquivoId, uuid: ADMIN_UUID, horas: vencido ? -25 : 24 })

const eventos = () => conn.any(
  "SELECT usuario_uuid, dados_depois FROM auditoria.evento WHERE tabela = 'acervo.download_expirado'"
)

describe('Limpeza de downloads expirados', () => {
  it('devolve QUANTOS fechou, e não só "sucesso"', async () => {
    const { versao } = await createFullProduct()
    const arquivo = await createArquivo(versao.id)
    await criarDownload(arquivo.id, true)
    await criarDownload(arquivo.id, true)
    const vivo = await criarDownload(arquivo.id, false)

    const res = await limpar()

    expect(res.status).toBe(200)
    expect(res.body.dados.fechados).toBe(2)
    expect(res.body.message).toContain('2')

    // O que não venceu continua pendente: a contagem não é o total da tabela.
    const restante = await conn.one(
      'SELECT status FROM acervo.download WHERE id = $1', [vivo.id]
    )
    expect(restante.status).toBe('pending')
  })

  it('registra QUEM mandou rodar', async () => {
    const { versao } = await createFullProduct()
    const arquivo = await createArquivo(versao.id)
    await criarDownload(arquivo.id, true)

    await limpar()

    const registrados = await eventos()
    expect(registrados).toHaveLength(1)
    expect(registrados[0].usuario_uuid).toBe(ADMIN_UUID)
    // `uploads_fechados` SAIU em 06/08/2026. Esta rota fechava os dois lados num
    // ato so, e a limpeza do ENVIO ficava escondida atras de um nome de
    // download: quem a procurasse nao a achava. Ela tem rota propria, e a prova
    // do numero dela esta em routes/upload_sessao_ciclo.test.js.
    expect(registrados[0].dados_depois).toEqual({ fechados: 1 })
  })

  it('sem nada a fechar, devolve zero e registra a tentativa da pessoa', async () => {
    // Chamada de gente entra no rastro mesmo devolvendo zero: "rodei e não havia
    // nada" é resposta, e é o que explica por que ninguém mexeu depois.
    const res = await limpar()

    expect(res.status).toBe(200)
    expect(res.body.dados.fechados).toBe(0)
    expect(await eventos()).toHaveLength(1)
  })
})
