'use strict'

/**
 * O ITEM DO PEDIDO DECLARA A META DO PIT QUE ELE CUMPRE, sobrepondo a do pedido.
 *
 * O QUE FORÇOU ISTO, medido em 2026-08-06 contra o documento do PIT de
 * impressão: a Meta 4 se divide por MATERIAL (sulfite na 4.1, tyvek na 4.2,
 * glossy na 4.3), e o material é `tipo_midia_id`, que vive no ITEM. Dos 16
 * pedidos de 2026 ligados à Meta 4, DOIS são mistos: o 140 tem 8 folhas em
 * tyvek e 32 em sulfite, e o 154 tem 4 e 20. Com a meta só no pedido, as 12
 * folhas de tyvek desses dois caíam na 4.1.
 *
 * QUEBRAR O PEDIDO EM DOIS SERIA PIOR: o pedido é o documento de uma
 * solicitação real de uma OM, e inventar um segundo pedido para caber num
 * modelo de dados falsifica o registro do que a OM pediu.
 *
 * O contrato que estes testes prendem:
 *   - item sem declaração conta na meta do PEDIDO (o caso comum, 14 dos 16);
 *   - item com declaração conta na META DELE, e sai da do pedido;
 *   - a soma das duas metas continua sendo o total do pedido (nada some, nada
 *     conta duas vezes);
 *   - declarar meta em item de pedido fora do PIT é 400, e não vínculo órfão.
 */

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

const admin = () => generateAdminToken()

const ANO = 2026

/**
 * Grupo + item do PIT. É o ITEM que `meta_pit_id` aponta, e não o grupo.
 *
 * A DECLARAÇÃO NA REVISÃO É OBRIGATÓRIA, e não enfeite da fixtura: a descrição
 * da meta mora em `pit.meta_item_revisao`, e é por ela que `pit.meta_vigente`
 * enxerga o item. Sem a R0 declarada, o item existe mas some de toda leitura da
 * execução, e um teste que espere "0" nele passa sem provar nada.
 */
const criaMetaPit = async (item) => {
  const numeroMeta = parseInt(String(item).split('.')[0], 10)
  const grupo = await conn.one(
    `INSERT INTO pit.meta (ano, numero_meta, nome, usuario_cadastramento_uuid)
     VALUES ($1, $2, $3, (SELECT uuid FROM dgeo.usuario ORDER BY id LIMIT 1))
     ON CONFLICT (ano, numero_meta) DO UPDATE SET ano = EXCLUDED.ano
     RETURNING id`,
    [ANO, numeroMeta, `Meta ${numeroMeta}`]
  )
  // `origem_id` 4 é Impressão, e NÃO é detalhe da fixtura: o diagnóstico
  // exclui a meta Manual de propósito (ela não tem entidade que a cumpra, o
  // número dela é o lançamento). Com o default 1, a meta some da resposta e o
  // teste lê 0 tanto antes quanto depois, aprovando qualquer implementação.
  const row = await conn.one(
    `INSERT INTO pit.meta_item (meta_id, item, unidade_id, origem_id, usuario_cadastramento_uuid)
     VALUES ($1, $2, 1, 4, (SELECT uuid FROM dgeo.usuario ORDER BY id LIMIT 1))
     ON CONFLICT (meta_id, item) DO UPDATE SET origem_id = EXCLUDED.origem_id
     RETURNING id`,
    [grupo.id, item]
  )
  const revisao = await conn.one(
    `INSERT INTO pit.revisao (ano, codigo, data_vigencia, usuario_cadastramento_uuid)
     VALUES ($1, 'R0', make_date($1, 1, 1), (SELECT uuid FROM dgeo.usuario ORDER BY id LIMIT 1))
     ON CONFLICT (ano, codigo) DO UPDATE SET ano = EXCLUDED.ano
     RETURNING id`,
    [ANO]
  )
  await conn.none(
    `INSERT INTO pit.meta_item_revisao
       (meta_item_id, revisao_id, descricao, usuario_cadastramento_uuid)
     VALUES ($1, $2, $3, (SELECT uuid FROM dgeo.usuario ORDER BY id LIMIT 1))
     ON CONFLICT (meta_item_id, revisao_id) DO UPDATE SET descricao = EXCLUDED.descricao`,
    [row.id, revisao.id, `Meta ${item}`]
  )
  // BIGSERIAL volta como STRING no driver, e o Joi do pedido pede number strict.
  return Number(row.id)
}

