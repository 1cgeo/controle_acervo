'use strict'

// O historico de acesso de ponta a ponta, contra o banco de teste.
//
// O que este arquivo protege:
//
//  1. A GUARDA. Toda rota e verifyAdmin. `unit/schemas/acessos.test.js` ja le o
//     fonte e cobra a palavra; aqui se prova o efeito, com um token de usuario
//     comum de verdade batendo na porta. Os dois juntos porque a varredura de
//     texto nao ve um middleware que existe e nao barra.
//
//  2. O ZERO DA SERIE. Dia (e mes) sem login tem de sair como 0, e nao sumir da
//     resposta. E o unico motivo de as consultas usarem generate_series com
//     LEFT JOIN em vez de agrupar a dgeo.login direto, e a diferenca so aparece
//     quando existe um buraco -- por isso os fixtures deixam um de proposito.
//
//  3. O DIA DE CALENDARIO. A serie sai em 'AAAA-MM-DD', pelo dia LOCAL. Foi o
//     defeito que o `toLocalDateString` do original existia para evitar (e o
//     mesmo D-1 da "Data de entrega" da mapoteca em 2026-07-27). A comparacao e
//     contra `now()::date` LIDO DO BANCO, e nao contra um `new Date()` do Node:
//     comparar com o relogio do processo testaria os dois relogios em vez da
//     consulta.
//
//  4. A LAPIDE DO USUARIO APAGADO. `dgeo.login.usuario_id` e ON DELETE SET NULL
//     de proposito: apagar a pessoa nao apaga a passagem dela. O caso e criado
//     pelo caminho REAL (cria, entra, apaga), e nao inserindo NULL a mao, que
//     provaria so o COALESCE e nao a FK.
//
//  5. OS NUMEROS SAO NUMEROS. `count()` e BIGINT, e o pg-promise o entrega como
//     STRING para nao perder precisao. Sem o `::integer` das consultas, a tela
//     receberia '12' e qualquer soma no cliente viraria concatenacao. As
//     assercoes usam toBe(n) com typeof, e nao toEqual('n').

const request = require('supertest')
const { getApp } = require('../helpers/app')
const { conn, cleanTestData } = require('../helpers/db')
const {
  ADMIN_UUID,
  USER_UUID,
  generateAdminToken,
  generateUserToken
} = require('../helpers/auth')

let app

beforeAll(async () => {
  app = await getApp()
})

// Quem zera `dgeo.login` entre os casos e o `cleanTestData()`, que a trunca
// desde 2026-08-02 -- a regra mora la, e repeti-la aqui seria copia.
//
// O `beforeEach` existe por outro motivo: TODA assercao deste arquivo e uma
// CONTAGEM, entao uma unica linha vinda de fora muda o resultado sem tocar no
// teste. Arquivo que faz login pela API deixa linha aqui, e nem todo arquivo do
// pacote de banco chama o `cleanTestData()`. Comecar do zero e o que torna este
// arquivo independente da higiene dos outros, em vez de da ordem em que o Jest
// resolveu roda-los.
beforeEach(() => conn.none('TRUNCATE dgeo.login'))

afterEach(cleanTestData)

const admin = () => generateAdminToken()
const comum = () => generateUserToken()

const idPorUuid = async uuid =>
  (await conn.one('SELECT id FROM dgeo.usuario WHERE uuid = $<uuid>', { uuid })).id

/**
 * @param {number|null} usuarioId
 * @param {string} cliente 'sca_web' ou 'sca_qgis'
 * @param {string} quando expressao SQL do instante. Escrita pelo PROPRIO teste
 *   (nunca entrada externa), e em SQL e nao em JS, para que o recorte use o
 *   mesmo relogio que a consulta.
 */
const inserirLogin = (usuarioId, cliente, quando = 'now()') =>
  conn.none(
    `INSERT INTO dgeo.login (usuario_id, cliente, data_login)
     VALUES ($<usuarioId>, $<cliente>, ${quando})`,
    { usuarioId, cliente }
  )

const hojeNoBanco = async () =>
  (await conn.one('SELECT now()::date AS hoje')).hoje

