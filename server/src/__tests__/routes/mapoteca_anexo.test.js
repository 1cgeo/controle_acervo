'use strict'

const request = require('supertest')
const { getApp } = require('../helpers/app')
const { conn, cleanTestData } = require('../helpers/db')
const { generateAdminToken, generateUserToken } = require('../helpers/auth')

let app

beforeAll(async () => {
  app = await getApp()
})

afterEach(async () => {
  await cleanTestData()
})

// --- Helpers locais ---------------------------------------------------------

const criaCliente = async (overrides = {}) => {
  const res = await request(app)
    .post('/api/mapoteca/cliente')
    .set('Authorization', generateAdminToken())
    .send({
      nome: 'OM Teste Anexo',
      ponto_contato_principal: null,
      endereco_entrega_principal: 'Rua Teste, 1',
      tipo_cliente_id: 1,
      ...overrides
    })
  expect(res.status).toBe(201)
  const row = await conn.one(
    'SELECT id FROM mapoteca.cliente WHERE nome = $1 ORDER BY id DESC LIMIT 1',
    ['OM Teste Anexo']
  )
  return row.id
}

const criaPedido = async (clienteId, overrides = {}) => {
  const res = await request(app)
    .post('/api/mapoteca/pedido')
    .set('Authorization', generateAdminToken())
    .send({
      data_pedido: '2026-03-10T10:00:00Z',
      cliente_id: clienteId,
      situacao_pedido_id: 3,
      operacao: null,
      ...overrides
    })
  expect(res.status).toBe(201)
  return res.body.dados
}

const PDF_BYTES = Buffer.from('%PDF-1.4\n1 0 obj\n<< >>\nendobj\n%%EOF\n')

// --- Testes -----------------------------------------------------------------

describe('Mapoteca - Anexos do pedido', () => {
  it('anexa, lista, baixa e remove um anexo', async () => {
    const clienteId = await criaCliente()
    const pedido = await criaPedido(clienteId)
    const pedidoId = pedido.id

    // upload
    const up = await request(app)
      .post(`/api/mapoteca/pedido/${pedidoId}/anexos`)
      .set('Authorization', generateAdminToken())
      .field('tipo_anexo_id', 1)
      .field('descricao', 'DIEx de solicitação')
      .attach('arquivo', PDF_BYTES, {
        filename: 'diex_134.pdf',
        contentType: 'application/pdf'
      })
    expect(up.status).toBe(201)
    expect(Array.isArray(up.body.dados)).toBe(true)
    expect(up.body.dados).toHaveLength(1)
    const anexo = up.body.dados[0]
    expect(anexo.nome_original).toBe('diex_134.pdf')
    expect(anexo.extensao).toBe('pdf')
    expect(anexo.tipo_anexo_id).toBe(1)
    expect(Number(anexo.tamanho_bytes)).toBe(PDF_BYTES.length)
    // a listagem nunca traz os bytes
    expect(anexo.conteudo).toBeUndefined()

    // listagem
    const lista = await request(app)
      .get(`/api/mapoteca/pedido/${pedidoId}/anexos`)
      .set('Authorization', generateUserToken())
    expect(lista.status).toBe(200)
    expect(lista.body.dados).toHaveLength(1)

    // download devolve os bytes exatos
    const dl = await request(app)
      .get(`/api/mapoteca/pedido/anexo/${anexo.id}/download`)
      .set('Authorization', generateUserToken())
      .buffer(true)
      .parse((res, cb) => {
        const chunks = []
        res.on('data', c => chunks.push(c))
        res.on('end', () => cb(null, Buffer.concat(chunks)))
      })
    expect(dl.status).toBe(200)
    expect(dl.headers['content-disposition']).toContain('diex_134.pdf')
    expect(Buffer.compare(dl.body, PDF_BYTES)).toBe(0)

    // remoção
    const del = await request(app)
      .delete(`/api/mapoteca/pedido/anexo/${anexo.id}`)
      .set('Authorization', generateAdminToken())
    expect(del.status).toBe(200)

    const vazia = await request(app)
      .get(`/api/mapoteca/pedido/${pedidoId}/anexos`)
      .set('Authorization', generateUserToken())
    expect(vazia.body.dados).toHaveLength(0)
  })

  it('permite vários anexos no mesmo pedido', async () => {
    const clienteId = await criaCliente()
    const { id: pedidoId } = await criaPedido(clienteId)
    for (const nome of ['a.pdf', 'b.png']) {
      const r = await request(app)
        .post(`/api/mapoteca/pedido/${pedidoId}/anexos`)
        .set('Authorization', generateAdminToken())
        .attach('arquivo', PDF_BYTES, { filename: nome })
      expect(r.status).toBe(201)
    }
    const lista = await request(app)
      .get(`/api/mapoteca/pedido/${pedidoId}/anexos`)
      .set('Authorization', generateAdminToken())
    expect(lista.body.dados).toHaveLength(2)
  })

  it('404 ao anexar em pedido inexistente', async () => {
    const r = await request(app)
      .post('/api/mapoteca/pedido/99999999/anexos')
      .set('Authorization', generateAdminToken())
      .attach('arquivo', PDF_BYTES, { filename: 'x.pdf' })
    expect(r.status).toBe(404)
  })

  it('400 sem arquivo no campo "arquivo"', async () => {
    const clienteId = await criaCliente()
    const { id: pedidoId } = await criaPedido(clienteId)
    const r = await request(app)
      .post(`/api/mapoteca/pedido/${pedidoId}/anexos`)
      .set('Authorization', generateAdminToken())
      .field('tipo_anexo_id', 4)
    expect(r.status).toBe(400)
  })

  it('400 para extensão não permitida', async () => {
    const clienteId = await criaCliente()
    const { id: pedidoId } = await criaPedido(clienteId)
    const r = await request(app)
      .post(`/api/mapoteca/pedido/${pedidoId}/anexos`)
      .set('Authorization', generateAdminToken())
      .attach('arquivo', Buffer.from('MZ'), { filename: 'malware.exe' })
    expect(r.status).toBe(400)
  })

  it('nega upload para usuário sem admin', async () => {
    const clienteId = await criaCliente()
    const { id: pedidoId } = await criaPedido(clienteId)
    const r = await request(app)
      .post(`/api/mapoteca/pedido/${pedidoId}/anexos`)
      .set('Authorization', generateUserToken())
      .attach('arquivo', PDF_BYTES, { filename: 'x.pdf' })
    expect([401, 403]).toContain(r.status)
  })
})
