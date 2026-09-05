'use strict'

/**
 * TROCAR A SENHA DERRUBA AS SESSÕES ABERTAS, e é isto que este arquivo prende.
 *
 * O CENÁRIO, que é o motivo de tudo: alguém deixa a sessão aberta numa máquina
 * compartilhada, quem a encontrou continua dentro, o dono percebe e troca a
 * senha em `#/perfil`. Até 2026-09-05 o token da outra sessão continuava valendo
 * por até `JWT_EXPIRACAO` (8 horas), lendo e escrevendo tudo -- o JWT não
 * carregava nada ligado à senha, e nenhuma guarda tinha como saber que ela
 * mudou. O mesmo valia para o reset feito pelo administrador: resetar a senha de
 * uma conta comprometida não expulsava quem já estava dentro.
 *
 * O MECANISMO: o token passa a levar um `carimbo` derivado do hash vigente
 * (`left(md5(senha), 8)`, calculado pelo PostgreSQL), e as SETE guardas o releem
 * na consulta que cada uma já faz por requisição. Hash novo, carimbo novo, token
 * antigo fora. Sem coluna nova, sem migração e sem uma ida a mais ao banco.
 *
 * TRÊS CASOS POR GUARDA, e são as três situações que existem:
 *   1. carimbo IGUAL ao do banco  -> passa (a sessão comum, o dia a dia);
 *   2. carimbo DIVERGENTE         -> 401 com a frase (a senha mudou);
 *   3. carimbo AUSENTE            -> passa (o token legado, emitido antes da
 *      mudança). Exigi-lo de todo mundo deslogaria no deploy toda sessão aberta
 *      e todo CLI com token em cache (`~/.sca`), e é a mesma assimetria que
 *      `validate_token.js` já usa para o `aud`.
 *
 * NÃO TOCA O BANCO: `dgeo.usuario` entra por dublê. O que se prova é a decisão
 * de autorização; que os dois lados calculem o MESMO número é garantido por
 * construção, e não por dublê -- o login e as guardas usam a mesma expressão SQL,
 * vinda de `colunaCarimbo()`, e o caso final deste arquivo guarda isso.
 */

const mockDb = {
  conn: {
    oneOrNone: jest.fn(),
    any: jest.fn(),
    one: jest.fn()
  }
}

jest.mock('../../../database', () => ({
  db: mockDb,
  databaseVersion: { nome: '1.0.0', load: jest.fn() }
}))

// serialize-error é ESM-only e entra por import() dinâmico; num teste unitário
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

const { AUDIENCIA } = require('../../../login/validate_token')
const {
  TAMANHO,
  colunaCarimbo,
  SESSAO_ENCERRADA
} = require('../../../login/carimbo_da_senha')

const verifyLogin = require('../../../login/verify_login')
const verifyLoginTile = require('../../../login/verify_login_tile')
const verifyAcesso = require('../../../login/verify_acesso')
const verifyAdmin = require('../../../login/verify_admin')
const verifyGerente = require('../../../login/verify_gerente')
const verifyPerfil = require('../../../login/verify_perfil')
const verifyRastreabilidade = require('../../../auditoria/verify_rastreabilidade')

const UUID = 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22'

// Os oito caracteres como o PostgreSQL os devolveria: o hash de HOJE.
const VIGENTE = '3f2504e0'
// O carimbo que um token emitido ANTES da troca de senha carregaria.
const ANTIGO = 'a1b2c3d4'

/**
 * As sete guardas que leem `dgeo.usuario` por requisição. A de tile pede
 * audiência própria, e por isso ela viaja com o tipo de token que aceita.
 */
const GUARDAS = [
  ['verifyLogin', verifyLogin, AUDIENCIA.SESSAO],
  ['verifyLoginTile', verifyLoginTile, AUDIENCIA.TILE],
  ['verifyAcesso', verifyAcesso, AUDIENCIA.SESSAO],
  ['verifyAdmin', verifyAdmin, AUDIENCIA.SESSAO],
  ['verifyGerente', verifyGerente, AUDIENCIA.SESSAO],
  ['verifyPerfil', verifyPerfil('consulta', 'producao'), AUDIENCIA.SESSAO],
  ['verifyRastreabilidade', verifyRastreabilidade, AUDIENCIA.SESSAO]
]

const token = (carimbo, aud) => {
  const payload = { id: 2, uuid: UUID, administrador: true, cliente: 'sap_web', aud }
  if (carimbo !== undefined) payload.carimbo = carimbo
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' })
}

const appCom = guarda => {
  const app = express()
  app.use(sendJsonAndLogMiddleware)
  app.get('/alvo', guarda, (req, res) => res.sendJsonAndLog(true, 'passou', 200))
  app.use((err, req, res, next) => errorHandler.log(err, res))
  return app
}

const pedir = (guarda, carimbo, aud) =>
  request(appCom(guarda))
    .get('/alvo')
    .set('Authorization', `Bearer ${token(carimbo, aud)}`)

beforeEach(() => {
  jest.clearAllMocks()
  // Conta ativa, administradora e gerente, com o carimbo VIGENTE: assim nenhuma
  // recusa abaixo pode ser confundida com falta de perfil.
  mockDb.conn.oneOrNone.mockResolvedValue({
    id: 2,
    administrador: true,
    perfil_id: 3,
    carimbo: VIGENTE
  })
  mockDb.conn.one.mockResolvedValue({ temAcesso: true, gerente: true })
  mockDb.conn.any.mockResolvedValue([{ modulo: 'acervo' }])
})

