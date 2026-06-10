'use strict'

const request = require('supertest')
const { getApp } = require('../helpers/app')
const { conn, cleanTestData } = require('../helpers/db')
const { generateAdminToken, generateUserToken } = require('../helpers/auth')
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
    ponto_contato_principal: null,
    endereco_entrega_principal: 'Rua Teste, 1',
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
    data_pedido: '2026-03-10T10:00:00Z',
    cliente_id: clienteId,
    situacao_pedido_id: 4,
    data_atendimento: '2026-03-20T10:00:00Z',
    localizador_envio: 'QN048384596BR',
    operacao: null,
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
  return res
}

const criaTipoMaterial = async (overrides = {}) => {
  const res = await request(app)
    .post('/api/mapoteca/tipo_material')
    .set('Authorization', generateAdminToken())
    .send({
      nome: 'Material Teste',
      descricao: 'Material de teste',
      ...overrides
    })
  expect(res.status).toBe(201)
  return res.body.dados.id
}

const criaEstoque = async (tipoMaterialId, localizacaoId, quantidade) => {
  const res = await request(app)
    .post('/api/mapoteca/estoque_material')
    .set('Authorization', generateAdminToken())
    .send({
      tipo_material_id: tipoMaterialId,
      quantidade,
      localizacao_id: localizacaoId
    })
  expect(res.status).toBe(201)
}

const getEstoque = async (tipoMaterialId, localizacaoId) => {
  return conn.oneOrNone(
    `SELECT quantidade FROM mapoteca.estoque_material
     WHERE tipo_material_id = $1 AND localizacao_id = $2`,
    [tipoMaterialId, localizacaoId]
  )
}

// --- Testes -----------------------------------------------------------------