const ROTAS = [
  '/api/acessos/logados',
  '/api/acessos/resumo',
  '/api/acessos/logins/dia',
  '/api/acessos/logins/mes',
  '/api/acessos/logins/usuarios',
  '/api/acessos/logins/clientes'
]

describe('Guarda: /api/acessos e admin-only', () => {
  test.each(ROTAS)('%s recusa quem nao e administrador', async rota => {
    const res = await request(app).get(rota).set('Authorization', comum())

    expect(res.status).toBe(403)
    expect(res.body.success).toBe(false)
  })

  // 401 e nao 403: sem token nao ha quem identificar, e o verifyAdmin so chega a
  // consultar o banco depois do validateToken. Os dois codigos sao diferentes de
  // proposito, e trocar um pelo outro esconde qual dos dois passos falhou.
  test.each(ROTAS)('%s recusa quem nao manda token', async rota => {
    const res = await request(app).get(rota)

    expect(res.status).toBe(401)
  })

  test.each(ROTAS)('%s responde ao administrador', async rota => {
    const res = await request(app).get(rota).set('Authorization', admin())

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
  })
})

describe('GET /api/acessos/logados', () => {
  test('traz o ultimo login de cada par usuario + cliente no dia', async () => {
    const usuarioId = await idPorUuid(USER_UUID)

    await inserirLogin(usuarioId, 'sca_web', "now() - INTERVAL '3 hours'")
    await inserirLogin(usuarioId, 'sca_web', "now() - INTERVAL '1 hour'")
    await inserirLogin(usuarioId, 'sca_qgis', "now() - INTERVAL '2 hours'")

    const res = await request(app)
      .get('/api/acessos/logados')
      .set('Authorization', admin())

    expect(res.status).toBe(200)
    // Tres logins, DOIS clientes: a linha e o par, e nao a passagem.
    expect(res.body.dados).toHaveLength(2)

    const web = res.body.dados.find(d => d.cliente === 'sca_web')
    expect(web).toMatchObject({
      login: 'test_user',
      nome_guerra: 'User',
      tipo_posto_grad: 'Civ'
    })
    expect(typeof web.id).toBe('number')

    // O de sca_web e o mais recente dos tres, entao encabeca a lista.
    expect(res.body.dados[0].cliente).toBe('sca_web')

    // ...e e o login de UMA hora atras, nao o de tres.
    const qgis = res.body.dados.find(d => d.cliente === 'sca_qgis')
    expect(new Date(web.ultimo_login).getTime()).toBeGreaterThan(
      new Date(qgis.ultimo_login).getTime()
    )
  })

  test('nao traz quem so entrou ontem', async () => {
    const usuarioId = await idPorUuid(USER_UUID)
    await inserirLogin(usuarioId, 'sca_web', "now() - INTERVAL '1 day'")

    const res = await request(app)
      .get('/api/acessos/logados')
      .set('Authorization', admin())

    expect(res.body.dados).toEqual([])
  })
})

describe('GET /api/acessos/resumo', () => {
  test('conta usuarios ativos, logins de hoje e dos ultimos 30 dias', async () => {
    const usuarioId = await idPorUuid(USER_UUID)
    const adminId = await idPorUuid(ADMIN_UUID)

    await inserirLogin(usuarioId, 'sca_web')
    await inserirLogin(adminId, 'sca_qgis')
    await inserirLogin(usuarioId, 'sca_web', "now() - INTERVAL '5 days'")
    // Fora da janela dos 30 dias: entra so no total geral, que ninguem pede.
    await inserirLogin(usuarioId, 'sca_web', "now() - INTERVAL '40 days'")

    const res = await request(app)
      .get('/api/acessos/resumo')
      .set('Authorization', admin())

    expect(res.status).toBe(200)
    expect(res.body.dados).toEqual({
      usuarios_ativos: 2,
      logins_hoje: 2,
      logins_30_dias: 3
    })
    // BIGINT viria como string; o ::integer da consulta e o que evita isso.
    expect(typeof res.body.dados.logins_hoje).toBe('number')
  })

  test('usuario desativado sai da contagem de ativos', async () => {
    await conn.none(
      'UPDATE dgeo.usuario SET ativo = FALSE WHERE uuid = $<uuid>',
      { uuid: USER_UUID }
    )

    const res = await request(app)
      .get('/api/acessos/resumo')
      .set('Authorization', admin())

    expect(res.body.dados.usuarios_ativos).toBe(1)

    await conn.none(
      'UPDATE dgeo.usuario SET ativo = TRUE WHERE uuid = $<uuid>',
      { uuid: USER_UUID }
    )
  })
})

