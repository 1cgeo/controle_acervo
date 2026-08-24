'use strict'

// A PODA DO PEDIDO (2026-08-08), contra o banco de verdade.
//
// Quatro cortes decididos por MEDIÇÃO na produção, e um acréscimo que só existiu
// porque a medição achou uma coluna com dado e sem leitor:
//
//   situação 1 ('Pré cadastramento')          ZERO pedidos em 166;
//   situação 2, rótulo -> 'Pedido Recebido'   o code NÃO muda;
//   pedido.omds                               124 preenchidas, UM valor distinto;
//   produto_pedido.quantidade_fornecida       = quantidade em 1759 de 1759;
//   pedido.palavras_chave                     18 preenchidas, NENHUM leitor, e um
//                                             índice GIN sem consulta nenhuma.
//
// O QUE ESTE ARQUIVO GUARDA, e que nenhum teste de schema alcança: que as duas
// colunas realmente saíram do BANCO (e não só do Joi), que a mídia fornecida
// NÃO saiu junto, que o número publicado não mudou com a troca do QTD_EFETIVA, e
// que o filtro novo acha o pedido certo E não acha o errado.

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

const lista = (query = '') => request(app)
  .get(`/api/mapoteca/pedido?ano=2026${query}`)
  .set('Authorization', generateUserToken())

// ---------------------------------------------------------------------------

describe('A situação 1 saiu, e a 2 só mudou de rótulo', () => {
  it('mapoteca.situacao_pedido não tem mais o code 1', async () => {
    const linha = await conn.oneOrNone(
      'SELECT code FROM mapoteca.situacao_pedido WHERE code = 1'
    )
    expect(linha).toBeNull()
  })

  it('as outras continuam lá, e o code 2 se chama Pedido Recebido', async () => {
    const codes = await conn.any(
      'SELECT code, nome FROM mapoteca.situacao_pedido ORDER BY code'
    )
    // O 8 (Aguardando envio) nasceu em 2026-08-24, DEPOIS da poda, e é o
    // próximo code livre: ele não ocupa a vaga que o 1 deixou. Code de domínio
    // não se reaproveita, porque `auditoria.evento` guarda o 1 para sempre.
    expect(codes.map(c => Number(c.code))).toEqual([2, 3, 4, 5, 6, 7, 8])
    // O ROTULO mudou e o CODE não: 'DIEx/Ofício do pedido recebido' nomeava o
    // documento, e o pedido de civil chega por e-mail. Trocar o code apagaria a
    // distinção com o 3 (Em andamento), que é trabalho já começado.
    expect(codes.find(c => Number(c.code) === 2).nome).toBe('Pedido Recebido')
  })

  it('a rota de domínio devolve as seis, sem a que saiu', async () => {
    const res = await request(app)
      .get('/api/mapoteca/dominio/situacao_pedido')
      .set('Authorization', generateUserToken())

    expect(res.status).toBe(200)
    const codes = res.body.dados.map(d => Number(d.code))
    expect(codes).not.toContain(1)
    expect(codes).toContain(2)
  })

  it('cadastrar pedido na situação 1 leva 400, e não 500 da chave estrangeira', async () => {
    const clienteId = await criaCliente('OM Situacao Podada')
    const res = await request(app)
      .post('/api/mapoteca/pedido')
      .set('Authorization', generateAdminToken())
      .send({
        data_pedido: '2026-03-10',
        cliente_id: clienteId,
        situacao_pedido_id: 1
      })

    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/situacao_pedido_id/)
  })
})