describe('Mapoteca Routes', () => {
  describe('Domain endpoints (no auth)', () => {
    it('GET /api/mapoteca/dominio/tipo_cliente should return without auth', async () => {
      const res = await request(app).get('/api/mapoteca/dominio/tipo_cliente')
      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(Array.isArray(res.body.dados)).toBe(true)
    })

    it('GET /api/mapoteca/dominio/situacao_pedido should include Aguardando produção (7)', async () => {
      const res = await request(app).get('/api/mapoteca/dominio/situacao_pedido')
      expect(res.status).toBe(200)
      const codes = res.body.dados.map(d => d.code)
      expect(codes).toContain(7)
    })

    it('GET /api/mapoteca/dominio/tipo_midia should include Tyvek (8)', async () => {
      const res = await request(app).get('/api/mapoteca/dominio/tipo_midia')
      expect(res.status).toBe(200)
      const nomes = res.body.dados.map(d => d.nome)
      expect(nomes).toContain('Tyvek')
    })

    it('GET /api/mapoteca/dominio/forma_entrega should return 5 values', async () => {
      const res = await request(app).get('/api/mapoteca/dominio/forma_entrega')
      expect(res.status).toBe(200)
      expect(res.body.dados).toHaveLength(5)
      const nomes = res.body.dados.map(d => d.nome)
      expect(nomes).toEqual(
        expect.arrayContaining(['Correios', 'Entrega em mãos', 'Retirado no CGEO', 'E-mail', 'Outros'])
      )
    })
  })

  describe('Clientes', () => {
    it('GET /api/mapoteca/cliente should require auth', async () => {
      const res = await request(app).get('/api/mapoteca/cliente')
      expect(res.status).toBe(401)
    })

    it('GET /api/mapoteca/cliente should return list with auth', async () => {
      const res = await request(app)
        .get('/api/mapoteca/cliente')
        .set('Authorization', generateAdminToken())

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
    })

    it('POST /api/mapoteca/cliente should create cliente (admin)', async () => {
      const res = await request(app)
        .post('/api/mapoteca/cliente')
        .set('Authorization', generateAdminToken())
        .send({
          nome: 'OM Rota Teste',
          ponto_contato_principal: null,
          endereco_entrega_principal: null,
          tipo_cliente_id: 1
        })

      expect(res.status).toBe(201)

      const list = await request(app)
        .get('/api/mapoteca/cliente')
        .set('Authorization', generateAdminToken())
      expect(list.body.dados.map(c => c.nome)).toContain('OM Rota Teste')
    })

    it('POST /api/mapoteca/cliente should reject without nome', async () => {
      const res = await request(app)
        .post('/api/mapoteca/cliente')
        .set('Authorization', generateAdminToken())
        .send({
          tipo_cliente_id: 1
        })

      expect(res.status).toBe(400)
    })

    it('POST /api/mapoteca/cliente should require admin', async () => {
      const res = await request(app)
        .post('/api/mapoteca/cliente')
        .set('Authorization', generateUserToken())
        .send({
          nome: 'OM Rota',
          tipo_cliente_id: 1
        })

      expect(res.status).toBe(403)
    })
  })

  describe('Pedidos', () => {
    it('POST /api/mapoteca/pedido should create with demandante/omds/previsto_pit', async () => {
      const clienteId = await criaCliente()
      const pedido = await criaPedido(clienteId, {
        demandante: 'CMS',
        omds: '1º CGEO',
        previsto_pit: true
      })

      expect(pedido.id).toBeDefined()
      expect(pedido.localizador_pedido).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/)

      const res = await request(app)
        .get(`/api/mapoteca/pedido/${pedido.id}`)
        .set('Authorization', generateAdminToken())

      expect(res.status).toBe(200)
      expect(res.body.dados.demandante).toBe('CMS')
      expect(res.body.dados.omds).toBe('1º CGEO')
      expect(res.body.dados.previsto_pit).toBe(true)
    })

    it('POST /api/mapoteca/pedido cancelado sem motivo_cancelamento should return 400', async () => {
      const clienteId = await criaCliente()
      const res = await request(app)
        .post('/api/mapoteca/pedido')
        .set('Authorization', generateAdminToken())
        .send({
          data_pedido: '2026-03-10T10:00:00Z',
          cliente_id: clienteId,
          situacao_pedido_id: 6
        })

      expect(res.status).toBe(400)
    })

    it('POST /api/mapoteca/pedido concluído sem data_atendimento should return 400', async () => {
      const clienteId = await criaCliente()
      const res = await request(app)
        .post('/api/mapoteca/pedido')
        .set('Authorization', generateAdminToken())
        .send({
          data_pedido: '2026-03-10T10:00:00Z',
          cliente_id: clienteId,
          situacao_pedido_id: 5
        })

      expect(res.status).toBe(400)
    })

    it('POST /api/mapoteca/pedido aguardando produção (7) should create', async () => {
      const clienteId = await criaCliente()
      const pedido = await criaPedido(clienteId, {
        situacao_pedido_id: 7,
        data_atendimento: null,
        localizador_envio: null
      })
      expect(pedido.id).toBeDefined()
    })
  })

  describe('Produto do Pedido', () => {
    it('POST /api/mapoteca/produto_pedido sem uuid_versao should return 400 (RN08)', async () => {
      const clienteId = await criaCliente()
      const pedido = await criaPedido(clienteId)

      const res = await request(app)
        .post('/api/mapoteca/produto_pedido')
        .set('Authorization', generateAdminToken())
        .send({
          pedido_id: pedido.id,
          quantidade: 5,
          tipo_midia_id: 5
        })

      expect(res.status).toBe(400)
    })

    it('POST /api/mapoteca/produto_pedido with new fields should persist and enrich', async () => {
      const produto = await createProduto({ tipo_produto_id: 2, tipo_escala_id: 2 })
      const versao = await createVersao(produto.id)
      const clienteId = await criaCliente()
      const pedido = await criaPedido(clienteId)

      await criaProdutoPedido({
        uuid_versao: versao.uuid_versao,
        pedido_id: pedido.id,
        quantidade: 10,
        quantidade_fornecida: 8,
        tipo_midia_id: 5,
        tipo_midia_fornecida_id: 8,
        forma_entrega_id: 1,
        data_entrega: '2026-03-20',
        observacao: 'Entrega parcial'
      })

      const res = await request(app)
        .get(`/api/mapoteca/pedido/${pedido.id}`)
        .set('Authorization', generateAdminToken())

      expect(res.status).toBe(200)
      const item = res.body.dados.produtos[0]
      expect(item.quantidade).toBe(10)
      expect(item.quantidade_fornecida).toBe(8)
      expect(item.tipo_midia_fornecida_nome).toBe('Tyvek')
      expect(item.forma_entrega_nome).toBe('Correios')
      expect(item.observacao).toBe('Entrega parcial')
      expect(item.data_entrega).toContain('2026-03-20')
      expect(item.tipo_produto_nome).toBe('Carta Topográfica')
    })
  })

  describe('Tipo de Material', () => {
    it('POST with estoque_minimo/meta_anual/ativo should persist; list returns abaixo_minimo', async () => {
      const id = await criaTipoMaterial({
        nome: 'Papel Sulfite 90g',
        estoque_minimo: 10,
        meta_anual: 100,
        ativo: true
      })

      const res = await request(app)
        .get('/api/mapoteca/tipo_material')
        .set('Authorization', generateUserToken())

      expect(res.status).toBe(200)
      const material = res.body.dados.find(m => m.id === id)
      expect(material).toBeDefined()
      expect(parseFloat(material.estoque_minimo)).toBe(10)
      expect(parseFloat(material.meta_anual)).toBe(100)
      expect(material.ativo).toBe(true)
      // Sem estoque cadastrado: 0 < 10 → abaixo do mínimo
      expect(material.abaixo_minimo).toBe(true)
    })
  })

  describe('Transferência de estoque', () => {
    it('should move quantity between locations (happy path)', async () => {
      const materialId = await criaTipoMaterial()
      await criaEstoque(materialId, 2, 10) // Almoxarifado

      const res = await request(app)
        .post('/api/mapoteca/estoque_material/transferir')
        .set('Authorization', generateAdminToken())
        .send({
          tipo_material_id: materialId,
          origem_id: 2,
          destino_id: 1,
          quantidade: 4
        })

      expect(res.status).toBe(200)

      const origem = await getEstoque(materialId, 2)
      const destino = await getEstoque(materialId, 1)
      expect(parseFloat(origem.quantidade)).toBe(6)
      expect(parseFloat(destino.quantidade)).toBe(4)
    })

    it('should increment existing destination stock', async () => {
      const materialId = await criaTipoMaterial()
      await criaEstoque(materialId, 2, 10)
      await criaEstoque(materialId, 1, 3)

      const res = await request(app)
        .post('/api/mapoteca/estoque_material/transferir')
        .set('Authorization', generateAdminToken())
        .send({
          tipo_material_id: materialId,
          origem_id: 2,
          destino_id: 1,
          quantidade: 2
        })

      expect(res.status).toBe(200)
      const destino = await getEstoque(materialId, 1)
      expect(parseFloat(destino.quantidade)).toBe(5)
    })

    it('should return 400 when origin stock is insufficient', async () => {
      const materialId = await criaTipoMaterial()
      await criaEstoque(materialId, 2, 1)

      const res = await request(app)
        .post('/api/mapoteca/estoque_material/transferir')
        .set('Authorization', generateAdminToken())
        .send({
          tipo_material_id: materialId,
          origem_id: 2,
          destino_id: 1,
          quantidade: 100
        })

      expect(res.status).toBe(400)
      expect(res.body.message).toContain('insuficiente')
    })

    it('should return 400 when origin has no stock record', async () => {
      const materialId = await criaTipoMaterial()

      const res = await request(app)
        .post('/api/mapoteca/estoque_material/transferir')
        .set('Authorization', generateAdminToken())
        .send({
          tipo_material_id: materialId,
          origem_id: 3,
          destino_id: 1,
          quantidade: 1
        })

      expect(res.status).toBe(400)
    })

    it('should return 400 when origem equals destino', async () => {
      const materialId = await criaTipoMaterial()

      const res = await request(app)
        .post('/api/mapoteca/estoque_material/transferir')
        .set('Authorization', generateAdminToken())
        .send({
          tipo_material_id: materialId,
          origem_id: 1,
          destino_id: 1,
          quantidade: 1
        })

      expect(res.status).toBe(400)
    })

    it('should return 400 for non-positive quantidade', async () => {
      const materialId = await criaTipoMaterial()

      const res = await request(app)
        .post('/api/mapoteca/estoque_material/transferir')
        .set('Authorization', generateAdminToken())
        .send({
          tipo_material_id: materialId,
          origem_id: 2,
          destino_id: 1,
          quantidade: 0
        })

      expect(res.status).toBe(400)
    })

    it('should require admin', async () => {
      const res = await request(app)
        .post('/api/mapoteca/estoque_material/transferir')
        .set('Authorization', generateUserToken())
        .send({
          tipo_material_id: 1,
          origem_id: 2,
          destino_id: 1,
          quantidade: 1
        })

      expect(res.status).toBe(403)
    })
  })

  describe('Plotters', () => {
    it('POST /api/mapoteca/plotter should create plotter (admin)', async () => {
      const res = await request(app)
        .post('/api/mapoteca/plotter')
        .set('Authorization', generateAdminToken())
        .send({
          ativo: true,
          nr_serie: 'SN-ROUTE-001',
          modelo: 'HP DesignJet T1600',
          data_aquisicao: null,
          vida_util: null
        })

      expect(res.status).toBe(201)
    })

    it('GET /api/mapoteca/plotter should return list with auth', async () => {
      const res = await request(app)
        .get('/api/mapoteca/plotter')
        .set('Authorization', generateUserToken())

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
    })
  })

  describe('Relatórios', () => {
    // Cenário: pedido militar 2026 com carta topo 1:50.000 entregue
    const setupPedidoMilitar = async () => {
      const produto = await createProduto({ tipo_produto_id: 2, tipo_escala_id: 2, mi: 'MI-2965-2' })
      const versao = await createVersao(produto.id)
      const clienteId = await criaCliente({ nome: '3º RCC', tipo_cliente_id: 1 })
      const pedido = await criaPedido(clienteId, {
        demandante: 'CMS',
        omds: '1º CGEO',
        previsto_pit: true,
        operacao: 'Operação Teste'
      })
      await criaProdutoPedido({
        uuid_versao: versao.uuid_versao,
        pedido_id: pedido.id,
        quantidade: 10,
        tipo_midia_id: 5,
        forma_entrega_id: 1,
        data_entrega: '2026-03-20',
        producao_especifica: false
      })
      return { produto, versao, clienteId, pedido }
    }

    it('GET /relatorio/pedidos_mil should aggregate by scale and type', async () => {
      await setupPedidoMilitar()

      const res = await request(app)
        .get('/api/mapoteca/relatorio/pedidos_mil?ano=2026')
        .set('Authorization', generateUserToken())

      expect(res.status).toBe(200)
      expect(res.body.dados).toHaveLength(1)
      const linha = res.body.dados[0]
      expect(linha.unidade).toBe('3º RCC')
      expect(linha.topo_50k).toBe(10)
      expect(linha.total_topo).toBe(10)
      expect(linha.total_orto).toBe(0)
      expect(linha.outros_produtos).toBe(0)
      expect(linha.produtos_digitais).toBe(0)
      expect(linha.total).toBe(10)
      expect(linha.total_offset).toBe(0)
      expect(linha.possui_detalhamento).toBe(true)
      expect(linha.operacao).toBe('Operação Teste')
      expect(linha.tempo_atendimento_dias).toBe(10)
    })

    it('GET /relatorio/pedidos_mil?formato=csv should return CSV download', async () => {
      await setupPedidoMilitar()

      const res = await request(app)
        .get('/api/mapoteca/relatorio/pedidos_mil?ano=2026&formato=csv')
        .set('Authorization', generateUserToken())

      expect(res.status).toBe(200)
      expect(res.headers['content-type']).toContain('text/csv')
      expect(res.headers['content-disposition']).toContain('pedidos_mil_2026.csv')
      expect(res.text.charCodeAt(0)).toBe(0xFEFF)
      const [header, primeiraLinha] = res.text.slice(1).split('\r\n')
      expect(header).toContain('Unidade')
      expect(header).toContain('50k Topo Imp')
      expect(primeiraLinha).toContain('3º RCC')
    })

    it('GET /relatorio/pedidos_detalhado should return one row per item', async () => {
      await setupPedidoMilitar()

      const res = await request(app)
        .get('/api/mapoteca/relatorio/pedidos_detalhado?ano=2026')
        .set('Authorization', generateUserToken())

      expect(res.status).toBe(200)
      expect(res.body.dados).toHaveLength(1)
      const item = res.body.dados[0]
      expect(item.omds).toBe('1º CGEO')
      expect(item.demandante).toBe('CMS')
      expect(item.om_destino).toBe('3º RCC')
      expect(item.mi).toBe('MI-2965-2')
      expect(item.escala).toBe('1:50.000')
      expect(item.quantidade_prevista).toBe(10)
      expect(item.material_previsto).toBe('Sulfite 90g')
      expect(item.forma_entrega).toBe('Correios')
      expect(item.mes).toBe(3)
    })

    it('GET /relatorio/pedidos_civ should include only civilian orders', async () => {
      await setupPedidoMilitar()
      const clienteLai = await criaCliente({ nome: 'Solicitante LAI', tipo_cliente_id: 9 })
      await criaPedido(clienteLai, {
        documento_solicitacao_nup: '60143.000014/2026-78',
        observacao: 'Fotos aéreas do município de Caçapava'
      })

      const res = await request(app)
        .get('/api/mapoteca/relatorio/pedidos_civ?ano=2026')
        .set('Authorization', generateUserToken())

      expect(res.status).toBe(200)
      expect(res.body.dados).toHaveLength(1)
      const linha = res.body.dados[0]
      expect(linha.solicitante).toBe('Solicitante LAI')
      expect(linha.nup_lai).toBe('60143.000014/2026-78')
      expect(linha.resumo_pedido).toBe('Fotos aéreas do município de Caçapava')

      // O pedido civil não deve aparecer no relatório militar
      const mil = await request(app)
        .get('/api/mapoteca/relatorio/pedidos_mil?ano=2026')
        .set('Authorization', generateUserToken())
      expect(mil.body.dados.map(l => l.unidade)).not.toContain('Solicitante LAI')
    })

    it('GET /relatorio/tematicos should return producao_especifica items with metadado', async () => {
      const produto = await createProduto({
        nome: 'Mapa das OM do CMS',
        mi: null,
        inom: null,
        tipo_produto_id: 7,
        tipo_escala_id: 5,
        denominador_escala_especial: 700000
      })
      const versao = await createVersao(produto.id, {
        nome: 'Mapa das OM do CMS - 2026',
        subtipo_produto_id: 14,
        orgao_produtor: 'DGEO / 1º CGEO',
        metadado: { responsavel: 'Maj Diniz' },
        descricao: 'Mapa das Organizações Militares do CMS'
      })
      await createArquivo(versao.id, { tamanho_mb: 200 })

      const clienteId = await criaCliente({ nome: 'CMS', tipo_cliente_id: 1 })
      const pedido = await criaPedido(clienteId, {
        observacao: 'Elaboração do Mapa das OM'
      })
      await criaProdutoPedido({
        uuid_versao: versao.uuid_versao,
        pedido_id: pedido.id,
        quantidade: 1,
        tipo_midia_id: 7,
        producao_especifica: true
      })

      const res = await request(app)
        .get('/api/mapoteca/relatorio/tematicos?ano=2026')
        .set('Authorization', generateUserToken())

      expect(res.status).toBe(200)
      expect(res.body.dados).toHaveLength(1)
      const linha = res.body.dados[0]
      expect(linha.nome_projeto).toBe('Mapa das OM do CMS - 2026')
      expect(linha.demandante).toBe('CMS')
      expect(linha.secao_responsavel).toBe('DGEO / 1º CGEO')
      expect(linha.militar_responsavel).toBe('Maj Diniz')
      expect(parseFloat(linha.tamanho_mb)).toBe(200)
      expect(linha.descricao_pedido).toBe('Elaboração do Mapa das OM')
    })

    it('GET /relatorio/* should require login', async () => {
      const res = await request(app).get('/api/mapoteca/relatorio/pedidos_mil')
      expect(res.status).toBe(401)
    })
  })

  describe('Impressão de pedidos (plugin mapoteca)', () => {
    // Pedido com 1 item (5 cópias) cuja versão tem um PDF carregado
    const setupPedidoComPdf = async () => {
      const produto = await createProduto({ tipo_produto_id: 2, tipo_escala_id: 2, mi: 'MI-2965-2' })
      const versao = await createVersao(produto.id)
      const arquivo = await createArquivo(versao.id, {
        nome: 'Carta Teste PDF',
        nome_arquivo: 'carta_teste',
        extensao: 'pdf',
        tamanho_mb: 25
      })
      const clienteId = await criaCliente()
      const pedido = await criaPedido(clienteId)
      await criaProdutoPedido({
        uuid_versao: versao.uuid_versao,
        pedido_id: pedido.id,
        quantidade: 5,
        tipo_midia_id: 5
      })
      const item = await conn.one(
        'SELECT id FROM mapoteca.produto_pedido WHERE pedido_id = $1',
        [pedido.id]
      )
      return { produto, versao, arquivo, pedido, itemId: item.id }
    }

    it('POST /pedido/:id/download_impressao should return PDFs with tokens and quantities', async () => {
      const { pedido } = await setupPedidoComPdf()

      const res = await request(app)
        .post(`/api/mapoteca/pedido/${pedido.id}/download_impressao`)
        .set('Authorization', generateUserToken())

      expect(res.status).toBe(200)
      expect(res.body.dados.pedido_id).toBe(pedido.id)
      expect(res.body.dados.itens_sem_pdf).toHaveLength(0)
      expect(res.body.dados.arquivos).toHaveLength(1)
      const arq = res.body.dados.arquivos[0]
      expect(arq.download_token).toBeDefined()
      expect(arq.download_path).toContain('carta_teste.pdf')
      expect(arq.quantidade).toBe(5)
      expect(arq.quantidade_impressa).toBe(0)
      expect(arq.quantidade_restante).toBe(5)
      expect(arq.produto_nome).toBeDefined()
      expect(arq.mi).toBe('MI-2965-2')

      // Token registrado em acervo.download como pending
      const download = await conn.one(
        'SELECT status FROM acervo.download WHERE download_token = $1',
        [arq.download_token]
      )
      expect(download.status).toBe('pending')
    })

    it('POST /pedido/:id/download_impressao should list items without PDF', async () => {
      const produto = await createProduto({ tipo_produto_id: 2, tipo_escala_id: 2 })
      const versao = await createVersao(produto.id) // sem arquivo PDF
      const clienteId = await criaCliente()
      const pedido = await criaPedido(clienteId)
      await criaProdutoPedido({
        uuid_versao: versao.uuid_versao,
        pedido_id: pedido.id,
        quantidade: 3,
        tipo_midia_id: 5
      })

      const res = await request(app)
        .post(`/api/mapoteca/pedido/${pedido.id}/download_impressao`)
        .set('Authorization', generateUserToken())

      expect(res.status).toBe(200)
      expect(res.body.dados.arquivos).toHaveLength(0)
      expect(res.body.dados.itens_sem_pdf).toHaveLength(1)
      expect(res.body.dados.itens_sem_pdf[0].quantidade).toBe(3)
    })

    it('POST /pedido/:id/download_impressao should return 404 for missing pedido', async () => {
      const res = await request(app)
        .post('/api/mapoteca/pedido/99999/download_impressao')
        .set('Authorization', generateUserToken())

      expect(res.status).toBe(404)
    })

    it('POST /impressao should accumulate printed quantities across users/days', async () => {
      const { pedido, itemId } = await setupPedidoComPdf()

      // Operador 1 imprime 3 de 5
      let res = await request(app)
        .post('/api/mapoteca/impressao')
        .set('Authorization', generateUserToken())
        .send({ registros: [{ produto_pedido_id: itemId, quantidade: 3 }] })
      expect(res.status).toBe(201)

      let detalhe = await request(app)
        .get(`/api/mapoteca/pedido/${pedido.id}`)
        .set('Authorization', generateUserToken())
      expect(detalhe.body.dados.produtos[0].quantidade_impressa).toBe(3)
      expect(detalhe.body.dados.produtos[0].quantidade_restante).toBe(2)
      expect(detalhe.body.dados.produtos[0].impressao_concluida).toBe(false)
      expect(detalhe.body.dados.impressao.concluida).toBe(false)

      // Outro operador conclui as 2 restantes
      res = await request(app)
        .post('/api/mapoteca/impressao')
        .set('Authorization', generateAdminToken())
        .send({ registros: [{ produto_pedido_id: itemId, quantidade: 2, observacao: 'Plotter 2' }] })
      expect(res.status).toBe(201)

      detalhe = await request(app)
        .get(`/api/mapoteca/pedido/${pedido.id}`)
        .set('Authorization', generateUserToken())
      expect(detalhe.body.dados.produtos[0].quantidade_impressa).toBe(5)
      expect(detalhe.body.dados.produtos[0].impressao_concluida).toBe(true)
      expect(detalhe.body.dados.impressao).toEqual({
        total_itens: 1,
        itens_concluidos: 1,
        concluida: true
      })

      // A listagem de pedidos reflete o status de impressão
      const lista = await request(app)
        .get('/api/mapoteca/pedido')
        .set('Authorization', generateUserToken())
      const linha = lista.body.dados.find(p => p.id === pedido.id)
      expect(parseInt(linha.quantidade_produtos)).toBe(1)
      expect(parseInt(linha.itens_impressos)).toBe(1)
    })

    it('GET /produto_pedido/:id/impressao should return history with users', async () => {
      const { itemId } = await setupPedidoComPdf()

      await request(app)
        .post('/api/mapoteca/impressao')
        .set('Authorization', generateUserToken())
        .send({ registros: [{ produto_pedido_id: itemId, quantidade: 2 }] })
      await request(app)
        .post('/api/mapoteca/impressao')
        .set('Authorization', generateAdminToken())
        .send({ registros: [{ produto_pedido_id: itemId, quantidade: 1 }] })

      const res = await request(app)
        .get(`/api/mapoteca/produto_pedido/${itemId}/impressao`)
        .set('Authorization', generateUserToken())

      expect(res.status).toBe(200)
      expect(res.body.dados.quantidade).toBe(5)
      expect(res.body.dados.quantidade_impressa).toBe(3)
      expect(res.body.dados.quantidade_restante).toBe(2)
      expect(res.body.dados.impressao_concluida).toBe(false)
      expect(res.body.dados.registros).toHaveLength(2)
      expect(res.body.dados.registros[0].usuario_nome).toBeDefined()
    })

    it('POST /impressao should reject invalid payloads', async () => {
      let res = await request(app)
        .post('/api/mapoteca/impressao')
        .set('Authorization', generateUserToken())
        .send({ registros: [{ produto_pedido_id: 99999, quantidade: 1 }] })
      expect(res.status).toBe(404)

      res = await request(app)
        .post('/api/mapoteca/impressao')
        .set('Authorization', generateUserToken())
        .send({ registros: [{ produto_pedido_id: 1, quantidade: 0 }] })
      expect(res.status).toBe(400)

      res = await request(app)
        .post('/api/mapoteca/impressao')
        .send({ registros: [{ produto_pedido_id: 1, quantidade: 1 }] })
      expect(res.status).toBe(401)
    })

    it('DELETE /impressao should remove records (admin only)', async () => {
      const { itemId } = await setupPedidoComPdf()

      await request(app)
        .post('/api/mapoteca/impressao')
        .set('Authorization', generateUserToken())
        .send({ registros: [{ produto_pedido_id: itemId, quantidade: 5 }] })

      const registro = await conn.one(
        'SELECT id FROM mapoteca.impressao_item WHERE produto_pedido_id = $1',
        [itemId]
      )

      const negado = await request(app)
        .delete('/api/mapoteca/impressao')
        .set('Authorization', generateUserToken())
        .send({ impressao_ids: [registro.id] })
      expect(negado.status).toBe(403)

      const res = await request(app)
        .delete('/api/mapoteca/impressao')
        .set('Authorization', generateAdminToken())
        .send({ impressao_ids: [registro.id] })
      expect(res.status).toBe(200)

      const historico = await request(app)
        .get(`/api/mapoteca/produto_pedido/${itemId}/impressao`)
        .set('Authorization', generateUserToken())
      expect(historico.body.dados.quantidade_impressa).toBe(0)
    })
  })

  describe('Dashboard novo', () => {
    const setupEntrega = async () => {
      const produto = await createProduto({ tipo_produto_id: 2, tipo_escala_id: 2 })
      const versao = await createVersao(produto.id)
      const clienteId = await criaCliente()
      const pedido = await criaPedido(clienteId, { operacao: 'Operação Dash' })
      await criaProdutoPedido({
        uuid_versao: versao.uuid_versao,
        pedido_id: pedido.id,
        quantidade: 7,
        tipo_midia_id: 5,
        data_entrega: '2026-03-20'
      })
    }

    it('GET /dashboard/resumo_anual should return totals', async () => {
      await setupEntrega()

      const res = await request(app)
        .get('/api/mapoteca/dashboard/resumo_anual?ano=2026')
        .set('Authorization', generateUserToken())

      expect(res.status).toBe(200)
      expect(res.body.dados.total_pedidos).toBe(1)
      expect(res.body.dados.total_entregas).toBe(7)
      expect(res.body.dados.oms_distintas_count).toBe(1)
      expect(res.body.dados.operacoes_distintas_count).toBe(1)
      expect(res.body.dados.custo_manutencao_total).toBe(0)
    })

    it('GET /dashboard/entregas_por_mes should return 12 months', async () => {
      await setupEntrega()

      const res = await request(app)
        .get('/api/mapoteca/dashboard/entregas_por_mes?ano=2026')
        .set('Authorization', generateUserToken())

      expect(res.status).toBe(200)
      expect(res.body.dados).toHaveLength(12)
      const marco = res.body.dados.find(m => m.mes === 3)
      expect(marco.carta_topo).toBe(7)
      expect(marco.total).toBe(7)
      const janeiro = res.body.dados.find(m => m.mes === 1)
      expect(janeiro.total).toBe(0)
    })

    it('GET /dashboard/entregas_por_mes?formato=csv should return CSV', async () => {
      await setupEntrega()

      const res = await request(app)
        .get('/api/mapoteca/dashboard/entregas_por_mes?ano=2026&formato=csv')
        .set('Authorization', generateUserToken())

      expect(res.status).toBe(200)
      expect(res.headers['content-type']).toContain('text/csv')
      expect(res.text.charCodeAt(0)).toBe(0xFEFF)
    })

    it('GET /dashboard/entregas_por_tipo_produto should aggregate', async () => {
      await setupEntrega()

      const res = await request(app)
        .get('/api/mapoteca/dashboard/entregas_por_tipo_produto?ano=2026')
        .set('Authorization', generateUserToken())

      expect(res.status).toBe(200)
      expect(res.body.dados).toHaveLength(1)
      expect(res.body.dados[0].tipo_produto).toBe('Carta Topográfica')
      expect(res.body.dados[0].escala).toBe('1:50.000')
      expect(res.body.dados[0].total_produtos).toBe(7)
    })

    it('GET /dashboard/entregas_por_midia should aggregate by media', async () => {
      await setupEntrega()

      const res = await request(app)
        .get('/api/mapoteca/dashboard/entregas_por_midia?ano=2026')
        .set('Authorization', generateUserToken())

      expect(res.status).toBe(200)
      expect(res.body.dados).toHaveLength(1)
      expect(res.body.dados[0].tipo_midia).toBe('Sulfite 90g')
      expect(res.body.dados[0].total_produtos).toBe(7)
    })

    it('GET /dashboard/operacoes_apoiadas should list operations', async () => {
      await setupEntrega()

      const res = await request(app)
        .get('/api/mapoteca/dashboard/operacoes_apoiadas?ano=2026')
        .set('Authorization', generateUserToken())

      expect(res.status).toBe(200)
      expect(res.body.dados).toHaveLength(1)
      expect(res.body.dados[0].operacao).toBe('Operação Dash')
      expect(res.body.dados[0].total_produtos).toBe(7)
    })
  })
})
