'use strict'

/**
 * A AUDIÊNCIA DO TOKEN: o que o token da tile abre, e o que ele não abre.
 *
 * O QUE ESTE ARQUIVO PRENDE, e por que ele existe. Até 2026-08-09 a URL da
 * camada MVT levava o token de SESSÃO na query (`?token=`); o middleware de log
 * do `server/app.js` grava `req.originalUrl`, que inclui a query; e a rota
 * `/logs` publica esse arquivo sem guarda nenhuma. Uma credencial de oito horas,
 * aceita por TODAS as guardas, ficava legível a quem abrisse a página do log.
 *
 * A correção não fechou o `/logs` (isso é decisão registrada): ela trocou a
 * credencial. Os quatro casos abaixo são as quatro metades dessa troca:
 *
 *   1. o bearer comum NÃO abre a tile (senão o vazamento voltava pela mesma
 *      porta, com o mesmo token de sempre);
 *   2. o token de tile NÃO abre nenhuma das outras guardas (é o que faz um token
 *      vazado do log valer quase nada);
 *   3. o token JÁ EMITIDO, que não tem `aud`, continua valendo nas guardas
 *      normais (ninguém é deslogado no deploy) e NÃO vale na de tile;
 *   4. `?token[]=x` responde 401, e não 500.
 *
 * NÃO TOCA O BANCO: as guardas leem `dgeo.usuario`, e aqui isso é um dublê. O
 * que se prova é a decisão sobre a CREDENCIAL, que acontece antes da consulta.
 */

const mockDb = {
  conn: {
    oneOrNone: jest.fn(),
    one: jest.fn()
  }
}

jest.mock('../../../database', () => ({
  db: mockDb,
  databaseVersion: { nome: '1.0.0', load: jest.fn() }
}))

// serialize-error e ESM-only e entra por import() dinamico; num teste unitario
// esse import pode resolver DEPOIS do teardown e derrubar o processo.
jest.mock('../../../utils/serialize_error_loader', () => ({
  serialize: error => ({ message: error.message, stack: error.stack }),
  ready: Promise.resolve()
}))

const jwt = require('jsonwebtoken')
const express = require('express')
const request = require('supertest')

const { JWT_SECRET } = require('../../../config')
const { sendJsonAndLogMiddleware, errorHandler } = require('../../../utils')

const validateToken = require('../../../login/validate_token')
const { AUDIENCIA } = validateToken

const verifyLoginTile = require('../../../login/verify_login_tile')
const verifyLogin = require('../../../login/verify_login')
const verifyAdmin = require('../../../login/verify_admin')
const verifyAcesso = require('../../../login/verify_acesso')
const verifyGerente = require('../../../login/verify_gerente')
const verifyPerfil = require('../../../login/verify_perfil')

const UUID = 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22'

/** O token de SESSÃO como o `login_ctrl` o assina desde 2026-08-09. */
const tokenDeSessao = () =>
  jwt.sign(
    { id: 2, uuid: UUID, administrador: true, cliente: 'sap_web', aud: AUDIENCIA.SESSAO },
    JWT_SECRET,
    { expiresIn: '1h' }
  )

/** O token anterior à mudança: mesma assinatura, sem o claim `aud`. */
const tokenLegado = () =>
  jwt.sign(
    { id: 2, uuid: UUID, administrador: true, cliente: 'sap_web' },
    JWT_SECRET,
    { expiresIn: '1h' }
  )

/** O token curto da tile, como sai de `POST /login/tile`. */
const tokenDeTile = () =>
  jwt.sign(
    { id: 2, uuid: UUID, administrador: true, cliente: 'sap_web', aud: AUDIENCIA.TILE },
    JWT_SECRET,
    { expiresIn: '10m' }
  )

/**
 * Um app com UMA rota e a guarda pedida, para exercitar o middleware de verdade
 * com o errorHandler de verdade: é ele que transforma o `AppError` em status.
 */
const appCom = guarda => {
  const app = express()
  app.use(sendJsonAndLogMiddleware)
  app.get('/alvo', guarda, (req, res) =>
    res.sendJsonAndLog(true, 'passou', 200, { usuarioId: req.usuarioId })
  )
  app.use((err, req, res, next) => errorHandler.log(err, res))
  return app
}

