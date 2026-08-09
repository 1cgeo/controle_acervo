'use strict'

// O PERFIL DE CADA ROTA DE CAMPO, contra o banco e as rotas de verdade.
//
// A RÉGUA DA CASA, de 2026-08-08: `consulta` LÊ as telas do módulo, `operador`
// LANÇA, `gerente` responde pela área. Em campo isso quer dizer:
//
//   consulta  vê a lista, o mapa, a ficha, as fotos e os trajetos
//   operador  o mesmo, mais LANÇAR: cadastra e corrige o campo, sobe foto e
//             vídeo, importa trajeto
//   gerente   o mesmo, mais APAGAR o campo
//
// A EXCLUSÃO É DE GERENTE, e é a única assimetria. O `ON DELETE CASCADE` do DDL
// leva as categorias, os militares, as versões, as fotos, os vídeos, os
// trajetos e os pontos de GPS: apagar um campo de 2019 destrói as únicas cópias
// daquelas fotos. É o mesmo critério que pôs a remoção de tipo do `equipamento`
// no piso de gerente -- não é a escrita que pesa, é o alcance dela.
//
// Apagar FOTO e TRAJETO continua no operador, e não é incoerência: quem subiu o
// arquivo errado há um minuto tem de poder tirá-lo, e o alcance é uma linha.
//
// O MÓDULO É `pit`, E NÃO UM MÓDULO NOVO. `dominio.modulo` continua com
// seis linhas: a tela mora na seção PIT, e campo é o trabalho que o PIT promete.
//
// A ARMADILHA QUE ISTO GUARDA, e ela é do CLAUDE.md: o default de
// `verifyPerfil(minimo, modulo)` é 'acervo'. Uma rota daqui que esquecesse o
// segundo argumento passaria a cobrar perfil no ACERVO -- e o usuário semeado é
// `consulta` no acervo, então metade das leituras continuaria respondendo 200.
// Pior que no equipamento: até 2026-08-08 `modulo_em_toda_rota.test.js` varria
// só `orcamento` e `mapoteca`, e o próprio CLAUDE.md avisava que "em producao e
// em efetivo, ninguém cobra por você". Agora ele varre `campo` também, e este
// arquivo mede o comportamento.

const request = require('supertest')
const { getApp } = require('../helpers/app')
const { conn, cleanTestData } = require('../helpers/db')
const {
  generateUserToken, USER_UUID, ADMIN_UUID
} = require('../helpers/auth')
const { SITUACAO_CAMPO, CATEGORIA_CAMPO } = require('../../utils/domain_constants')

const MODULO = { pit: 4 }
const NIVEL = { consulta: 1, operador: 2, gerente: 3 }

let app

beforeAll(async () => {
  app = await getApp()
})

// A CONCESSÃO SE DESFAZ AQUI, e nos dois lados.
//
// `cleanTestData` apaga `dgeo.usuario_perfil` só de quem está FORA da semente, e
// o usuário de teste está DENTRO: a linha de `pit` ficaria e vazaria para
// todo arquivo que rodasse depois neste worker. Já mordeu três vezes neste
// projeto em 2026-08-08, e o sintoma aparece longe da causa.
//
// O `beforeEach` defende ESTE arquivo de quem veio antes; o `afterEach` defende
// quem vem depois. Só o primeiro protege do vazamento alheio.
const semPerfilEmProducao = () =>
  conn.none(
    `DELETE FROM dgeo.usuario_perfil
      WHERE modulo_id = $2 AND usuario_id = (SELECT id FROM dgeo.usuario WHERE uuid = $1)`,
    [USER_UUID, MODULO.pit]
  )

beforeEach(semPerfilEmProducao)

afterEach(async () => {
  await semPerfilEmProducao()
  await conn.none('DELETE FROM campo.campo')
  await cleanTestData()
})

const daPerfil = (nivel) =>
  conn.none(
    `INSERT INTO dgeo.usuario_perfil (usuario_id, modulo_id, perfil_id)
     SELECT id, $2, $3 FROM dgeo.usuario WHERE uuid = $1
     ON CONFLICT (usuario_id, modulo_id) DO UPDATE SET perfil_id = EXCLUDED.perfil_id`,
    [USER_UUID, MODULO.pit, nivel]
  )