describe('As duas colunas que saíram, e a que ficou', () => {
  const coluna = (tabela, nome) => conn.oneOrNone(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'mapoteca' AND table_name = $1 AND column_name = $2`,
    [tabela, nome]
  )

  it('mapoteca.pedido não tem mais omds', async () => {
    expect(await coluna('pedido', 'omds')).toBeNull()
  })

  it('mapoteca.produto_pedido não tem mais quantidade_fornecida', async () => {
    expect(await coluna('produto_pedido', 'quantidade_fornecida')).toBeNull()
  })

  // O CONTROLE POSITIVO da poda, e o caso mais importante deste arquivo: as
  // duas colunas de "fornecida" têm o mesmo sufixo, o mesmo formulário e
  // destinos OPOSTOS. A quantidade tinha zero divergências em 1759 linhas; a
  // mídia tem 25 (item pedido em tyvek e atendido em sulfite). Quem apagar esta
  // aqui por simetria apaga o único registro daquelas 25.
  it('mapoteca.produto_pedido AINDA TEM tipo_midia_fornecida_id', async () => {
    expect(await coluna('produto_pedido', 'tipo_midia_fornecida_id')).not.toBeNull()
  })
})

describe('O QTD_EFETIVA sem a coluna devolve o mesmo número', () => {
  // O fragmento era `COALESCE(pp.quantidade_fornecida, pp.quantidade)` e virou
  // `pp.quantidade`. Onde a coluna era nula o COALESCE já caía na prevista, e
  // onde era preenchida ela era a prevista: nenhum caminho muda de valor.
  //
  // Aqui se prova pelo consumidor mais visível do fragmento, o total de
  // entregas do dashboard, contra a soma das quantidades pedidas.
  it('o total do dashboard bate com a soma das quantidades dos itens', async () => {
    const clienteId = await criaCliente('OM Qtd Efetiva')
    const pedido = await criaPedido(clienteId, {
      situacao_pedido_id: 5,
      data_atendimento: '2026-03-20'
    })

    for (const quantidade of [7, 13]) {
      const res = await request(app)
        .post('/api/mapoteca/produto_pedido')
        .set('Authorization', generateAdminToken())
        .send({
          nome_avulso: `Avulso ${quantidade}`,
          pedido_id: pedido.id,
          quantidade,
          tipo_midia_id: 5,
          // A mídia DIVERGE, e mesmo assim a quantidade entregue é a pedida:
          // é a assimetria que a poda deixou de pé.
          tipo_midia_fornecida_id: 8
        })
      expect(res.status).toBe(201)
    }

    const res = await request(app)
      .get('/api/mapoteca/dashboard/entregas_por_mes?ano=2026')
      .set('Authorization', generateAdminToken())

    expect(res.status).toBe(200)
    const marco = res.body.dados.find(m => m.mes === 3)
    expect(marco.total).toBe(20)
  })
})

describe('O filtro por palavra-chave da lista de pedidos', () => {
  // A etiqueta é casada INTEIRA, por `@>`, porque é o que o índice GIN de
  // `mapoteca.pedido.palavras_chave` atende. Um ILIKE responderia mais coisa e
  // não tocaria no índice.
  const semear = async () => {
    const clienteId = await criaCliente('OM Palavra Chave')
    const certo = await criaPedido(clienteId, {
      palavras_chave: ['Extra-PIT', '5ª DE']
    })
    const errado = await criaPedido(clienteId, {
      palavras_chave: ['racionalizacao']
    })
    const semEtiqueta = await criaPedido(clienteId, {})
    return { certo, errado, semEtiqueta }
  }

  it('acha o pedido da etiqueta e NÃO acha os outros', async () => {
    const { certo, errado, semEtiqueta } = await semear()

    const res = await lista('&palavra_chave=Extra-PIT')

    expect(res.status).toBe(200)
    const ids = res.body.dados.map(p => Number(p.id))
    expect(ids).toEqual([Number(certo.id)])
    expect(ids).not.toContain(Number(errado.id))
    expect(ids).not.toContain(Number(semEtiqueta.id))
  })

  it('casa também a SEGUNDA etiqueta do mesmo pedido', async () => {
    // `@>` é continência do array inteiro, e não "a primeira posição": sem
    // isto, o pedido só seria achado pela etiqueta que alguém digitou primeiro.
    const { certo } = await semear()

    const res = await lista('&palavra_chave=5ª DE')

    expect(res.status).toBe(200)
    expect(res.body.dados.map(p => Number(p.id))).toEqual([Number(certo.id)])
  })

  it('sem a palavra-chave a lista continua a do ano inteiro', async () => {
    const { certo, errado, semEtiqueta } = await semear()

    const res = await lista()

    expect(res.status).toBe(200)
    const ids = res.body.dados.map(p => Number(p.id))
    for (const p of [certo, errado, semEtiqueta]) {
      expect(ids).toContain(Number(p.id))
    }
  })

  it('etiqueta que ninguém usou devolve lista vazia, e não a lista toda', async () => {
    await semear()

    const res = await lista('&palavra_chave=nao-existe-esta')

    expect(res.status).toBe(200)
    expect(res.body.dados).toEqual([])
  })

  // A etiqueta é INTEIRA de propósito (ver o comentário de `getPedidos`). Este
  // caso guarda a decisão: se um dia ele passar a achar, alguém trocou o `@>`
  // por um ILIKE e o índice GIN voltou a não servir para nada.
  it('pedaço de etiqueta NÃO casa: a busca é da etiqueta, não do texto', async () => {
    await semear()

    const res = await lista('&palavra_chave=Extra')

    expect(res.status).toBe(200)
    expect(res.body.dados).toEqual([])
  })

  it('o filtro SOMA com o ano, e não o substitui', async () => {
    const clienteId = await criaCliente('OM Palavra Chave Ano')
    const de2026 = await criaPedido(clienteId, {
      data_pedido: '2026-05-10', palavras_chave: ['EXPOINTER']
    })
    await criaPedido(clienteId, {
      data_pedido: '2025-05-10', palavras_chave: ['EXPOINTER']
    })

    const res = await lista('&palavra_chave=EXPOINTER')

    expect(res.status).toBe(200)
    expect(res.body.dados.map(p => Number(p.id))).toEqual([Number(de2026.id)])
  })

  // A lista MOSTRA a etiqueta desde 2026-08-08. Filtrar por algo que a tela não
  // mostra deixa quem filtrou sem saber por que aquela linha entrou.
  it('a lista devolve as palavras-chave do pedido', async () => {
    const { certo } = await semear()

    const res = await lista()

    const linha = res.body.dados.find(p => Number(p.id) === Number(certo.id))
    expect(linha.palavras_chave).toEqual(['Extra-PIT', '5ª DE'])
  })

  it('palavra-chave em branco leva 400, e não a lista inteira em silêncio', async () => {
    const res = await lista('&palavra_chave=')

    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/palavra_chave/)
  })
})