describe('o carimbo do token contra o hash de hoje', () => {
  it.each(GUARDAS)('%s: carimbo igual ao do banco PASSA', async (_nome, guarda, aud) => {
    const res = await pedir(guarda, VIGENTE, aud)

    expect(res.status).toBe(200)
  })

  it.each(GUARDAS)(
    '%s: carimbo divergente é 401, com a frase que diz o porquê',
    async (_nome, guarda, aud) => {
      const res = await pedir(guarda, ANTIGO, aud)

      expect(res.status).toBe(401)
      expect(res.body.message).toBe(SESSAO_ENCERRADA)
      expect(res.body.message).toBe(
        'Sessão encerrada: a senha desta conta foi alterada. Entre de novo.'
      )
    }
  )

  it.each(GUARDAS)(
    '%s: token SEM o claim (o legado) continua valendo',
    async (_nome, guarda, aud) => {
      const res = await pedir(guarda, undefined, aud)

      expect(res.status).toBe(200)
    }
  )

  // A CONTA SEM SENHA (importada do Auth Server e ainda sem o hash copiado) tem
  // `carimbo` nulo no banco. O token que carrega um carimbo diverge dele e cai,
  // que é o lado certo: o hash que autorizou aquele token não existe mais.
  it.each(GUARDAS)('%s: carimbo nulo no banco derruba o token que tem um', async (_nome, guarda, aud) => {
    mockDb.conn.oneOrNone.mockResolvedValue({
      id: 2,
      administrador: true,
      perfil_id: 3,
      carimbo: null
    })

    const res = await pedir(guarda, VIGENTE, aud)

    expect(res.status).toBe(401)
    expect(res.body.message).toBe(SESSAO_ENCERRADA)
  })
})

describe('o carimbo sai do banco, e da consulta que a guarda já fazia', () => {
  // SEM IDA A MAIS: a coluna entra no SELECT que a guarda já executava por
  // requisição. Se alguém acrescentar uma segunda consulta para lê-la, este caso
  // fica vermelho -- e o argumento inteiro da solução ("não custa nada") cai
  // junto.
  it.each(GUARDAS)('%s lê dgeo.usuario UMA vez, com a coluna do carimbo', async (_nome, guarda, aud) => {
    await pedir(guarda, VIGENTE, aud)

    const leituras = mockDb.conn.oneOrNone.mock.calls.filter(([sql]) =>
      /FROM dgeo\.usuario/.test(String(sql))
    )

    expect(leituras).toHaveLength(1)
    expect(String(leituras[0][0])).toContain('AS carimbo')
    expect(String(leituras[0][0])).toContain('md5(')
  })

  // UMA IMPLEMENTAÇÃO SÓ. O login e as sete guardas usam a MESMA expressão, e é
  // por isso que os dois números não podem divergir: não há dois cálculos.
  it('a coluna é a mesma expressão SQL em todo lugar', () => {
    expect(colunaCarimbo()).toBe(`left(md5(senha), ${TAMANHO}) AS carimbo`)
    expect(colunaCarimbo('u')).toBe(`left(md5(u.senha), ${TAMANHO}) AS carimbo`)
    expect(TAMANHO).toBe(8)
  })
})

describe('o token curto da tile nasce com o carimbo de hoje', () => {
  // A CAMADA DE TILES FICA ABERTA NA TELA POR HORAS, renovando um token de dez
  // minutos. Sem o carimbo aqui, a troca de senha derrubaria a sessão e deixaria
  // a camada desenhando por mais uma renovação -- e o `POST /login/tile` que a
  // renova já não abriria, mas o token na mão ainda abriria a guarda.
  const appDoLogin = () => {
    const app = express()
    app.use(sendJsonAndLogMiddleware)
    app.use(express.json())
    app.use('/login', require('../../../login/login_route'))
    app.use((err, req, res, next) => errorHandler.log(err, res))
    return app
  }

  const emitir = carimboDoToken =>
    request(appDoLogin())
      .post('/login/tile')
      .set('Authorization', `Bearer ${token(carimboDoToken, AUDIENCIA.SESSAO)}`)

  it('o carimbo do token de tile vem do BANCO, e não da sessão que o pediu', async () => {
    // Sessão LEGADA, sem o claim: a tile que ela emite já nasce amarrada ao
    // hash vigente.
    const res = await emitir(undefined)

    expect(res.status).toBe(201)
    expect(jwt.verify(res.body.dados.token, JWT_SECRET).carimbo).toBe(VIGENTE)
  })

  it('e esse token de tile abre a guarda da tile', async () => {
    const emissao = await emitir(VIGENTE)

    const res = await request(appCom(verifyLoginTile))
      .get(`/alvo?token=${emissao.body.dados.token}`)

    expect(res.status).toBe(200)
  })

  it('trocada a senha, o token de tile já emitido cai', async () => {
    const emissao = await emitir(VIGENTE)

    // A senha mudou entre a emissão e a próxima tile: o banco passa a devolver
    // outro carimbo.
    mockDb.conn.oneOrNone.mockResolvedValue({
      id: 2,
      administrador: true,
      perfil_id: 3,
      carimbo: 'ffffffff'
    })

    const res = await request(appCom(verifyLoginTile))
      .get(`/alvo?token=${emissao.body.dados.token}`)

    expect(res.status).toBe(401)
    expect(res.body.message).toBe(SESSAO_ENCERRADA)
  })
})