const usuario = () => generateUserToken()

// --- Cenário mínimo ---------------------------------------------------------
//
// As rotas de escrita precisam de um campo, de uma imagem e de um trajeto que
// existam, senão o 404 se confundiria com a recusa por perfil.
//
// O ANO PRECISA DE EXERCÍCIO NO PIT, e é a primeira coisa que o cenário monta:
// `campo.ano` referencia `pit.pit`, e sem a linha do ano a chave
// estrangeira recusaria o INSERT com um erro que se leria como falha do teste.

const AREA = 'POLYGON((-53 -29,-52 -29,-52 -28,-53 -28,-53 -29))'
const ANO = 2026

let cenario = 0
const semear = async () => {
  cenario += 1

  await conn.none(
    `INSERT INTO pit.pit (ano, situacao_id, usuario_cadastramento_uuid)
     VALUES ($1, 2, $2) ON CONFLICT (ano) DO NOTHING`,
    [ANO, ADMIN_UUID]
  )

  const campo = await conn.one(
    `INSERT INTO campo.campo
       (nome, ano, situacao_id, data_inicio, data_fim, geom, usuario_cadastramento_uuid)
     VALUES ($1, $2, $3, '2026-07-28', '2026-08-03',
             ST_Multi(ST_GeomFromText($4, 4674)), $5)
     RETURNING id`,
    [`Reambulação de ensaio ${cenario}`, ANO, SITUACAO_CAMPO.FINALIZADO, AREA, ADMIN_UUID]
  )
  await conn.none(
    'INSERT INTO campo.campo_categoria (campo_id, categoria_id) VALUES ($1, $2)',
    [campo.id, CATEGORIA_CAMPO.REAMBULACAO]
  )

  const imagem = await conn.one(
    `INSERT INTO campo.imagem (campo_id, descricao, tipo, conteudo, usuario_cadastramento_uuid)
     VALUES ($1, 'Marco', 'foto', decode('Zm90bw==', 'base64'), $2) RETURNING id`,
    [campo.id, ADMIN_UUID]
  )

  const track = await conn.one(
    `INSERT INTO campo.track
       (campo_id, chefe_vtr, motorista, placa_vtr, dia, usuario_cadastramento_uuid)
     VALUES ($1, '2º Sgt Ramos', 'Cb Bueno', 'EB-1234', '2026-07-28', $2) RETURNING id`,
    [campo.id, ADMIN_UUID]
  )

  return { campoId: campo.id, imagemId: imagem.id, trackId: track.id }
}

const corpoDeCampo = (c, sufixo) => ({
  nome: `Reambulação nova ${c.campoId}${sufixo || ''}`,
  descricao: null,
  ano: ANO,
  situacao_id: SITUACAO_CAMPO.FINALIZADO,
  data_inicio: '2026-07-28',
  data_fim: '2026-08-03',
  placas_vtr: null,
  militares_externos: null,
  categorias: [CATEGORIA_CAMPO.REAMBULACAO],
  militares: [],
  versoes: [],
  geometria: JSON.stringify({
    type: 'Polygon',
    coordinates: [[[-53, -29], [-52, -29], [-52, -28], [-53, -28], [-53, -29]]]
  })
})

/**
 * As rotas, com o piso de perfil de cada uma.
 *
 * A LISTA É ESCRITA À MÃO, e não derivada do roteador: derivá-la faria o teste
 * concordar com qualquer troca de piso. Ela é a tabela do contrato.
 */