const criaCliente = async () => {
  const res = await request(app)
    .post('/api/mapoteca/cliente')
    .set('Authorization', admin())
    .send({ nome: `Cliente ${Date.now()}${Math.round(Math.random() * 1e6)}`, tipo_cliente_id: 1 })
  expect(res.status).toBe(201)
  const row = await conn.one(
    'SELECT id FROM mapoteca.cliente ORDER BY id DESC LIMIT 1'
  )
  return row.id
}

const criaPedido = async (clienteId, overrides = {}) => {
  const res = await request(app)
    .post('/api/mapoteca/pedido')
    .set('Authorization', admin())
    .send({
      data_pedido: '2026-06-01T10:00:00-03:00',
      cliente_id: clienteId,
      situacao_pedido_id: 2,
      ...overrides
    })
  expect(res.status).toBe(201)
  return res.body.dados
}

// MI único por chamada: `unique_produto_identidade` cobre
// (mi, escala, tipo, subtipo), e dois produtos com o MI padrão colidem.
let sequencia = 0
const criaVersao = async () => {
  sequencia += 1
  const produto = await createProduto({ mi: `MI-META-${sequencia}` })
  const versao = await createVersao(produto.id, {})
  return versao.uuid_versao
}

const postItem = (body) =>
  request(app)
    .post('/api/mapoteca/produto_pedido')
    .set('Authorization', admin())
    .send(body)

/**
 * O diagnóstico do cadastro, meta a meta. É a leitura que soma os itens dos
 * pedidos ligados à meta, e é ela que estava contando o tyvek na 4.1.
 *
 * `cadastradas`, e não `registros`: o primeiro é a FOLHA (previstas + sem_data
 * + fora_do_ano), que é a unidade da meta; o segundo conta pedidos distintos, e
 * daria 1 onde a meta promete 247.
 */
const linhaDoDiagnostico = async (item) => {
  const res = await request(app)
    .get(`/api/metas/execucao/diagnostico?ano=${ANO}`)
    .set('Authorization', admin())
  expect(res.status).toBe(200)
  return (res.body.dados || []).find(l => l.item === item) || null
}

const cadastradasNaMeta = async (item) => {
  const linha = await linhaDoDiagnostico(item)
  return linha ? Number(linha.cadastradas) : 0
}

const metaApareceNoDiagnostico = async (item) =>
  (await linhaDoDiagnostico(item)) !== null

