'use strict'

const request = require('supertest')
const { getApp } = require('../helpers/app')
const { conn, cleanTestData } = require('../helpers/db')
const { generateAdminToken } = require('../helpers/auth')
const { createProduto, createVersao, createArquivo } = require('../helpers/fixtures')

let app

beforeAll(async () => {
  app = await getApp()
})

afterEach(async () => {
  await cleanTestData()
})

// --- Helpers locais ---------------------------------------------------------

const criaCliente = async (overrides = {}) => {
  const body = {
    nome: 'OM Teste',
    tipo_cliente_id: 1,
    ...overrides
  }
  const res = await request(app)
    .post('/api/mapoteca/cliente')
    .set('Authorization', generateAdminToken())
    .send(body)
  expect(res.status).toBe(201)
  const row = await conn.one(
    'SELECT id FROM mapoteca.cliente WHERE nome = $1 ORDER BY id DESC LIMIT 1',
    [body.nome]
  )
  return row.id
}

const criaPedido = async (clienteId, overrides = {}) => {
  const body = {
    data_pedido: '2026-06-01T10:00:00-03:00',
    cliente_id: clienteId,
    situacao_pedido_id: 4,
    data_atendimento: '2026-06-20T10:00:00-03:00',
    ...overrides
  }
  const res = await request(app)
    .post('/api/mapoteca/pedido')
    .set('Authorization', generateAdminToken())
    .send(body)
  expect(res.status).toBe(201)
  return res.body.dados
}

const criaProdutoPedido = async (body) => {
  const res = await request(app)
    .post('/api/mapoteca/produto_pedido')
    .set('Authorization', generateAdminToken())
    .send(body)
  expect(res.status).toBe(201)
}

// --- Testes -----------------------------------------------------------------

