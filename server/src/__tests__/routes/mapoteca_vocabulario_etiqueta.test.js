'use strict'

// O VOCABULARIO DA ETIQUETA (2026-08-11), contra o banco de verdade.
//
// POR QUE A ROTA EXISTE. A busca por etiqueta casa o texto INTEIRO e diferencia
// maiuscula de minuscula, porque e o que o indice GIN de
// `mapoteca.pedido.palavras_chave` atende (`@>`). O cadastro, do outro lado, era
// um campo livre sem sugestao nenhuma. As duas coisas juntas produziram, em tres
// dias de 2026 na producao, 34 grafias distintas em 50 usos, com 'excedente',
// 'excedentes' e 'exemplares excedentes' partindo sete pedidos do MESMO assunto
// em tres listas que nao se encontram.
//
// `GET /pedido/palavras_chave` e o conserto: a tela oferece a etiqueta que ja
// existe antes de a pessoa digitar a variante. O campo continua livre, e
// etiqueta nova nasce pela tela, sem migracao.
//
// O QUE ESTE ARQUIVO GUARDA, e que teste de schema nenhum alcanca: que a rota
// literal nao caiu em '/pedido/:id', que ela atravessa o ANO (a lista de pedidos
// nao atravessa), que a contagem e por PEDIDO, que a ordem serve a sugestao, e
// que ela cobra perfil no modulo certo.

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

const criaCliente = async (nome) => {
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

const etiquetas = () =>
  request(app)
    .get('/api/mapoteca/pedido/palavras_chave')
    .set('Authorization', generateAdminToken())

describe('GET /api/mapoteca/pedido/palavras_chave', () => {
  it('devolve cada etiqueta uma vez, com quantos PEDIDOS a usam', async () => {
    const cliente = await criaCliente('OM do vocabulario')
    await criaPedido(cliente, { palavras_chave: ['excedente', 'fronteira'] })
    await criaPedido(cliente, { palavras_chave: ['excedente'] })
    await criaPedido(cliente, { palavras_chave: [] })

    const res = await etiquetas()

    expect(res.status).toBe(200)
    const mapa = new Map(res.body.dados.map(p => [p.etiqueta, p.pedidos]))
    expect(mapa.get('excedente')).toBe(2)
    expect(mapa.get('fronteira')).toBe(1)
  })

  it('a mais usada vem primeiro, porque e a que a sugestao deve oferecer', async () => {
    const cliente = await criaCliente('OM da ordem')
    await criaPedido(cliente, { palavras_chave: ['excedente', 'fronteira'] })
    await criaPedido(cliente, { palavras_chave: ['excedente'] })
    await criaPedido(cliente, { palavras_chave: ['excedente'] })

    const res = await etiquetas()

    const lista = res.body.dados.map(p => p.etiqueta)
    expect(lista.indexOf('excedente')).toBeLessThan(lista.indexOf('fronteira'))
  })

  it('ATRAVESSA o ano, ao contrario da lista de pedidos', async () => {
    // Sugerir so as etiquetas do ano corrente faria a grafia que dezembro ja
    // tinha resolvido renascer em janeiro, que e o defeito que a rota conserta.
    const cliente = await criaCliente('OM de dois anos')
    await criaPedido(cliente, { data_pedido: '2025-05-10', palavras_chave: ['excedente'] })
    await criaPedido(cliente, { data_pedido: '2026-05-10', palavras_chave: ['fronteira'] })

    const res = await etiquetas()

    const lista = res.body.dados.map(p => p.etiqueta)
    expect(lista).toEqual(expect.arrayContaining(['excedente', 'fronteira']))
  })

  it('a etiqueta que so difere na CAIXA sai como duas, e e o defeito que a lista denuncia', async () => {
    // A rota NAO normaliza, de proposito: ela mostra o banco como ele esta. Ver
    // duas linhas quase iguais na sugestao e o sinal de que uma delas precisa
    // sumir, e a busca (`@>`, sensivel a maiuscula) so acha uma de cada vez.
    const cliente = await criaCliente('OM da caixa')
    await criaPedido(cliente, { palavras_chave: ['excedente'] })
    await criaPedido(cliente, { palavras_chave: ['Excedente'] })

    const res = await etiquetas()

    const lista = res.body.dados.map(p => p.etiqueta)
    expect(lista).toEqual(expect.arrayContaining(['excedente', 'Excedente']))
  })

  it('sem pedido com etiqueta, devolve lista vazia e nao erro', async () => {
    const cliente = await criaCliente('OM sem etiqueta')
    await criaPedido(cliente, { palavras_chave: [] })

    const res = await etiquetas()

    expect(res.status).toBe(200)
    expect(res.body.dados).toEqual([])
  })

  // A ROTA LITERAL VEM ANTES DE '/pedido/:id'. Sem a ordem, 'palavras_chave'
  // casaria com ':id' e o erro sairia como "id de pedido invalido", que nao diz
  // nada a quem chamou. E o mesmo cuidado que '/pedido/em_aberto' ja exigia.
  it('nao cai na rota de detalhe do pedido', async () => {
    const res = await etiquetas()

    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.dados)).toBe(true)
    expect(res.body.message).toMatch(/Palavras-chave/)
  })

  // O MODULO da guarda quem cobra e `routes/modulo_em_toda_rota.test.js`, que le
  // o fonte e exige o segundo argumento de `verifyPerfil` em toda rota da
  // mapoteca. Repetir aqui um `expect([200, 403]).toContain(...)` seria uma
  // verificacao que nao pode falhar, e verificacao assim nao e verificacao.

  it('sem token, 401', async () => {
    const res = await request(app).get('/api/mapoteca/pedido/palavras_chave')

    expect(res.status).toBe(401)
  })
})