beforeEach(() => {
  // Conta existente e ATIVA, administradora: assim nenhuma recusa abaixo pode
  // ser confundida com falta de perfil.
  mockDb.conn.oneOrNone.mockResolvedValue({ id: 2, administrador: true, perfil_id: 3 })
  mockDb.conn.one.mockResolvedValue({ temAcesso: true, gerente: true })
})

describe('validateToken: a audiência é conferida num lugar só', () => {
  it('a audiência de sessão é o default, e quem não pede nada recebe ela', async () => {
    const decoded = await validateToken(tokenDeSessao())
    expect(decoded.uuid).toBe(UUID)
    expect(decoded.aud).toBe(AUDIENCIA.SESSAO)
  })

  it('o token de tile é RECUSADO pela audiência default', async () => {
    await expect(validateToken(tokenDeTile())).rejects.toMatchObject({
      statusCode: 401,
      message: 'Token não vale para esta rota'
    })
  })

  it('o token de sessão é RECUSADO quando se pede a audiência de tile', async () => {
    await expect(
      validateToken(tokenDeSessao(), AUDIENCIA.TILE)
    ).rejects.toMatchObject({ statusCode: 401 })
  })

  it('o token de tile passa quando é a audiência de tile que se pede', async () => {
    const decoded = await validateToken(tokenDeTile(), AUDIENCIA.TILE)
    expect(decoded.aud).toBe(AUDIENCIA.TILE)
  })

  // A REGRA ASSIMÉTRICA, e ela é o que evita deslogar todo mundo no deploy.
  it('o token JÁ EMITIDO, sem `aud`, continua valendo na audiência de sessão', async () => {
    const decoded = await validateToken(tokenLegado())
    expect(decoded.uuid).toBe(UUID)
  })

  it('e o token sem `aud` NÃO vale na audiência de tile', async () => {
    await expect(
      validateToken(tokenLegado(), AUDIENCIA.TILE)
    ).rejects.toMatchObject({ statusCode: 401 })
  })

  // `?token[]=x` faz o Express entregar um ARRANJO. Antes de 2026-08-09 o
  // `.startsWith` lançava TypeError, o asyncHandler o empurrava ao errorHandler
  // e a resposta era 500 -- ou seja, uma query malformada passava por erro DO
  // SERVIDOR.
  it.each([
    ['arranjo', ['x']],
    ['objeto', { a: 1 }],
    ['número', 12345]
  ])('token que não é string (%s) é 401, e não exceção', async (_forma, valor) => {
    await expect(validateToken(valor)).rejects.toMatchObject({
      statusCode: 401,
      message: 'Token em formato inválido'
    })
  })

  it('sem token nenhum continua sendo 401', async () => {
    await expect(validateToken(undefined)).rejects.toMatchObject({ statusCode: 401 })
  })
})

describe('a guarda da tile recusa o bearer comum', () => {
  it('pelo cabeçalho Authorization', async () => {
    const res = await request(appCom(verifyLoginTile))
      .get('/alvo')
      .set('Authorization', `Bearer ${tokenDeSessao()}`)

    expect(res.status).toBe(401)
  })

  it('pela query string, que é o canal do vazamento', async () => {
    const res = await request(appCom(verifyLoginTile))
      .get(`/alvo?token=${tokenDeSessao()}`)

    expect(res.status).toBe(401)
  })

  it('e recusa também o token legado, sem `aud`', async () => {
    const res = await request(appCom(verifyLoginTile))
      .get(`/alvo?token=${tokenLegado()}`)

    expect(res.status).toBe(401)
  })

  it('o token de tile passa, pelos dois canais', async () => {
    const porQuery = await request(appCom(verifyLoginTile))
      .get(`/alvo?token=${tokenDeTile()}`)
    const porCabecalho = await request(appCom(verifyLoginTile))
      .get('/alvo')
      .set('Authorization', `Bearer ${tokenDeTile()}`)

    expect(porQuery.status).toBe(200)
    expect(porCabecalho.status).toBe(200)
  })

  // O 500 QUE VIROU 401. Sem a guarda de tipo em `validateToken`, esta URL
  // derrubava o handler com TypeError.
  it('`?token[]=x` responde 401, e não 500', async () => {
    const res = await request(appCom(verifyLoginTile)).get('/alvo?token[]=x')

    expect(res.status).toBe(401)
    expect(res.status).not.toBe(500)
  })
})

