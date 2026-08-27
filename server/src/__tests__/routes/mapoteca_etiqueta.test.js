'use strict'

// Etiqueta de envio por Correios do pedido (mapoteca.etiqueta_envio).
//
// O que estes testes protegem: a etiqueta impressa e a etiqueta REGISTRADA sao
// a mesma coisa. O cliente so libera o botao Imprimir quando a tela bate com o
// que esta salvo, e isso so vale se a rota gravar mesmo o que recebeu, devolver
// o que gravou e guardar UMA etiqueta por pedido.

const request = require('supertest')
const { getApp } = require('../helpers/app')
const { conn, cleanTestData } = require('../helpers/db')
const {
  generateAdminToken,
  generateUserToken,
  ADMIN_UUID,
  USER_UUID
} = require('../helpers/auth')

let app

beforeAll(async () => {
  app = await getApp()
})

afterEach(async () => {
  await cleanTestData()
})

// --- Helpers locais ---------------------------------------------------------

const criaCliente = async () => {
  const res = await request(app)
    .post('/api/mapoteca/cliente')
    .set('Authorization', generateAdminToken())
    .send({
      nome: 'OM Teste Etiqueta',
      ponto_contato_principal: null,
      endereco_entrega_principal: 'Rua Teste, 1',
      tipo_cliente_id: 1
    })
  expect(res.status).toBe(201)
  const row = await conn.one(
    'SELECT id FROM mapoteca.cliente WHERE nome = $1 ORDER BY id DESC LIMIT 1',
    ['OM Teste Etiqueta']
  )
  return Number(row.id)
}

const criaPedido = async clienteId => {
  const res = await request(app)
    .post('/api/mapoteca/pedido')
    .set('Authorization', generateAdminToken())
    .send({
      data_pedido: '2026-03-10',
      cliente_id: clienteId,
      situacao_pedido_id: 3
    })
  expect(res.status).toBe(201)
  return Number(res.body.dados.id)
}

const criaPedidoNovo = async () => criaPedido(await criaCliente())

const ETIQUETA = {
  destinatario: '4º Centro de Geoinformação',
  aos_cuidados: 'Cap Ronaldo',
  endereco: 'Avenida Marechal Bittencourt, 97\nSanto Antônio\nManaus - AM',
  cep: '69029-160'
}

const salvar = (pedidoId, corpo, token = generateAdminToken()) =>
  request(app)
    .put(`/api/mapoteca/pedido/${pedidoId}/etiqueta`)
    .set('Authorization', token)
    .send(corpo)

const ler = (pedidoId, token = generateUserToken()) =>
  request(app)
    .get(`/api/mapoteca/pedido/${pedidoId}/etiqueta`)
    .set('Authorization', token)

// O historico do pedido sai da rota de PLATAFORMA. O caminho antigo
// `/mapoteca/pedido/:id/auditoria` servia o mesmo conteudo e foi removido por
// ser rota orfa.
const auditoria = async pedidoId => {
  const res = await request(app)
    .get(`/api/auditoria/mapoteca/pedido/${pedidoId}`)
    .set('Authorization', generateAdminToken())
  expect(res.status).toBe(200)
  return res.body.dados.filter(l => l.tabela === 'mapoteca.etiqueta_envio')
}

// --- Testes -----------------------------------------------------------------

