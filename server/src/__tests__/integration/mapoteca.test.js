'use strict'

// AS REGRAS DA MAPOTECA QUE MORAM NO BANCO, e só nele.
//
// O que este arquivo NÃO faz: exercitar CRUD por SQL cru. `INSERT ... RETURNING
// id` seguido de `expect(id).toBeDefined()` prova que o PostgreSQL devolve o
// que se mandou gravar, e não que o sistema funciona. O CRUD de cliente,
// pedido, plotter, manutenção e estoque passa por controller e tem prova em
// `routes/mapoteca.test.js`, pelas rotas de verdade.
//
// O que sobra aqui é o que só o banco decide, e que nenhum teste de rota
// alcança sem duplicar o cenário:
//
//   1. o gatilho que BAIXA o estoque da Seção quando entra um consumo;
//   2. a RN01, que recusa consumo sem saldo na Seção;
//   3. a restrição que impede apagar cliente que tem pedido.

const { conn, cleanTestData, closeConnection } = require('../helpers/db')

afterEach(async () => {
  await cleanTestData()
})

afterAll(async () => {
  await closeConnection()
})

const criarCliente = () =>
  conn.one(
    `INSERT INTO mapoteca.cliente (nome, tipo_cliente_id)
     VALUES ('Cliente Teste', 1) RETURNING id`
  )

const criarPedido = (clienteId) =>
  conn.one(
    `INSERT INTO mapoteca.pedido
       (data_pedido, cliente_id, situacao_pedido_id, usuario_criacao_id, usuario_atualizacao_id)
     VALUES (NOW(), $1, 1, 1, 1) RETURNING id`,
    [clienteId]
  )

const criarMaterial = (nome) =>
  conn.one(
    'INSERT INTO mapoteca.tipo_material (nome) VALUES ($1) RETURNING id',
    [nome]
  )

const semearEstoqueNaSecao = (materialId, quantidade) =>
  conn.none(
    `INSERT INTO mapoteca.estoque_material
       (tipo_material_id, quantidade, localizacao_id, usuario_criacao_id, usuario_atualizacao_id)
     VALUES ($1, $2, 1, 1, 1)`,
    [materialId, quantidade]
  )

const consumir = (materialId, quantidade) =>
  conn.one(
    `INSERT INTO mapoteca.consumo_material
       (tipo_material_id, quantidade, data_consumo, usuario_criacao_id, usuario_atualizacao_id)
     VALUES ($1, $2, NOW(), 1, 1) RETURNING id`,
    [materialId, quantidade]
  )

const saldoNaSecao = async (materialId) => {
  const linha = await conn.one(
    `SELECT quantidade FROM mapoteca.estoque_material
      WHERE tipo_material_id = $1 AND localizacao_id = 1`,
    [materialId]
  )
  return Number(linha.quantidade)
}

describe('O gatilho de consumo de material', () => {
  it('baixa do estoque da Seção exatamente o que foi consumido', async () => {
    const tinta = await criarMaterial('Tinta')
    await semearEstoqueNaSecao(tinta.id, 50)

    // O SALDO ANTES entra na prova: sem ele, um gatilho que ZERASSE a linha
    // também deixaria o caso verde, porque 40 seria só o número esperado sem
    // relação com o que havia.
    expect(await saldoNaSecao(tinta.id)).toBe(50)

    await consumir(tinta.id, 10)

    expect(await saldoNaSecao(tinta.id)).toBe(40)
  })

  // RN01: consumo só sai da Seção, e o material tem de ter sido transferido
  // para lá antes. Sem esta recusa, o estoque ficaria negativo em silêncio.
  it('recusa o consumo sem saldo na Seção, com a mensagem da regra', async () => {
    const tinta = await criarMaterial('Tinta sem estoque')

    await expect(consumir(tinta.id, 10)).rejects.toThrow(/Não há estoque na Seção/)
  })
})

describe('A restrição entre cliente e pedido', () => {
  it('impede apagar o cliente que tem pedido', async () => {
    const cliente = await criarCliente()
    await criarPedido(cliente.id)

    // A MENSAGEM entra na asserção: `rejects.toThrow()` nu aceitaria qualquer
    // erro, inclusive um de sintaxe no SQL do próprio caso.
    await expect(
      conn.none('DELETE FROM mapoteca.cliente WHERE id = $1', [cliente.id])
    ).rejects.toThrow(/pedido/)

    // E o cliente continua lá: recusar sem apagar é o contrato inteiro.
    const { total } = await conn.one(
      'SELECT COUNT(*)::int AS total FROM mapoteca.cliente WHERE id = $1',
      [cliente.id]
    )
    expect(total).toBe(1)
  })

  it('deixa apagar o cliente que não tem pedido', async () => {
    const cliente = await criarCliente()

    await conn.none('DELETE FROM mapoteca.cliente WHERE id = $1', [cliente.id])

    const { total } = await conn.one(
      'SELECT COUNT(*)::int AS total FROM mapoteca.cliente WHERE id = $1',
      [cliente.id]
    )
    expect(total).toBe(0)
  })
})
