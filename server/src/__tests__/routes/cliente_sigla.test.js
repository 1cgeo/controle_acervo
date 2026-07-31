'use strict'

// A sigla da OM no cliente da mapoteca, e o efeito dela no RPCMTec.
//
// Sao dois contratos distintos e os dois precisam de prova:
//
//   1. O CAMPO. Criar, ler e atualizar sem perder o valor. O caso que importa e
//      o PUT PARCIAL: a tela de cliente nao conhece `sigla`, e sem preserveOmitted
//      editar o endereco apagaria a sigla com 200 e sem aviso.
//   2. O RELATORIO. O solicitante do RPCMTec passa a sair pela sigla, CAINDO no
//      nome quando ela falta. O fallback nao e detalhe: quem nao e OM (orgao
//      publico, cidadao da LAI) nunca tera sigla, e a linha do relatorio nao
//      pode sair vazia por causa disso.

const request = require('supertest')
const { getApp } = require('../helpers/app')
const { conn } = require('../helpers/db')
const { cleanTestData } = require('../helpers/db')
const { generateAdminToken } = require('../helpers/auth')

let app

beforeAll(async () => {
  app = await getApp()
})

afterEach(async () => {
  await cleanTestData()
})

const admin = () => generateAdminToken()

const criarCliente = async (body) =>
  request(app).post('/api/mapoteca/cliente').set('Authorization', admin()).send(body)

const lerCliente = async id =>
  (await request(app).get(`/api/mapoteca/cliente/${id}`).set('Authorization', admin())).body.dados

const idPorNome = async nome =>
  Number((await conn.one(
    'SELECT id FROM mapoteca.cliente WHERE nome = $1 ORDER BY id DESC LIMIT 1', [nome]
  )).id)

const atualizarCliente = async body =>
  request(app).put('/api/mapoteca/cliente').set('Authorization', admin()).send(body)

describe('mapoteca.cliente.sigla', () => {
  it('should store and return the sigla', async () => {
    expect((await criarCliente({
      nome: '10º Batalhão Logístico', sigla: '10º B Log', tipo_cliente_id: 1
    })).status).toBe(201)

    const id = await idPorNome('10º Batalhão Logístico')
    expect((await lerCliente(id)).sigla).toBe('10º B Log')
  })

  // Quem nao e OM nao tem sigla, e isso e o estado normal, nao uma pendencia.
  it('should accept a client with no sigla at all', async () => {
    expect((await criarCliente({ nome: 'UFRGS', tipo_cliente_id: 4 })).status).toBe(201)

    const id = await idPorNome('UFRGS')
    expect((await lerCliente(id)).sigla).toBeNull()
  })

  it('should preserve the sigla on an update that omits the key', async () => {
    await criarCliente({
      nome: '1º Centro de Geoinformação',
      sigla: '1º CGEO',
      endereco_entrega_principal: 'Endereço antigo',
      tipo_cliente_id: 1
    })
    const id = await idPorNome('1º Centro de Geoinformação')

    const res = await atualizarCliente({
      id,
      nome: '1º Centro de Geoinformação',
      endereco_entrega_principal: 'Endereço novo',
      tipo_cliente_id: 1
    })
    expect(res.status).toBe(200)

    const depois = await lerCliente(id)
    expect(depois.endereco_entrega_principal).toBe('Endereço novo')
    expect(depois.sigla).toBe('1º CGEO')
  })

  it('should still clear the sigla when null is sent explicitly', async () => {
    await criarCliente({ nome: 'OM Renomeada', sigla: 'OM R', tipo_cliente_id: 1 })
    const id = await idPorNome('OM Renomeada')

    await atualizarCliente({ id, nome: 'OM Renomeada', sigla: null, tipo_cliente_id: 1 })

    expect((await lerCliente(id)).sigla).toBeNull()
  })

  it('should reject a sigla longer than the column', async () => {
    const res = await criarCliente({
      nome: 'OM Comprida', sigla: 'x'.repeat(51), tipo_cliente_id: 1
    })
    expect(res.status).toBe(400)
  })
})

describe('RPCMTec: solicitante pela sigla', () => {
  // Um pedido de OM COM sigla e um de cliente SEM sigla, no mesmo mes. O
  // relatorio tem de mostrar a sigla no primeiro e o nome no segundo.
  const criaPedido = async (clienteId, data) =>
    conn.one(
      `INSERT INTO mapoteca.pedido
         (cliente_id, data_pedido, situacao_pedido_id, usuario_criacao_id, usuario_atualizacao_id)
       VALUES ($1, $2, 1, 1, 1) RETURNING id`,
      [clienteId, data]
    )

  it('should show the sigla for a unit and fall back to the name otherwise', async () => {
    await criarCliente({ nome: '3º Regimento de Carros de Combate', sigla: '3º RCC', tipo_cliente_id: 1 })
    await criarCliente({ nome: 'Prefeitura de Dois Irmãos', tipo_cliente_id: 6 })

    const omId = await idPorNome('3º Regimento de Carros de Combate')
    const civilId = await idPorNome('Prefeitura de Dois Irmãos')
    await criaPedido(omId, '2026-03-10')
    await criaPedido(civilId, '2026-03-11')

    const res = await request(app)
      .get('/api/relatorio/rpcmtec?ano=2026&mes=3')
      .set('Authorization', admin())
    expect(res.status).toBe(200)

    const texto = JSON.stringify(res.body.dados)
    expect(texto).toContain('3º RCC')
    expect(texto).not.toContain('3º Regimento de Carros de Combate')
    expect(texto).toContain('Prefeitura de Dois Irmãos')
  })
})