describe('GET /api/acessos/logins/dia', () => {
  test('o dia sem login sai como ZERO, e nao como buraco na serie', async () => {
    const usuarioId = await idPorUuid(USER_UUID)

    await inserirLogin(usuarioId, 'sca_web')
    await inserirLogin(usuarioId, 'sca_web', "now() - INTERVAL '2 days'")
    // D-1 fica vazio de proposito: e o unico caso em que a diferenca entre
    // generate_series e um GROUP BY direto na dgeo.login aparece.

    const res = await request(app)
      .get('/api/acessos/logins/dia?total=3')
      .set('Authorization', admin())

    expect(res.status).toBe(200)
    expect(res.body.dados).toHaveLength(3)
    expect(res.body.dados.map(d => d.logins)).toEqual([1, 0, 1])
  })

  test('a data sai como dia de calendario AAAA-MM-DD, e o ultimo ponto e hoje', async () => {
    const res = await request(app)
      .get('/api/acessos/logins/dia?total=5')
      .set('Authorization', admin())

    const datas = res.body.dados.map(d => d.data)
    expect(datas).toHaveLength(5)
    for (const data of datas) {
      expect(data).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
    // Comparado contra o now() do BANCO: o defeito que se persegue aqui e o
    // deslocamento de um dia entre quem grava e quem formata.
    expect(datas[4]).toBe(await hojeNoBanco())
  })

  test('sem ?total a serie tem os 14 dias do default do Joi', async () => {
    const res = await request(app)
      .get('/api/acessos/logins/dia')
      .set('Authorization', admin())

    expect(res.body.dados).toHaveLength(14)
  })

  test.each([
    ['?total=0', 'janela de zero dia'],
    ['?total=abc', 'texto no lugar do numero'],
    ['?total=2.5', 'fracao de dia'],
    ['?total=367', 'acima do teto']
  ])('recusa %s (%s) com 400', async query => {
    const res = await request(app)
      .get(`/api/acessos/logins/dia${query}`)
      .set('Authorization', admin())

    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
  })
})

describe('GET /api/acessos/logins/mes', () => {
  test('o mes sem login sai como zero, e a data e o primeiro dia do mes', async () => {
    const usuarioId = await idPorUuid(USER_UUID)

    await inserirLogin(usuarioId, 'sca_web')
    await inserirLogin(
      usuarioId,
      'sca_qgis',
      "date_trunc('month', now()) - INTERVAL '2 months' + INTERVAL '5 days'"
    )

    const res = await request(app)
      .get('/api/acessos/logins/mes?total=3')
      .set('Authorization', admin())

    expect(res.status).toBe(200)
    expect(res.body.dados).toHaveLength(3)
    expect(res.body.dados.map(d => d.logins)).toEqual([1, 0, 1])
    for (const linha of res.body.dados) {
      expect(linha.data).toMatch(/^\d{4}-\d{2}-01$/)
    }
  })

  // O teto desta rota conta MESES (120), e nao dias (366) como a serie diaria:
  // sao duas unidades, e um teto so faria "?total=200" significar 200 dias numa
  // rota e 200 meses na outra.
  test('recusa 121 meses e aceita 120', async () => {
    const mes = await request(app)
      .get('/api/acessos/logins/mes?total=121')
      .set('Authorization', admin())
    expect(mes.status).toBe(400)

    const ok = await request(app)
      .get('/api/acessos/logins/mes?total=120')
      .set('Authorization', admin())
    expect(ok.status).toBe(200)
    expect(ok.body.dados).toHaveLength(120)
  })
})

describe('GET /api/acessos/logins/usuarios', () => {
  test('ordena do que mais entrou para o que menos entrou', async () => {
    const usuarioId = await idPorUuid(USER_UUID)
    const adminId = await idPorUuid(ADMIN_UUID)

    await inserirLogin(usuarioId, 'sca_web')
    await inserirLogin(usuarioId, 'sca_web')
    await inserirLogin(usuarioId, 'sca_qgis')
    await inserirLogin(adminId, 'sca_web')

    const res = await request(app)
      .get('/api/acessos/logins/usuarios?total=30&max=10')
      .set('Authorization', admin())

    expect(res.status).toBe(200)
    expect(res.body.dados).toEqual([
      { usuario: 'Civ User (test_user)', logins: 3 },
      { usuario: 'Civ Admin (test_admin)', logins: 1 }
    ])
  })

  test('max corta a lista', async () => {
    const usuarioId = await idPorUuid(USER_UUID)
    const adminId = await idPorUuid(ADMIN_UUID)

    await inserirLogin(usuarioId, 'sca_web')
    await inserirLogin(usuarioId, 'sca_web')
    await inserirLogin(adminId, 'sca_web')

    const res = await request(app)
      .get('/api/acessos/logins/usuarios?max=1')
      .set('Authorization', admin())

    expect(res.body.dados).toHaveLength(1)
    expect(res.body.dados[0].usuario).toContain('test_user')
  })

  test('apagar a pessoa nao apaga a passagem dela: vira "Usuário deletado"', async () => {
    // Caminho REAL: cria, entra, apaga. A FK e ON DELETE SET NULL, entao a
    // linha de login sobrevive com usuario_id nulo e o COALESCE a nomeia.
    const passageiro = await conn.one(
      `INSERT INTO dgeo.usuario (login, senha, nome, nome_guerra, tipo_posto_grad_id, ativo)
       VALUES ('passageiro', 'hash-irrelevante', 'Passageiro', 'Passa', 1, TRUE)
       RETURNING id`
    )

    await inserirLogin(passageiro.id, 'sca_web')
    await inserirLogin(passageiro.id, 'sca_qgis')

    await conn.none('DELETE FROM dgeo.usuario WHERE id = $<id>', {
      id: passageiro.id
    })

    const orfaos = await conn.one(
      'SELECT count(*)::integer AS n FROM dgeo.login WHERE usuario_id IS NULL'
    )
    expect(orfaos.n).toBe(2)

    const res = await request(app)
      .get('/api/acessos/logins/usuarios')
      .set('Authorization', admin())

    // Os dois clientes caem numa LINHA so: o agrupamento e por u.id, e todo
    // apagado tem u.id nulo.
    expect(res.body.dados).toEqual([{ usuario: 'Usuário deletado', logins: 2 }])
  })

  test('nao conta login fora da janela pedida', async () => {
    const usuarioId = await idPorUuid(USER_UUID)

    await inserirLogin(usuarioId, 'sca_web')
    await inserirLogin(usuarioId, 'sca_web', "now() - INTERVAL '10 days'")

    const res = await request(app)
      .get('/api/acessos/logins/usuarios?total=3')
      .set('Authorization', admin())

    expect(res.body.dados).toEqual([{ usuario: 'Civ User (test_user)', logins: 1 }])
  })
})

describe('GET /api/acessos/logins/clientes', () => {
  test('separa web de QGIS', async () => {
    const usuarioId = await idPorUuid(USER_UUID)

    await inserirLogin(usuarioId, 'sca_web')
    await inserirLogin(usuarioId, 'sca_web')
    await inserirLogin(usuarioId, 'sca_qgis')

    const res = await request(app)
      .get('/api/acessos/logins/clientes')
      .set('Authorization', admin())

    expect(res.status).toBe(200)
    expect(res.body.dados).toEqual([
      { cliente: 'sca_web', logins: 2 },
      { cliente: 'sca_qgis', logins: 1 }
    ])
  })

  test('sem login no periodo devolve lista vazia, e nao os clientes com zero', async () => {
    const usuarioId = await idPorUuid(USER_UUID)
    await inserirLogin(usuarioId, 'sca_web', "now() - INTERVAL '60 days'")

    const res = await request(app)
      .get('/api/acessos/logins/clientes?total=30')
      .set('Authorization', admin())

    expect(res.body.dados).toEqual([])
  })

  test('nao aceita ?max: a lista de clientes e fechada', async () => {
    const res = await request(app)
      .get('/api/acessos/logins/clientes?max=5')
      .set('Authorization', admin())

    expect(res.status).toBe(400)
  })
})
