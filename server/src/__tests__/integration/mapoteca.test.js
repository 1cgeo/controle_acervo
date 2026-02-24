'use strict'

const { conn, cleanTestData, closeConnection } = require('../helpers/db')
const { ADMIN_UUID } = require('../helpers/auth')

afterEach(async () => {
  await cleanTestData()
})

describe('Mapoteca Integration', () => {
  async function createCliente () {
    return conn.one(`
      INSERT INTO mapoteca.cliente (nome, tipo_cliente_id)
      VALUES ('Cliente Teste', 1) RETURNING id
    `)
  }

  async function createPedido (clienteId) {
    return conn.one(`
      INSERT INTO mapoteca.pedido (data_pedido, cliente_id, situacao_pedido_id, usuario_criacao_id, usuario_atualizacao_id)
      VALUES (NOW(), $1, 1, 1, 1) RETURNING id
    `, [clienteId])
  }

  describe('Clientes', () => {
    it('should create a client', async () => {
      const cliente = await createCliente()
      expect(cliente.id).toBeDefined()
    })

    it('should update a client', async () => {
      const cliente = await createCliente()
      await conn.none(`
        UPDATE mapoteca.cliente SET nome = 'Atualizado' WHERE id = $1
      `, [cliente.id])

      const found = await conn.one('SELECT nome FROM mapoteca.cliente WHERE id = $1', [cliente.id])
      expect(found.nome).toBe('Atualizado')
    })

    it('should delete a client without orders', async () => {
      const cliente = await createCliente()
      await conn.none('DELETE FROM mapoteca.cliente WHERE id = $1', [cliente.id])

      const count = await conn.one('SELECT COUNT(*)::int as count FROM mapoteca.cliente WHERE id = $1', [cliente.id])
      expect(count.count).toBe(0)
    })
  })

  describe('Pedidos', () => {
    it('should create an order linked to a client', async () => {
      const cliente = await createCliente()
      const pedido = await createPedido(cliente.id)
      expect(pedido.id).toBeDefined()
    })

    it('should prevent deleting a client with orders', async () => {
      const cliente = await createCliente()
      await createPedido(cliente.id)

      await expect(
        conn.none('DELETE FROM mapoteca.cliente WHERE id = $1', [cliente.id])
      ).rejects.toThrow()
    })
  })

  describe('Plotters', () => {
    it('should create a plotter', async () => {
      const plotter = await conn.one(`
        INSERT INTO mapoteca.plotter (nr_serie, modelo)
        VALUES ('SN-001', 'HP DesignJet') RETURNING id
      `)
      expect(plotter.id).toBeDefined()
    })

    it('should create plotter maintenance record', async () => {
      const plotter = await conn.one(`
        INSERT INTO mapoteca.plotter (nr_serie, modelo)
        VALUES ('SN-002', 'Canon') RETURNING id
      `)

      const manutencao = await conn.one(`
        INSERT INTO mapoteca.manutencao_plotter (plotter_id, data_manutencao, valor, usuario_criacao_id, usuario_atualizacao_id)
        VALUES ($1, NOW(), 500.00, 1, 1) RETURNING id
      `, [plotter.id])
      expect(manutencao.id).toBeDefined()
    })
  })

  describe('Material stock', () => {
    it('should create material type and stock', async () => {
      const tipo = await conn.one(`
        INSERT INTO mapoteca.tipo_material (nome, descricao)
        VALUES ('Papel A0', 'Papel para plotagem A0') RETURNING id
      `)

      const estoque = await conn.one(`
        INSERT INTO mapoteca.estoque_material (tipo_material_id, quantidade, localizacao_id, usuario_criacao_id, usuario_atualizacao_id)
        VALUES ($1, 100, 1, 1, 1) RETURNING id
      `, [tipo.id])
      expect(estoque.id).toBeDefined()
    })

    it('should track material consumption', async () => {
      const tipo = await conn.one(`
        INSERT INTO mapoteca.tipo_material (nome) VALUES ('Tinta') RETURNING id
      `)

      const consumo = await conn.one(`
        INSERT INTO mapoteca.consumo_material (tipo_material_id, quantidade, data_consumo, usuario_criacao_id, usuario_atualizacao_id)
        VALUES ($1, 10, NOW(), 1, 1) RETURNING id
      `, [tipo.id])
      expect(consumo.id).toBeDefined()
    })
  })
})