describe('as guardas normais recusam o token de tile', () => {
  const GUARDAS = [
    ['verifyLogin', verifyLogin],
    ['verifyAdmin', verifyAdmin],
    ['verifyAcesso', verifyAcesso],
    ['verifyGerente', verifyGerente],
    ['verifyPerfil', verifyPerfil('consulta', 'producao')]
  ]

  it.each(GUARDAS)('%s recusa o token de tile no cabeçalho', async (_nome, guarda) => {
    const res = await request(appCom(guarda))
      .get('/alvo')
      .set('Authorization', `Bearer ${tokenDeTile()}`)

    expect(res.status).toBe(401)
  })

  // Guarda de variância: as mesmas guardas, com o token de sessão, PASSAM. Sem
  // este caso, um erro qualquer na montagem do app faria os cinco acima
  // responderem 401 por motivo nenhum.
  it.each(GUARDAS)('%s aceita o token de sessão', async (_nome, guarda) => {
    const res = await request(appCom(guarda))
      .get('/alvo')
      .set('Authorization', `Bearer ${tokenDeSessao()}`)

    expect(res.status).toBe(200)
  })

  it.each(GUARDAS)('%s aceita o token legado, sem `aud`', async (_nome, guarda) => {
    const res = await request(appCom(guarda))
      .get('/alvo')
      .set('Authorization', `Bearer ${tokenLegado()}`)

    expect(res.status).toBe(200)
  })

  // E o token da tile não vale nem pela query nas guardas normais, que é onde
  // ele de fato circula.
  it('verifyLogin não lê a query, nem com o token de tile nem com o de sessão', async () => {
    const comTile = await request(appCom(verifyLogin)).get(`/alvo?token=${tokenDeTile()}`)
    const comSessao = await request(appCom(verifyLogin)).get(`/alvo?token=${tokenDeSessao()}`)

    expect(comTile.status).toBe(401)
    expect(comSessao.status).toBe(401)
  })
})

describe('POST /login/tile: de onde sai a credencial da camada', () => {
  const appDoLogin = () => {
    const app = express()
    app.use(sendJsonAndLogMiddleware)
    app.use(express.json())
    app.use('/login', require('../../../login/login_route'))
    app.use((err, req, res, next) => errorHandler.log(err, res))
    return app
  }

  it('devolve um token de audiência tile a quem já está logado', async () => {
    const res = await request(appDoLogin())
      .post('/login/tile')
      .set('Authorization', `Bearer ${tokenDeSessao()}`)

    expect(res.status).toBe(201)
    expect(res.body.success).toBe(true)

    const emitido = jwt.verify(res.body.dados.token, JWT_SECRET)
    expect(emitido.aud).toBe(AUDIENCIA.TILE)
    expect(emitido.uuid).toBe(UUID)
    // Minutos: o prazo curto é o ganho todo de um token que anda em URL.
    expect(res.body.dados.expira_em_segundos).toBeLessThanOrEqual(15 * 60)
  })

  it('e esse token abre a guarda da tile, que era o ponto', async () => {
    const emissao = await request(appDoLogin())
      .post('/login/tile')
      .set('Authorization', `Bearer ${tokenDeSessao()}`)

    const res = await request(appCom(verifyLoginTile))
      .get(`/alvo?token=${emissao.body.dados.token}`)

    expect(res.status).toBe(200)
  })

  // O TOKEN DE TILE NÃO GERA OUTRO TOKEN DE TILE, senão o prazo curto não
  // significaria nada: quem tivesse um do log renovaria para sempre.
  it('o token de tile não emite um novo token de tile', async () => {
    const res = await request(appDoLogin())
      .post('/login/tile')
      .set('Authorization', `Bearer ${tokenDeTile()}`)

    expect(res.status).toBe(401)
  })

  it('sem token nenhum, 401', async () => {
    const res = await request(appDoLogin()).post('/login/tile')
    expect(res.status).toBe(401)
  })
})