describe('Mapoteca - Etiqueta de envio do pedido', () => {
  // Primeira abertura do diálogo: o pedido existe e a etiqueta ainda não. É o
  // caso NORMAL, e por isso responde 200 com dados nulo. Um 404 aqui viraria
  // erro na tela de quem só quer digitar a primeira etiqueta.
  it('pedido sem etiqueta responde 200 com dados nulo', async () => {
    const pedidoId = await criaPedidoNovo()

    const res = await ler(pedidoId)

    expect(res.status).toBe(200)
    expect(res.body.dados).toBeNull()
  })

  it('pedido inexistente responde 404 na leitura e na gravação', async () => {
    const leitura = await ler(999999)
    expect(leitura.status).toBe(404)

    const escrita = await salvar(999999, ETIQUETA)
    expect(escrita.status).toBe(404)
  })

  it('grava a etiqueta e a devolve igual na leitura seguinte', async () => {
    const pedidoId = await criaPedidoNovo()

    const put = await salvar(pedidoId, ETIQUETA)
    expect(put.status).toBe(200)
    expect(put.body.dados.destinatario).toBe(ETIQUETA.destinatario)
    expect(put.body.dados.aos_cuidados).toBe(ETIQUETA.aos_cuidados)
    expect(put.body.dados.endereco).toBe(ETIQUETA.endereco)
    expect(put.body.dados.cep).toBe(ETIQUETA.cep)
    expect(put.body.dados.usuario_cadastramento_uuid).toBe(ADMIN_UUID)

    // A leitura tem de trazer o mesmo que a escrita devolveu. Sem isso o botão
    // Imprimir do cliente nunca liberaria, porque ele compara tela com salvo.
    const get = await ler(pedidoId)
    expect(get.status).toBe(200)
    expect(get.body.dados.destinatario).toBe(ETIQUETA.destinatario)
    expect(get.body.dados.aos_cuidados).toBe(ETIQUETA.aos_cuidados)
    expect(get.body.dados.endereco).toBe(ETIQUETA.endereco)
    expect(get.body.dados.cep).toBe(ETIQUETA.cep)
  })

  // UMA etiqueta por pedido: o segundo PUT corrige a mesma linha, não cria uma
  // segunda. A etiqueta é o endereço corrigido daquele envio, não um histórico
  // de tentativas (o histórico sai da auditoria).
  it('o segundo PUT substitui a etiqueta, e não cria outra linha', async () => {
    const pedidoId = await criaPedidoNovo()

    const primeiro = await salvar(pedidoId, ETIQUETA)
    expect(primeiro.status).toBe(200)
    const idPrimeiro = Number(primeiro.body.dados.id)

    const segundo = await salvar(pedidoId, {
      ...ETIQUETA,
      endereco: 'Rua Cleveland, 250\nPorto Alegre - RS',
      cep: '90850-240'
    })
    expect(segundo.status).toBe(200)
    expect(Number(segundo.body.dados.id)).toBe(idPrimeiro)
    expect(segundo.body.dados.cep).toBe('90850-240')

    const linhas = await conn.any(
      'SELECT id FROM mapoteca.etiqueta_envio WHERE pedido_id = $1',
      [pedidoId]
    )
    expect(linhas).toHaveLength(1)
  })

  // Quem criou fica gravado; quem corrigiu depois entra no campo de modificação.
  // Sem isso, a segunda correção apagaria o nome de quem cadastrou.
  it('guarda quem criou e quem modificou, cada um no seu campo', async () => {
    const pedidoId = await criaPedidoNovo()

    await salvar(pedidoId, ETIQUETA)

    // O usuário comum é operador na mapoteca, então corrige a etiqueta.
    const correcao = await salvar(
      pedidoId,
      { ...ETIQUETA, aos_cuidados: 'Ten Silva' },
      generateUserToken()
    )
    expect(correcao.status).toBe(200)
    expect(correcao.body.dados.usuario_cadastramento_uuid).toBe(ADMIN_UUID)
    expect(correcao.body.dados.usuario_modificacao_uuid).toBe(USER_UUID)
    expect(correcao.body.dados.data_modificacao).not.toBeNull()
  })

  // Campo apagado na tela chega como '' e tem de virar NULL. Se gravasse '', a
  // leitura seguinte diria "tem CEP" onde não há nenhum, e o cliente marcaria
  // diferença entre tela e salvo para sempre.
  it('campo vazio vira nulo, e não string vazia', async () => {
    const pedidoId = await criaPedidoNovo()

    const res = await salvar(pedidoId, {
      destinatario: '18º BI Mtz',
      aos_cuidados: '',
      endereco: '',
      cep: ''
    })
    expect(res.status).toBe(200)
    expect(res.body.dados.aos_cuidados).toBeNull()
    expect(res.body.dados.endereco).toBeNull()
    expect(res.body.dados.cep).toBeNull()
  })

  it('recusa a etiqueta sem destinatário', async () => {
    const pedidoId = await criaPedidoNovo()

    const res = await salvar(pedidoId, { ...ETIQUETA, destinatario: '' })

    expect(res.status).toBe(400)
  })

  // A gravação é do OPERADOR: quem embala o pacote descobre o endereço errado e
  // corrige. A leitura é de CONSULTA. Este caso prova que a leitura de quem só
  // consulta continua passando (o usuário de teste é operador na mapoteca).
  it('operador grava a etiqueta e consulta a lê', async () => {
    const pedidoId = await criaPedidoNovo()

    const put = await salvar(pedidoId, ETIQUETA, generateUserToken())
    expect(put.status).toBe(200)

    const get = await ler(pedidoId, generateUserToken())
    expect(get.status).toBe(200)
    expect(get.body.dados.destinatario).toBe(ETIQUETA.destinatario)
  })

  it('sem token não lê nem grava', async () => {
    const pedidoId = await criaPedidoNovo()

    expect(
      (await request(app).get(`/api/mapoteca/pedido/${pedidoId}/etiqueta`)).status
    ).toBe(401)
    expect(
      (await request(app)
        .put(`/api/mapoteca/pedido/${pedidoId}/etiqueta`)
        .send(ETIQUETA)).status
    ).toBe(401)
  })

  // A rastreabilidade tem de registrar a escrita da etiqueta no histórico do
  // PEDIDO. É o que responde "quem mudou o endereço, e quando".
  it('registra criação e alteração na auditoria do pedido', async () => {
    const pedidoId = await criaPedidoNovo()

    await salvar(pedidoId, ETIQUETA)

    const aposCriacao = await auditoria(pedidoId)
    expect(aposCriacao).toHaveLength(1)
    expect(aposCriacao[0].operacao).toBe('I')
    // `entidade_id` substituiu o `pedido_id` da tabela antiga: o agregado dono
    // agora e (modulo, entidade, entidade_id), e o da etiqueta e o pedido.
    expect(aposCriacao[0].entidade).toBe('pedido')
    expect(Number(aposCriacao[0].entidade_id)).toBe(pedidoId)
    expect(aposCriacao[0].usuario_uuid).toBe(ADMIN_UUID)
    expect(aposCriacao[0].dados_antes).toBeNull()
    expect(aposCriacao[0].dados_depois.destinatario).toBe(ETIQUETA.destinatario)

    await salvar(pedidoId, { ...ETIQUETA, cep: '90850-240' }, generateUserToken())

    const aposAlteracao = await auditoria(pedidoId)
    const alteracao = aposAlteracao.filter(l => l.operacao === 'U')
    expect(alteracao).toHaveLength(1)
    expect(alteracao[0].usuario_uuid).toBe(USER_UUID)
    expect(alteracao[0].dados_antes.cep).toBe('69029-160')
    expect(alteracao[0].dados_depois.cep).toBe('90850-240')
    // O diff traz só o campo que mudou. O carimbo de quem/quando muda em todo
    // UPDATE e fica de fora, senão afogaria o que importa.
    expect(alteracao[0].campos_alterados).toEqual(['cep'])
  })

  // A etiqueta é do envio daquele pedido: pedido apagado, etiqueta apagada
  // junto (ON DELETE CASCADE). O histórico de quem a mudou sobrevive, porque a
  // auditoria não tem FK para o pedido.
  it('a etiqueta cai junto com o pedido apagado', async () => {
    const pedidoId = await criaPedidoNovo()
    await salvar(pedidoId, ETIQUETA)

    const res = await request(app)
      .delete('/api/mapoteca/pedido')
      .set('Authorization', generateAdminToken())
      .send({ pedido_ids: [pedidoId] })
    expect(res.status).toBe(200)

    const restante = await conn.oneOrNone(
      'SELECT id FROM mapoteca.etiqueta_envio WHERE pedido_id = $1',
      [pedidoId]
    )
    expect(restante).toBeNull()

    const linhas = await auditoria(pedidoId)
    expect(linhas.length).toBeGreaterThanOrEqual(1)
  })

  // O CEP DA ETIQUETA SAI NA LISTA DE PEDIDOS, e e por ele que a tela busca.
  //
  // A lista tem `LEFT JOIN mapoteca.etiqueta_envio`, entao o pedido SEM etiqueta
  // tem de continuar na lista, com o campo nulo. Um INNER JOIN aqui apagaria da
  // tela 181 dos 195 pedidos, calado -- que e o mesmo erro que os fragmentos de
  // `query_fragments.js` existem para evitar no item avulso.
  it('GET /pedido devolve o cep da etiqueta, e nulo quando nao ha etiqueta', async () => {
    // UM cliente e dois pedidos: `criaCliente` usa sempre o mesmo nome, e
    // `unique_cliente_nome_sigla` recusa o segundo cadastro com 409.
    const clienteId = await criaCliente()
    const comEtiqueta = await criaPedido(clienteId)
    const semEtiqueta = await criaPedido(clienteId)
    await salvar(comEtiqueta, ETIQUETA)

    const res = await request(app)
      .get('/api/mapoteca/pedido?ano=2026')
      .set('Authorization', generateUserToken())
    expect(res.status).toBe(200)

    const linhaDe = id => res.body.dados.find(p => Number(p.id) === id)

    expect(linhaDe(comEtiqueta).cep_etiqueta).toBe(ETIQUETA.cep)
    // O pedido sem etiqueta CONTINUA na lista.
    expect(linhaDe(semEtiqueta)).toBeDefined()
    expect(linhaDe(semEtiqueta).cep_etiqueta).toBeNull()
  })

  // UMA etiqueta por pedido (unique_etiqueta_por_pedido), entao a juncao nao
  // multiplica a linha do pedido. Se um dia a restricao cair, este teste acusa.
  it('a juncao da etiqueta nao duplica o pedido na lista', async () => {
    const pedidoId = await criaPedidoNovo()
    await salvar(pedidoId, ETIQUETA)
    // Grava DE NOVO: o upsert substitui, e nao acrescenta uma segunda linha.
    await salvar(pedidoId, { ...ETIQUETA, cep: '90850-240' })

    const res = await request(app)
      .get('/api/mapoteca/pedido?ano=2026')
      .set('Authorization', generateUserToken())

    const linhas = res.body.dados.filter(p => Number(p.id) === pedidoId)
    expect(linhas.length).toBe(1)
    expect(linhas[0].cep_etiqueta).toBe('90850-240')
  })
})