const ROTAS = [
  // --- consulta LÊ ---------------------------------------------------------
  ['consulta', 'get', () => '/api/campo/dominio', null],
  ['consulta', 'get', () => '/api/campo', null],
  ['consulta', 'get', () => '/api/campo/geojson', null],
  ['consulta', 'get', c => `/api/campo/${c.campoId}`, null],
  ['consulta', 'get', c => `/api/campo/${c.campoId}/imagem`, null],
  ['consulta', 'get', c => `/api/campo/${c.campoId}/track`, null],
  ['consulta', 'get', c => `/api/campo/imagem/${c.imagemId}/arquivo`, null],

  // --- operador LANÇA ------------------------------------------------------
  ['operador', 'post', () => '/api/campo', c => corpoDeCampo(c, ' A')],
  ['operador', 'put', c => `/api/campo/${c.campoId}`, c => corpoDeCampo(c, ' B')],
  ['operador', 'post', c => `/api/campo/${c.campoId}/imagem`,
    () => ({
      descricao: 'Marco novo',
      data_imagem: '2026-07-29',
      tipo: 'foto',
      mime_type: 'image/jpeg',
      conteudo_base64: 'Zm90bw=='
    })],
  ['operador', 'put', c => `/api/campo/imagem/${c.imagemId}`,
    () => ({ descricao: 'Outra legenda', data_imagem: null })],
  ['operador', 'delete', c => `/api/campo/imagem/${c.imagemId}`, null],
  ['operador', 'post', c => `/api/campo/${c.campoId}/track`,
    () => ({
      chefe_vtr: '2º Sgt Ramos',
      motorista: 'Cb Bueno',
      placa_vtr: 'EB-5678',
      dia: '2026-07-29',
      pontos: [
        { longitude: -53.1, latitude: -29.1, elevacao: 120, momento: '2026-07-29T13:00:00Z' },
        { longitude: -53.2, latitude: -29.2, elevacao: 130, momento: '2026-07-29T13:10:00Z' }
      ]
    })],
  ['operador', 'put', c => `/api/campo/track/${c.trackId}`,
    () => ({
      chefe_vtr: '1º Sgt André',
      motorista: 'Cb Lopes',
      placa_vtr: 'EB-1234',
      dia: '2026-07-28'
    })],
  ['operador', 'delete', c => `/api/campo/track/${c.trackId}`, null],

  // --- gerente APAGA O CAMPO ----------------------------------------------
  ['gerente', 'delete', c => `/api/campo/${c.campoId}`, null]
]

const chamar = (metodo, caminho, corpo, token) => {
  const req = request(app)[metodo](caminho).set('Authorization', token)
  return corpo ? req.send(corpo) : req
}

const rotulo = ([piso, metodo, caminho]) =>
  `${piso}: ${metodo.toUpperCase()} ${caminho({ campoId: ':id', imagemId: ':id', trackId: ':id' })}`

const casos = ROTAS.map(r => [rotulo(r), r])

// O nível IMEDIATAMENTE ABAIXO do piso, que é o que separa "a guarda existe" de
// "a guarda cobra o nível certo". Uma rota de gerente protegida por `operador`
// passaria num teste que só experimentasse `consulta`.
const ABAIXO = { operador: 'consulta', gerente: 'operador' }

describe('quem tem o perfil do piso passa', () => {
  test.each(casos)('%s', async (_nome, [piso, metodo, caminho, corpo]) => {
    const c = await semear()
    await daPerfil(NIVEL[piso])

    const res = await chamar(metodo, caminho(c), corpo && corpo(c), usuario())

    expect(res.status).not.toBe(403)
  })
})

describe('quem tem UM nível abaixo do piso leva 403', () => {
  const comPiso = casos.filter(([, r]) => ABAIXO[r[0]])

  test.each(comPiso)('%s', async (_nome, [piso, metodo, caminho, corpo]) => {
    const c = await semear()
    await daPerfil(NIVEL[ABAIXO[piso]])

    const res = await chamar(metodo, caminho(c), corpo && corpo(c), usuario())

    expect(res.status).toBe(403)
    // A MENSAGEM NOMEIA O MÓDULO, e é ela que pega a armadilha do default: com
    // o segundo argumento esquecido, a frase diria 'no módulo acervo'.
    expect(res.body.message).toMatch(
      new RegExp(`perfil ${piso} no módulo pit`, 'i')
    )
  })
})

