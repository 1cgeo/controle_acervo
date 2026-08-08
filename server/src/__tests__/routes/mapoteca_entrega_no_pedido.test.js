'use strict'

// A forma de entrega e a data de entrega sao do PEDIDO, e nao do item.
//
// Decisao do chefe, depois de medir a producao: de 91 pedidos com
// item, so 1 tinha mais de uma forma de entrega e NENHUM tinha mais de uma data.
// A forma virou mapoteca.pedido.forma_entrega_id; a data ja existia com outro
// nome (data_atendimento, o dia em que o material saiu daqui) e nao ganhou
// coluna nova.
//
// Este arquivo guarda o contrato novo: o pedido ACEITA e DEVOLVE a forma, e o
// item nao grava mais nem a forma nem a data. Fica separado do mapoteca.test.js
// porque a regra mudou por decisao, e quem a reabrir acha o porque junto do
// teste.

const request = require('supertest')
const { getApp } = require('../helpers/app')
const { conn, cleanTestData } = require('../helpers/db')
const { generateAdminToken } = require('../helpers/auth')
const { createProduto, createVersao } = require('../helpers/fixtures')

let app

beforeAll(async () => {
  app = await getApp()
})

afterEach(async () => {
  await cleanTestData()
})

const criaCliente = async (nome = 'OM da Entrega') => {
  const res = await request(app)
    .post('/api/mapoteca/cliente')
    .set('Authorization', generateAdminToken())
    .send({ nome, tipo_cliente_id: 1 })
  expect(res.status).toBe(201)
  const linha = await conn.one(
    'SELECT id FROM mapoteca.cliente WHERE nome = $1 ORDER BY id DESC LIMIT 1',
    [nome]
  )
  return linha.id
}

const criaPedido = async (clienteId, overrides = {}) => {
  const res = await request(app)
    .post('/api/mapoteca/pedido')
    .set('Authorization', generateAdminToken())
    .send({
      data_pedido: '2026-03-10',
      cliente_id: clienteId,
      situacao_pedido_id: 4,
      data_atendimento: '2026-03-20',
      ...overrides
    })
  expect(res.status).toBe(201)
  return res.body.dados
}

const detalhe = (id) => request(app)
  .get(`/api/mapoteca/pedido/${id}`)
  .set('Authorization', generateAdminToken())

describe('A forma de entrega vive no PEDIDO', () => {
  it('o pedido aceita forma_entrega_id na criacao e devolve o codigo e o nome', async () => {
    const clienteId = await criaCliente()
    const pedido = await criaPedido(clienteId, { forma_entrega_id: 1 })

    const res = await detalhe(pedido.id)

    expect(res.status).toBe(200)
    expect(res.body.dados.forma_entrega_id).toBe(1)
    expect(res.body.dados.forma_entrega_nome).toBe('Correios')
  })

  // Le do BANCO, e nao da resposta da rota: o retorno do POST e eco da propria
  // escrita, e so a linha gravada prova que o campo chegou a coluna certa.
  it('a forma gravada esta na COLUNA do pedido, e nao so na resposta', async () => {
    const clienteId = await criaCliente()
    const pedido = await criaPedido(clienteId, { forma_entrega_id: 3 })

    const linha = await conn.one(
      'SELECT forma_entrega_id FROM mapoteca.pedido WHERE id = $1',
      [pedido.id]
    )
    expect(linha.forma_entrega_id).toBe(3)
  })

  it('o PUT do pedido troca a forma de entrega', async () => {
    const clienteId = await criaCliente()
    const pedido = await criaPedido(clienteId, { forma_entrega_id: 1 })

    const put = await request(app)
      .put('/api/mapoteca/pedido')
      .set('Authorization', generateAdminToken())
      .send({
        id: pedido.id,
        data_pedido: '2026-03-10',
        cliente_id: clienteId,
        situacao_pedido_id: 4,
        data_atendimento: '2026-03-20',
        forma_entrega_id: 2
      })
    expect(put.status).toBe(200)

    const res = await detalhe(pedido.id)
    expect(res.body.dados.forma_entrega_id).toBe(2)
    expect(res.body.dados.forma_entrega_nome).toBe('Entrega em mãos')
  })

  it('forma de entrega fora do dominio leva 400', async () => {
    const clienteId = await criaCliente()

    const res = await request(app)
      .post('/api/mapoteca/pedido')
      .set('Authorization', generateAdminToken())
      .send({
        data_pedido: '2026-03-10',
        cliente_id: clienteId,
        situacao_pedido_id: 2,
        forma_entrega_id: 99
      })

    expect(res.status).toBe(400)
  })

  it('a lista de pedidos e a fila de atendimento trazem a forma de entrega', async () => {
    const clienteId = await criaCliente()
    const pedido = await criaPedido(clienteId, {
      situacao_pedido_id: 3,
      data_atendimento: null,
      forma_entrega_id: 1
    })

    const lista = await request(app)
      .get('/api/mapoteca/pedido?ano=2026')
      .set('Authorization', generateAdminToken())
    expect(lista.status).toBe(200)
    const naLista = lista.body.dados.find(p => Number(p.id) === Number(pedido.id))
    expect(naLista.forma_entrega_nome).toBe('Correios')

    // A fila importa porque a ETIQUETA de envio sai dela: quem monta o pacote
    // precisa saber se ele vai aos Correios ou sai em maos.
    const fila = await request(app)
      .get('/api/mapoteca/pedido/em_aberto')
      .set('Authorization', generateAdminToken())
    expect(fila.status).toBe(200)
    const naFila = fila.body.dados.find(p => Number(p.id) === Number(pedido.id))
    expect(naFila.forma_entrega_nome).toBe('Correios')
  })

  it('a consulta publica por localizador mostra a forma UMA vez, no pedido', async () => {
    const produto = await createProduto({ tipo_produto_id: 2, tipo_escala_id: 2 })
    const versao = await createVersao(produto.id)
    const clienteId = await criaCliente()
    const pedido = await criaPedido(clienteId, { forma_entrega_id: 2 })

    const item = await request(app)
      .post('/api/mapoteca/produto_pedido')
      .set('Authorization', generateAdminToken())
      .send({
        uuid_versao: versao.uuid_versao,
        pedido_id: pedido.id,
        quantidade: 2,
        tipo_midia_id: 5
      })
    expect(item.status).toBe(201)

    // Sem autenticacao: e a rota de acompanhamento do cliente.
    const res = await request(app)
      .get(`/api/mapoteca/pedido/localizador/${pedido.localizador_pedido}`)

    expect(res.status).toBe(200)
    expect(res.body.dados.forma_entrega_nome).toBe('Entrega em mãos')
    // E NAO repetida em cada item: a forma de entrega e do PEDIDO.
    expect(res.body.dados.produtos[0].forma_entrega_nome).toBeUndefined()
  })
})

