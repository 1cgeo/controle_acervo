'use strict'

// A marca `layout_origem` do volume, pela API.
//
// O teste que importa e o do PUT PARCIAL. A tela do dashboard edita nome,
// caminho e capacidade, e nao conhece este campo. Se a ausencia da chave
// gravasse o default, editar o nome do volume apagaria a marca, com 200 e sem
// aviso, e o renomear-padrao passaria a mover terabytes de entrega. E a
// armadilha do PUT que `server/src/utils/preserve_omitted.js` fecha.

const request = require('supertest')
const { getApp } = require('../helpers/app')
const { cleanTestData } = require('../helpers/db')
const { generateAdminToken, generateUserToken } = require('../helpers/auth')

let app

beforeAll(async () => {
  app = await getApp()
})

afterEach(async () => {
  await cleanTestData()
})

const admin = () => generateAdminToken()

const listar = () =>
  request(app).get('/api/volumes/volume_armazenamento').set('Authorization', admin())

const criar = volume_armazenamento =>
  request(app)
    .post('/api/volumes/volume_armazenamento')
    .set('Authorization', admin())
    .send({ volume_armazenamento })

const atualizar = volume_armazenamento =>
  request(app)
    .put('/api/volumes/volume_armazenamento')
    .set('Authorization', admin())
    .send({ volume_armazenamento })

const acharPorCaminho = async caminho =>
  (await listar()).body.dados.find(v => v.volume === caminho)

describe('acervo.volume_armazenamento.layout_origem', () => {
  it('should default to false when the key is absent on create', async () => {
    const res = await criar([
      { nome: 'Volume Padrao', volume: '/data/padrao-lo', capacidade_gb: 100 }
    ])
    expect(res.status).toBe(201)

    expect((await acharPorCaminho('/data/padrao-lo')).layout_origem).toBe(false)
  })

  it('should create a volume that keeps the supplier layout', async () => {
    const res = await criar([
      {
        nome: 'Entregas Convenio',
        volume: '/data/convenio-lo',
        capacidade_gb: 100,
        layout_origem: true
      }
    ])
    expect(res.status).toBe(201)

    expect((await acharPorCaminho('/data/convenio-lo')).layout_origem).toBe(true)
  })

  // O teste central: PUT sem a chave preserva o valor gravado.
  it('should preserve the mark on an update that omits the key', async () => {
    await criar([
      {
        nome: 'Entregas Convenio',
        volume: '/data/convenio-put',
        capacidade_gb: 100,
        layout_origem: true
      }
    ])
    const antes = await acharPorCaminho('/data/convenio-put')

    const res = await atualizar([
      {
        id: Number(antes.id),
        nome: 'Entregas Convenio RS',
        volume: '/data/convenio-put',
        capacidade_gb: 2000
      }
    ])
    expect(res.status).toBe(200)

    const depois = await acharPorCaminho('/data/convenio-put')
    expect(depois.nome).toBe('Entregas Convenio RS')
    expect(depois.capacidade_gb).toBe(2000)
    expect(depois.layout_origem).toBe(true)
  })

  // Mandar false explicitamente continua desmarcando: preservar e o efeito da
  // AUSENCIA da chave, nunca do valor.
  it('should still clear the mark when false is sent explicitly', async () => {
    await criar([
      {
        nome: 'Entregas Convenio',
        volume: '/data/convenio-clear',
        capacidade_gb: 100,
        layout_origem: true
      }
    ])
    const antes = await acharPorCaminho('/data/convenio-clear')

    await atualizar([
      {
        id: Number(antes.id),
        nome: 'Entregas Convenio',
        volume: '/data/convenio-clear',
        capacidade_gb: 100,
        layout_origem: false
      }
    ])

    expect((await acharPorCaminho('/data/convenio-clear')).layout_origem).toBe(false)
  })
})

// A REGUA DA CASA: `consulta` LE as telas do modulo, `operador` LANCA. As duas
// listas de volume cobravam `operador`, e quem so consulta tomava 403 ao abrir a
// tela. O `projeto_route.js`, do mesmo modulo, ja usa `consulta` nos dois GET
// equivalentes.
describe('as leituras de volume sao de CONSULTA', () => {
  const comConsulta = (caminho) =>
    request(app).get(caminho).set('Authorization', generateUserToken())

  it('perfil de consulta le a lista de volumes', async () => {
    expect((await comConsulta('/api/volumes/volume_armazenamento')).status).toBe(200)
  })

  it('perfil de consulta le a lista de volume_tipo_produto', async () => {
    expect((await comConsulta('/api/volumes/volume_tipo_produto')).status).toBe(200)
  })

  // CONTROLE NEGATIVO: a ESCRITA continua acima da consulta. Sem ele, baixar as
  // duas leituras poderia arrastar as escritas junto sem ninguem notar.
  it('perfil de consulta NAO cria volume', async () => {
    const res = await request(app)
      .post('/api/volumes/volume_armazenamento')
      .set('Authorization', generateUserToken())
      .send({ volume_armazenamento: [{ nome: 'X', volume: '/data/x', capacidade_gb: 1 }] })

    expect(res.status).toBe(403)
  })
})
