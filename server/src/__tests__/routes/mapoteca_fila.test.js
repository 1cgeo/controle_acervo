'use strict'

// A fila de atendimento (GET /api/mapoteca/pedido/em_aberto) e o que quem
// imprime ve. A situacao Aguardando producao (7) NAO entra nela: o pedido nessa
// situacao espera carta que ainda nao existe, entao nao ha o que imprimir, e a
// linha so ocupa o topo da fila sem nunca ser atendivel.
//
// Ele fica separado do mapoteca.test.js de proposito: a regra e uma so e veio
// de decisao, entao merece arquivo proprio para quem a reabrir achar o porque
// junto do teste.

const request = require('supertest')
const { getApp } = require('../helpers/app')
const { cleanTestData } = require('../helpers/db')
const { generateAdminToken } = require('../helpers/auth')

let app

beforeAll(async () => {
  app = await getApp()
})

afterEach(async () => {
  await cleanTestData()
})

const criaCliente = async (nome = 'OM Fila Aguardando') => {
  const res = await request(app)
    .post('/api/mapoteca/cliente')
    .set('Authorization', generateAdminToken())
    .send({ nome, tipo_cliente_id: 1 })
  expect(res.status).toBe(201)
  const lista = await request(app)
    .get('/api/mapoteca/cliente')
    .set('Authorization', generateAdminToken())
  return lista.body.dados.find(c => c.nome === nome).id
}

const criaPedido = async (clienteId, overrides = {}) => {
  const res = await request(app)
    .post('/api/mapoteca/pedido')
    .set('Authorization', generateAdminToken())
    .send({
      data_pedido: '2026-03-10',
      cliente_id: clienteId,
      situacao_pedido_id: 3,
      data_atendimento: null,
      ...overrides
    })
  expect(res.status).toBe(201)
  return res.body.dados
}

const fila = () => request(app)
  .get('/api/mapoteca/pedido/em_aberto')
  .set('Authorization', generateAdminToken())

// A fila de ATENDIMENTO, que e a de impressao mais o pedido Remetido (4). A
// situacao 7 tem de ficar fora das DUAS: a razao dela nao muda com a pergunta.
const filaAtendimento = () => request(app)
  .get('/api/mapoteca/pedido/em_aberto?incluir_remetidos=true')
  .set('Authorization', generateAdminToken())

describe('Fila de atendimento e a situacao Aguardando producao (7)', () => {
  it('deixa de FORA o pedido em Aguardando producao e mantem o Em andamento', async () => {
    const clienteId = await criaCliente()
    const aguardando = await criaPedido(clienteId, { situacao_pedido_id: 7 })
    const emAndamento = await criaPedido(clienteId, { situacao_pedido_id: 3 })

    const res = await fila()

    expect(res.status).toBe(200)
    const ids = res.body.dados.map(p => Number(p.id))
    // Se este pedido voltar a aparecer, a fila voltou a mostrar o impossivel.
    expect(ids).not.toContain(Number(aguardando.id))
    expect(ids).toContain(Number(emAndamento.id))
  })

  it('fica de fora TAMBEM da fila de atendimento (incluir_remetidos=true)', async () => {
    // A fila de atendimento so acrescenta o Remetido. Aguardando producao
    // continua esperando carta que nao existe, e nao ha o que fechar nele.
    const clienteId = await criaCliente('OM Fila Aguardando Atend')
    const aguardando = await criaPedido(clienteId, { situacao_pedido_id: 7 })
    const remetido = await criaPedido(clienteId, { situacao_pedido_id: 4 })

    const res = await filaAtendimento()

    expect(res.status).toBe(200)
    const ids = res.body.dados.map(p => Number(p.id))
    expect(ids).not.toContain(Number(aguardando.id))
    // O controle positivo: a fila de atendimento REALMENTE traz o Remetido,
    // entao a ausencia acima e do 7, e nao de a query ter apagado tudo.
    expect(ids).toContain(Number(remetido.id))
  })

  it('o pedido fora da fila continua VIVO na lista de pedidos do ano', async () => {
    // O corte e da fila, nao do registro. Sem esta garantia o pedido sumiria
    // das duas telas e viraria esquecimento quando a producao terminasse.
    const clienteId = await criaCliente('OM Fila Lista')
    const aguardando = await criaPedido(clienteId, { situacao_pedido_id: 7 })

    const lista = await request(app)
      .get('/api/mapoteca/pedido?ano=2026')
      .set('Authorization', generateAdminToken())

    expect(lista.status).toBe(200)
    const linha = lista.body.dados.find(p => Number(p.id) === Number(aguardando.id))
    expect(linha).toBeDefined()
    // O client filtra por este campo, entao ele TEM de sair na lista.
    expect(Number(linha.situacao_pedido_id)).toBe(7)
  })
})