describe('O item do pedido nao guarda mais forma nem data de entrega', () => {
  const criaItemCom = async (extras) => {
    const produto = await createProduto({ tipo_produto_id: 2, tipo_escala_id: 2 })
    const versao = await createVersao(produto.id)
    const clienteId = await criaCliente()
    const pedido = await criaPedido(clienteId)

    const res = await request(app)
      .post('/api/mapoteca/produto_pedido')
      .set('Authorization', generateAdminToken())
      .send({
        uuid_versao: versao.uuid_versao,
        pedido_id: pedido.id,
        quantidade: 2,
        tipo_midia_id: 5,
        ...extras
      })
    return { res, pedido }
  }

  // O cliente velho continua funcionando, mas SABENDO que o campo nao entrou.
  // O silencio e o modo de falhar caro aqui: 201 sem aviso faria a tela antiga
  // acreditar que gravou uma data que o banco nunca viu.
  it('corpo antigo com forma e data no item passa, e o aviso diz que foram ignoradas', async () => {
    const { res } = await criaItemCom({
      forma_entrega_id: 1,
      data_entrega: '2026-03-20'
    })

    expect(res.status).toBe(201)
    expect(res.body.avisos).toBeDefined()
    expect(res.body.avisos[0]).toContain('forma_entrega_id')
    expect(res.body.avisos[0]).toContain('data_entrega')
  })

  it('o detalhe do pedido nao devolve mais os dois campos no item', async () => {
    const { pedido } = await criaItemCom({})

    const res = await detalhe(pedido.id)

    expect(res.status).toBe(200)
    const item = res.body.dados.produtos[0]
    expect(item).toBeDefined()
    expect('forma_entrega_id' in item).toBe(false)
    expect('data_entrega' in item).toBe(false)
  })

  // A prova de que as colunas SAIRAM do banco, e nao so das consultas. Sem ela
  // uma instalacao nova poderia manter as colunas mortas sem ninguem notar.
  it('as colunas nao existem mais em mapoteca.produto_pedido', async () => {
    const colunas = await conn.any(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'mapoteca' AND table_name = 'produto_pedido'
          AND column_name IN ('forma_entrega_id', 'data_entrega')`
    )
    expect(colunas).toEqual([])
  })
})

describe('Os relatorios leem a entrega no pedido', () => {
  // O cenario minimo do relatorio Detalhado: um item, e as colunas "Data da
  // Entrega" e "Forma da Entrega" vindas do pedido.
  it('o Detalhado traz data e forma do pedido, e o mes sai da data_atendimento', async () => {
    const produto = await createProduto({
      tipo_produto_id: 2, tipo_escala_id: 2, mi: 'MI-ENTREGA'
    })
    const versao = await createVersao(produto.id)
    const clienteId = await criaCliente('3º RCC da Entrega')
    const pedido = await criaPedido(clienteId, {
      data_atendimento: '2026-05-15',
      forma_entrega_id: 2
    })

    await request(app)
      .post('/api/mapoteca/produto_pedido')
      .set('Authorization', generateAdminToken())
      .send({
        uuid_versao: versao.uuid_versao,
        pedido_id: pedido.id,
        quantidade: 6,
        tipo_midia_id: 5
      })

    const res = await request(app)
      .get('/api/mapoteca/relatorio/pedidos_detalhado?ano=2026')
      .set('Authorization', generateAdminToken())

    expect(res.status).toBe(200)
    const linha = res.body.dados.find(l => l.mi === 'MI-ENTREGA')
    expect(linha.forma_entrega).toBe('Entrega em mãos')
    // Sem hora e sem fuso: a coluna e DATE, e o .ods a escreve como data.
    expect(linha.data_entrega).toBe('2026-05-15')
    expect(linha.mes).toBe(5)
  })
})