describe('Integracao Routes (públicas)', () => {
  describe('GET /api/integracao/acervo/situacao_geral', () => {
    it('should return coverage by sheet without auth', async () => {
      const produto = await createProduto({ tipo_produto_id: 2, tipo_escala_id: 2, mi: '2753-1', inom: 'SH-22-Y-A-I-2' })
      await createVersao(produto.id, { data_criacao: '2026-05-01T12:00:00-03:00', data_edicao: '2026-06-15T12:00:00-03:00' })

      const res = await request(app).get('/api/integracao/acervo/situacao_geral?escala=50k')

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(Array.isArray(res.body.dados['50k'])).toBe(true)
      const feature = res.body.dados['50k'].find(f => f.properties.identificadorMI === '2753-1')
      expect(feature).toBeDefined()
      expect(feature.properties.edicoes_topo).toContain('2026')
      expect(feature.properties.situacao_topo).toBe('Concluído')
      // geom omitido por padrão
      expect(feature.geometry).toBeUndefined()
    })

    it('should include geometry when geom=true', async () => {
      const produto = await createProduto({ tipo_produto_id: 2, tipo_escala_id: 2, mi: '2753-1' })
      await createVersao(produto.id, { data_criacao: '2026-05-01T12:00:00-03:00', data_edicao: '2026-06-15T12:00:00-03:00' })

      const res = await request(app).get('/api/integracao/acervo/situacao_geral?escala=50k&geom=true')

      expect(res.status).toBe(200)
      const feature = res.body.dados['50k'][0]
      expect(feature.geometry).toBeDefined()
      expect(feature.geometry.type).toBe('Polygon')
    })

    it('should filter by mi list', async () => {
      const p1 = await createProduto({ tipo_produto_id: 2, tipo_escala_id: 2, mi: '2753-1' })
      await createVersao(p1.id, { data_criacao: '2026-05-01T12:00:00-03:00', data_edicao: '2026-06-15T12:00:00-03:00' })
      const p2 = await createProduto({ tipo_produto_id: 2, tipo_escala_id: 2, mi: '2754-2' })
      await createVersao(p2.id, { data_criacao: '2026-05-01T12:00:00-03:00', data_edicao: '2026-06-15T12:00:00-03:00' })

      const res = await request(app).get('/api/integracao/acervo/situacao_geral?escala=50k&mi=2753-1')

      expect(res.status).toBe(200)
      const mis = res.body.dados['50k'].map(f => f.properties.identificadorMI)
      expect(mis).toContain('2753-1')
      expect(mis).not.toContain('2754-2')
    })
  })

  describe('GET /api/integracao/acervo/produtos_finalizados', () => {
    // Dois produtos finalizados em meses diferentes; ambos cadastrados agora
    // (data_cadastramento = hoje). O filtro deve usar data_edicao, não cadastro.
    const setupDoisFinalizados = async () => {
      const pJun = await createProduto({ tipo_produto_id: 2, tipo_escala_id: 2, mi: '2753-1' })
      await createVersao(pJun.id, { data_criacao: '2026-05-01T12:00:00-03:00', data_edicao: '2026-06-15T12:00:00-03:00' })
      const pMar = await createProduto({ tipo_produto_id: 2, tipo_escala_id: 2, mi: '2754-2' })
      await createVersao(pMar.id, { data_criacao: '2026-02-01T12:00:00-03:00', data_edicao: '2026-03-10T12:00:00-03:00' })
    }

    it('should list only the version finalized in the month (by data_edicao, not cadastro)', async () => {
      await setupDoisFinalizados()

      const res = await request(app).get('/api/integracao/acervo/produtos_finalizados?ano=2026&mes=6&cumulativo=false')

      expect(res.status).toBe(200)
      expect(res.body.dados.total).toBe(1)
      expect(res.body.dados.produtos[0].mi).toBe('2753-1')
      expect(res.body.dados.produtos[0].tipo_produto).toBe('Carta Topográfica')
      expect(res.body.dados.produtos[0].escala).toBe('1:50.000')
      expect(Array.isArray(res.body.dados.produtos[0].situacao_carregamento)).toBe(true)
      expect(res.body.dados.resumo).toHaveLength(1)
    })

    it('should list March version when querying mes=3', async () => {
      await setupDoisFinalizados()

      const res = await request(app).get('/api/integracao/acervo/produtos_finalizados?ano=2026&mes=3&cumulativo=false')

      expect(res.status).toBe(200)
      expect(res.body.dados.total).toBe(1)
      expect(res.body.dados.produtos[0].mi).toBe('2754-2')
    })

    it('should accumulate from January to the month when cumulativo=true', async () => {
      await setupDoisFinalizados()

      const res = await request(app).get('/api/integracao/acervo/produtos_finalizados?ano=2026&mes=6&cumulativo=true')

      expect(res.status).toBe(200)
      expect(res.body.dados.total).toBe(2)
    })

    it('should reflect situacao_carregamento from the version files', async () => {
      const produto = await createProduto({ tipo_produto_id: 2, tipo_escala_id: 2, mi: '2753-1' })
      const versao = await createVersao(produto.id, { data_criacao: '2026-05-01T12:00:00-03:00', data_edicao: '2026-06-15T12:00:00-03:00' })
      // situacao_carregamento_id 2 = Carregado BDGEx Ostensivo
      await createArquivo(versao.id, { situacao_carregamento_id: 2 })

      const res = await request(app).get('/api/integracao/acervo/produtos_finalizados?ano=2026&mes=6&cumulativo=false')

      expect(res.status).toBe(200)
      expect(res.body.dados.produtos[0].situacao_carregamento).toContain('Carregado BDGEx Ostensivo')
    })
  })

  describe('GET /api/integracao/mapoteca/atendimentos', () => {
    const setupAtendimentos = async () => {
      const produto = await createProduto({ tipo_produto_id: 2, tipo_escala_id: 2, mi: '2753-1' })
      const versao = await createVersao(produto.id, { data_criacao: '2026-05-01T12:00:00-03:00', data_edicao: '2026-06-01T12:00:00-03:00' })

      // Militar: OM EB, remetido em junho, 10 cartas
      const omId = await criaCliente({ nome: '3º RCC', tipo_cliente_id: 1 })
      const pedidoMil = await criaPedido(omId, { previsto_pit: true, operacao: 'Operação Junho' })
      await criaProdutoPedido({
        uuid_versao: versao.uuid_versao,
        pedido_id: pedidoMil.id,
        quantidade: 10,
        tipo_midia_id: 5,
        data_entrega: '2026-06-20'
      })

      // Civil/LAI: concluído em junho, 1 produto, com NUP
      const laiId = await criaCliente({ nome: 'Solicitante LAI', tipo_cliente_id: 9 })
      const pedidoLai = await criaPedido(laiId, {
        situacao_pedido_id: 5,
        data_atendimento: '2026-06-22T10:00:00-03:00',
        documento_solicitacao_nup: '60143.000014/2026-78'
      })
      await criaProdutoPedido({
        uuid_versao: versao.uuid_versao,
        pedido_id: pedidoLai.id,
        quantidade: 1,
        tipo_midia_id: 7,
        data_entrega: '2026-06-22'
      })
      return { versao }
    }

    it('should split military (2.4) and civilian/LAI (2.7) deliveries in the month', async () => {
      await setupAtendimentos()

      const res = await request(app).get('/api/integracao/mapoteca/atendimentos?ano=2026&mes=6&cumulativo=false')

      expect(res.status).toBe(200)
      expect(res.body.dados.militar).toHaveLength(1)
      expect(res.body.dados.militar[0].solicitante).toBe('3º RCC')
      expect(res.body.dados.militar[0].quantidade).toBe(10)
      expect(res.body.dados.militar[0].previsto_pit).toBe(true)

      expect(res.body.dados.civil).toHaveLength(1)
      expect(res.body.dados.civil[0].solicitante).toBe('Solicitante LAI')
      expect(res.body.dados.civil[0].nup).toBe('60143.000014/2026-78')
      expect(res.body.dados.civil[0].quantidade).toBe(1)

      expect(res.body.dados.resumo.total_pedidos).toBe(2)
      expect(res.body.dados.resumo.total_produtos).toBe(11)

      // Não vaza endereço/contato
      expect(res.body.dados.militar[0].endereco_entrega).toBeUndefined()
    })

    it('should exclude deliveries from other months (não cumulativo)', async () => {
      const { versao } = await setupAtendimentos()
      // Pedido militar atendido em março
      const omId = await criaCliente({ nome: '5º RCC', tipo_cliente_id: 1 })
      const pedidoMar = await criaPedido(omId, {
        data_pedido: '2026-03-01T10:00:00-03:00',
        data_atendimento: '2026-03-20T10:00:00-03:00'
      })
      await criaProdutoPedido({
        uuid_versao: versao.uuid_versao,
        pedido_id: pedidoMar.id,
        quantidade: 3,
        tipo_midia_id: 5,
        data_entrega: '2026-03-20'
      })

      const junho = await request(app).get('/api/integracao/mapoteca/atendimentos?ano=2026&mes=6&cumulativo=false')
      expect(junho.body.dados.resumo.total_pedidos).toBe(2)

      const acumulado = await request(app).get('/api/integracao/mapoteca/atendimentos?ano=2026&mes=6&cumulativo=true')
      expect(acumulado.body.dados.resumo.total_pedidos).toBe(3)
    })
  })
})