describe('quem não tem linha nenhuma em Produção não entra, nem para ler', () => {
  test.each(casos)('%s', async (_nome, [, metodo, caminho, corpo]) => {
    // O usuário semeado é `consulta` no ACERVO e `operador` na MAPOTECA, e nada
    // em produção. Conceder é ato explícito, e sem linha não se lê nem a lista
    // de domínios.
    const c = await semear()

    const res = await chamar(metodo, caminho(c), corpo && corpo(c), usuario())

    expect(res.status).toBe(403)
  })
})

describe('sem token, tudo é 401', () => {
  test.each(casos)('%s', async (_nome, [, metodo, caminho, corpo]) => {
    const c = await semear()

    const req = request(app)[metodo](caminho(c))
    const res = await (corpo ? req.send(corpo(c)) : req)

    expect(res.status).toBe(401)
  })
})

// ---------------------------------------------------------------------------
// A FRONTEIRA QUE O CONTRATO NOMEIA
// ---------------------------------------------------------------------------
//
// AS DUAS METADES ANDAM JUNTAS DE PROPÓSITO. Provar só que o operador não apaga
// o campo deixaria a assimetria parecendo descuido; provar só que ele apaga a
// foto não diz por que ele não apaga o campo. O que separa as duas é o ALCANCE,
// e é isso que este bloco mede.

describe('o operador LANÇA e corrige, mas não APAGA o campo', () => {
  it('operador NÃO apaga o campo, e a foto continua lá', async () => {
    const c = await semear()
    await daPerfil(NIVEL.operador)

    const res = await request(app)
      .delete(`/api/campo/${c.campoId}`)
      .set('Authorization', usuario())

    expect(res.status).toBe(403)
    expect(res.body.message).toMatch(/perfil gerente no módulo pit/i)

    const sobrou = await conn.one(
      'SELECT count(*)::int AS n FROM campo.imagem WHERE campo_id = $1',
      [c.campoId]
    )
    expect(sobrou.n).toBe(1)
  })

  it('mas APAGA a foto que subiu errada, que é uma linha só', async () => {
    const c = await semear()
    await daPerfil(NIVEL.operador)

    const res = await request(app)
      .delete(`/api/campo/imagem/${c.imagemId}`)
      .set('Authorization', usuario())

    expect(res.status).toBe(200)
  })
})

describe('o gerente apaga o campo, e o CASCADE leva tudo', () => {
  it('a foto e o trajeto somem junto com o campo', async () => {
    const c = await semear()
    await daPerfil(NIVEL.gerente)

    const res = await request(app)
      .delete(`/api/campo/${c.campoId}`)
      .set('Authorization', usuario())

    expect(res.status).toBe(200)

    // É ISTO que põe a exclusão no piso de gerente: não é a linha do campo, são
    // os bytes que só existiam aqui.
    const resto = await conn.one(
      `SELECT (SELECT count(*) FROM campo.imagem WHERE campo_id = $1)::int AS imagens,
              (SELECT count(*) FROM campo.track WHERE campo_id = $1)::int AS tracks,
              (SELECT count(*) FROM campo.campo_categoria WHERE campo_id = $1)::int AS categorias`,
      [c.campoId]
    )
    expect(resto).toEqual({ imagens: 0, tracks: 0, categorias: 0 })
  })
})

// ---------------------------------------------------------------------------
// A RECUSA QUE MAIS VAI APARECER
// ---------------------------------------------------------------------------

describe('ano sem exercício do PIT é recusado, e a mensagem diz o que fazer', () => {
  it('o 400 manda cadastrar o exercício, e não fala em chave estrangeira', async () => {
    const c = await semear()
    await daPerfil(NIVEL.operador)

    // 2013 é um dos dez anos que a carga do SAP cria; aqui ele NÃO existe.
    const res = await request(app)
      .post('/api/campo')
      .set('Authorization', usuario())
      .send({ ...corpoDeCampo(c, ' de 2013'), ano: 2013 })

    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/exercício do PIT/i)
    expect(res.body.message).toMatch(/PIT do ano/i)
  })
})