describe('a meta do PIT declarada no item do pedido', () => {
  test('SEM declaração, o item conta na meta do PEDIDO', async () => {
    const metaSulfite = await criaMetaPit('4.1')
    const cliente = await criaCliente()
    const pedido = await criaPedido(cliente, {
      previsto_pit: true,
      meta_pit_id: metaSulfite
    })

    const res = await postItem({
      pedido_id: pedido.id,
      uuid_versao: await criaVersao(),
      quantidade: 32,
      tipo_midia_id: 5
    })
    expect(res.status).toBe(201)

    const gravado = await conn.one(
      'SELECT meta_pit_id FROM mapoteca.produto_pedido WHERE pedido_id = $1',
      [pedido.id]
    )
    // NULL no banco, e não a meta do pedido copiada: copiar faria a herança
    // congelar, e trocar a meta do pedido deixaria os itens para trás.
    expect(gravado.meta_pit_id).toBeNull()
  })

  test('COM declaração, o item conta na meta DELE e sai da do pedido', async () => {
    const metaSulfite = await criaMetaPit('4.1')
    const metaTyvek = await criaMetaPit('4.2')
    const cliente = await criaCliente()
    // O pedido misto real: ele é da 4.1, e tem folha de tyvek dentro.
    const pedido = await criaPedido(cliente, {
      previsto_pit: true,
      meta_pit_id: metaSulfite,
      data_prevista: '2026-07-01'
    })

    const sulfite = await postItem({
      pedido_id: pedido.id,
      uuid_versao: await criaVersao(),
      quantidade: 32,
      tipo_midia_id: 5
    })
    expect(sulfite.status).toBe(201)

    const tyvek = await postItem({
      pedido_id: pedido.id,
      uuid_versao: await criaVersao(),
      quantidade: 8,
      tipo_midia_id: 8,
      meta_pit_id: metaTyvek
    })
    expect(tyvek.status).toBe(201)

    // A CONTA, que é o motivo de tudo isto existir. Sem a sobreposição, a 4.1
    // levaria as 40 folhas e a 4.2 levaria zero.
    const linhas = await conn.any(
      `SELECT mi.item, SUM(pp.quantidade)::int AS folhas
       FROM mapoteca.produto_pedido pp
       JOIN mapoteca.pedido p ON p.id = pp.pedido_id
       JOIN pit.meta_item mi ON mi.id = COALESCE(pp.meta_pit_id, p.meta_pit_id)
       WHERE p.id = $1
       GROUP BY mi.item
       ORDER BY mi.item`,
      [pedido.id]
    )
    expect(linhas).toEqual([
      { item: '4.1', folhas: 32 },
      { item: '4.2', folhas: 8 }
    ])

    // NADA SOME E NADA CONTA DUAS VEZES: a soma das metas é o total do pedido.
    const total = linhas.reduce((s, l) => s + l.folhas, 0)
    const doPedido = await conn.one(
      'SELECT SUM(quantidade)::int AS n FROM mapoteca.produto_pedido WHERE pedido_id = $1',
      [pedido.id]
    )
    expect(total).toBe(doPedido.n)
  })

  test('o diagnóstico do PIT enxerga a folha na meta declarada no item', async () => {
    const metaSulfite = await criaMetaPit('4.1')
    await criaMetaPit('4.2')
    const cliente = await criaCliente()
    const pedido = await criaPedido(cliente, {
      previsto_pit: true,
      meta_pit_id: metaSulfite,
      data_prevista: '2026-07-01'
    })

    // VARIÂNCIA PRIMEIRO: a 4.2 tem de estar NA RESPOSTA, senão "0" só diz que
    // a meta não apareceu, e o teste aprovaria qualquer implementação.
    expect(await metaApareceNoDiagnostico('4.2')).toBe(true)

    // A 4.2 não tem pedido NENHUM apontando para ela: tudo que ela vir vem da
    // declaração do item. Sem isto o teste passaria mesmo com a leitura velha.
    const antes = await cadastradasNaMeta('4.2')
    expect(antes).toBe(0)

    const metaTyvek = await conn.one(
      `SELECT mi.id FROM pit.meta_item mi
       JOIN pit.meta m ON m.id = mi.meta_id
       WHERE m.ano = $1 AND mi.item = '4.2'`,
      [ANO]
    )
    const res = await postItem({
      pedido_id: pedido.id,
      uuid_versao: await criaVersao(),
      quantidade: 8,
      tipo_midia_id: 8,
      meta_pit_id: Number(metaTyvek.id)
    })
    expect(res.status).toBe(201)

    // A checagem só vale porque REPROVA o estado anterior: era 0, virou 8.
    expect(await cadastradasNaMeta('4.2')).toBe(8)
  })

  test('item de pedido FORA do PIT não declara meta: 400, e nada é gravado', async () => {
    const meta = await criaMetaPit('4.1')
    const cliente = await criaCliente()
    const pedido = await criaPedido(cliente, { previsto_pit: false })

    const res = await postItem({
      pedido_id: pedido.id,
      uuid_versao: await criaVersao(),
      quantidade: 5,
      tipo_midia_id: 5,
      meta_pit_id: meta
    })

    expect(res.status).toBe(400)
    // A mensagem ENSINA a saída, em vez de só dizer não.
    expect(res.body.message).toMatch(/previsto no PIT/i)

    const itens = await conn.any(
      'SELECT id FROM mapoteca.produto_pedido WHERE pedido_id = $1',
      [pedido.id]
    )
    // Recusa que grava metade é pior que recusa.
    expect(itens).toHaveLength(0)
  })

  test('a meta com item de pedido apontando não se apaga', async () => {
    const metaSulfite = await criaMetaPit('4.1')
    const metaTyvek = await criaMetaPit('4.2')
    const cliente = await criaCliente()
    const pedido = await criaPedido(cliente, {
      previsto_pit: true,
      meta_pit_id: metaSulfite
    })
    await postItem({
      pedido_id: pedido.id,
      uuid_versao: await criaVersao(),
      quantidade: 8,
      tipo_midia_id: 8,
      meta_pit_id: metaTyvek
    })

    // NENHUM PEDIDO aponta a 4.2: só o item. A guarda que olhasse apenas
    // `mapoteca.pedido` deixaria passar, e o 400 viraria 500 da chave
    // estrangeira depois.
    const res = await request(app)
      .delete(`/api/metas/${metaTyvek}`)
      .set('Authorization', admin())

    expect(res.status).toBe(409)
    const ainda = await conn.oneOrNone(
      'SELECT id FROM pit.meta_item WHERE id = $1', [metaTyvek]
    )
    expect(ainda).not.toBeNull()
  })
})
