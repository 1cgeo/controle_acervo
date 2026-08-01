'use strict'

// Varredura da auditoria de pedido (mapoteca.pedido_auditoria).
//
// Este arquivo e a TROCA por nao usar gatilho de banco. A insercao da linha de
// auditoria mora no backend, porque o gatilho nao conhece o usuario da sessao
// HTTP (o Postgres ve so a conexao do pool). O preco dessa escolha e a rota nova
// que esquece de auditar. Este teste cobra o preco na hora: cada rota de escrita
// sobre pedido, produto_pedido e impressao dispara e exige que a linha de
// auditoria tenha nascido, com a operacao certa, o usuario certo e o pedido
// certo. O teste "toda rota de escrita esta coberta" reprova a rota nova que
// ninguem lembrou de auditar, e nao seis meses depois em producao.

const request = require('supertest')
const { getApp } = require('../helpers/app')
const { conn, cleanTestData } = require('../helpers/db')
const {
  generateAdminToken,
  generateUserToken,
  ADMIN_UUID,
  USER_UUID
} = require('../helpers/auth')
const mapotecaRouter = require('../../mapoteca/mapoteca_route')

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
      nome: 'OM Teste Auditoria',
      ponto_contato_principal: null,
      endereco_entrega_principal: 'Rua Teste, 1',
      tipo_cliente_id: 1
    })
  expect(res.status).toBe(201)
  const row = await conn.one(
    'SELECT id FROM mapoteca.cliente WHERE nome = $1 ORDER BY id DESC LIMIT 1',
    ['OM Teste Auditoria']
  )
  return Number(row.id)
}

const corpoDoPedido = clienteId => ({
  data_pedido: '2026-03-10',
  cliente_id: clienteId,
  situacao_pedido_id: 3
})

const criaPedido = async clienteId => {
  const res = await request(app)
    .post('/api/mapoteca/pedido')
    .set('Authorization', generateAdminToken())
    .send(corpoDoPedido(clienteId))
  expect(res.status).toBe(201)
  return Number(res.body.dados.id)
}

// Item AVULSO de proposito: ele se descreve no proprio item, entao o teste nao
// precisa montar produto, versao e arquivo no acervo so para exercitar a
// auditoria.
const corpoDoItem = (pedidoId, overrides = {}) => ({
  nome_avulso: 'Papel quadriculado',
  pedido_id: pedidoId,
  quantidade: 10,
  tipo_midia_id: 5,
  ...overrides
})

const criaItem = async (pedidoId, overrides = {}) => {
  const res = await request(app)
    .post('/api/mapoteca/produto_pedido')
    .set('Authorization', generateAdminToken())
    .send(corpoDoItem(pedidoId, overrides))
  expect(res.status).toBe(201)
  const row = await conn.one(
    'SELECT id FROM mapoteca.produto_pedido WHERE pedido_id = $1 ORDER BY id DESC LIMIT 1',
    [pedidoId]
  )
  return Number(row.id)
}

const registraImpressao = async (itemId, token = generateAdminToken()) => {
  const res = await request(app)
    .post('/api/mapoteca/impressao')
    .set('Authorization', token)
    .send({ registros: [{ produto_pedido_id: itemId, quantidade: 3 }] })
  expect(res.status).toBe(201)
  const row = await conn.one(
    'SELECT id FROM mapoteca.impressao_item WHERE produto_pedido_id = $1 ORDER BY id DESC LIMIT 1',
    [itemId]
  )
  return Number(row.id)
}

// Le o historico pela ROTA, e nao pelo banco: assim a varredura tambem exercita
// a rota de leitura que o cliente vai usar.
const auditoria = async pedidoId => {
  const res = await request(app)
    .get(`/api/mapoteca/pedido/${pedidoId}/auditoria`)
    .set('Authorization', generateAdminToken())
  expect(res.status).toBe(200)
  return res.body.dados
}

const eventosDe = (linhas, tabela, operacao) =>
  linhas.filter(l => l.tabela === tabela && l.operacao === operacao)

// --- A varredura ------------------------------------------------------------

// Chave de rota igual a que o teste "toda rota de escrita esta coberta" monta a
// partir do router de verdade.
const COBERTAS = new Set([
  'POST /pedido',
  'PUT /pedido',
  'DELETE /pedido',
  'POST /produto_pedido',
  'PUT /produto_pedido',
  'DELETE /produto_pedido',
  'POST /impressao',
  'DELETE /impressao',
  // Escreve em mapoteca.etiqueta_envio e audita com tabela = 'etiqueta_envio'.
  // Os casos dela vivem em mapoteca_etiqueta.test.js.
  'PUT /pedido/:id/etiqueta'
])

// Rotas que tocam o caminho /pedido mas NAO alteram pedido, produto_pedido nem
// impressao. Cada uma com o motivo, porque lista sem motivo vira gaveta: quem
// acrescentar uma rota aqui tem de dizer por que ela nao audita.
const FORA_DO_ESCOPO = new Map([
  // Cria token de download em acervo.download; nao muda o pedido.
  ['POST /pedido/:id/download_impressao', 'so prepara download, nao muda pedido'],
  // O outro lado do mesmo par: fecha o token em acervo.download, com o mesmo
  // controlador do acervo. Nao toca pedido, item nem impressao -- registrar o
  // que foi IMPRESSO continua sendo POST /impressao, que audita.
  ['POST /impressao/confirmar_download', 'so fecha o token de download, nao muda pedido'],
  // Escreve em mapoteca.anexo_pedido, que tem historico proprio de
  // cadastramento e modificacao na propria tabela.
  ['POST /pedido/:id/anexos', 'escreve em anexo_pedido, nao em pedido'],
  ['DELETE /pedido/anexo/:anexoId', 'escreve em anexo_pedido, nao em pedido']
])

const METODOS_DE_ESCRITA = ['post', 'put', 'patch', 'delete']

const rotasDeEscrita = () => {
  expect(Array.isArray(mapotecaRouter.stack)).toBe(true)

  const chaves = []
  for (const camada of mapotecaRouter.stack) {
    if (!camada.route) continue
    for (const metodo of METODOS_DE_ESCRITA) {
      if (camada.route.methods[metodo]) {
        chaves.push(`${metodo.toUpperCase()} ${camada.route.path}`)
      }
    }
  }

  return chaves.filter(c => /\s\/(pedido|produto_pedido|impressao)\b/.test(c))
}

describe('Auditoria de pedido - varredura das rotas de escrita', () => {
  it('toda rota de escrita sobre pedido, item e impressao esta coberta', () => {
    const encontradas = rotasDeEscrita()

    // Rede contra o falso verde: se o formato do router mudar e a extracao
    // devolver lista vazia, o teste passaria sem cobrar nada.
    expect(encontradas.length).toBeGreaterThanOrEqual(COBERTAS.size)

    const descobertas = encontradas.filter(
      r => !COBERTAS.has(r) && !FORA_DO_ESCOPO.has(r)
    )

    // Rota nova sem auditoria cai AQUI. Para consertar: audite a rota e
    // acrescente a chave em COBERTAS, ou justifique em FORA_DO_ESCOPO.
    expect(descobertas).toEqual([])

    // O caminho inverso: chave em COBERTAS que nao existe mais no router.
    const orfas = [...COBERTAS].filter(r => !encontradas.includes(r))
    expect(orfas).toEqual([])
  })

  it('POST /pedido registra a criacao', async () => {
    const clienteId = await criaCliente()
    const pedidoId = await criaPedido(clienteId)

    const linhas = await auditoria(pedidoId)
    const criacao = eventosDe(linhas, 'pedido', 'I')

    expect(criacao).toHaveLength(1)
    expect(Number(criacao[0].pedido_id)).toBe(pedidoId)
    expect(Number(criacao[0].registro_id)).toBe(pedidoId)
    expect(criacao[0].usuario_uuid).toBe(ADMIN_UUID)
    expect(criacao[0].usuario_nome).toBe('Test Admin')
    expect(criacao[0].dados_antes).toBeNull()
    expect(criacao[0].dados_depois.localizador_pedido).toMatch(
      /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/
    )
  })

  it('PUT /pedido registra a alteracao com o diff dos campos', async () => {
    const clienteId = await criaCliente()
    const pedidoId = await criaPedido(clienteId)

    const res = await request(app)
      .put('/api/mapoteca/pedido')
      .set('Authorization', generateAdminToken())
      .send({
        id: pedidoId,
        ...corpoDoPedido(clienteId),
        observacao: 'Cliente pediu urgencia'
      })
    expect(res.status).toBe(200)

    const linhas = await auditoria(pedidoId)
    const alteracao = eventosDe(linhas, 'pedido', 'U')

    expect(alteracao).toHaveLength(1)
    expect(alteracao[0].dados_antes.observacao).toBeNull()
    expect(alteracao[0].dados_depois.observacao).toBe('Cliente pediu urgencia')

    // O diff e CALCULADO: so o campo que mudou de verdade entra. O carimbo de
    // escrituracao (quem/quando) muda em todo UPDATE e por isso fica de fora,
    // senao ele apareceria em cada linha do historico e afogaria o que importa.
    expect(alteracao[0].campos_alterados).toEqual(['observacao'])
  })

  it('DELETE /pedido registra o que se perdeu, e a linha sobrevive ao pedido', async () => {
    const clienteId = await criaCliente()
    const pedidoId = await criaPedido(clienteId)
    const itemId = await criaItem(pedidoId)
    await registraImpressao(itemId)

    const res = await request(app)
      .delete('/api/mapoteca/pedido')
      .set('Authorization', generateAdminToken())
      .send({ pedido_ids: [pedidoId] })
    expect(res.status).toBe(200)

    // O pedido sumiu de verdade
    const restante = await conn.oneOrNone(
      'SELECT id FROM mapoteca.pedido WHERE id = $1',
      [pedidoId]
    )
    expect(restante).toBeNull()

    // ... e o historico dele continua de pe. E o caso que esta tabela existe
    // para registrar, e a razao de pedido_id NAO ter chave estrangeira.
    const linhas = await auditoria(pedidoId)
    const exclusao = eventosDe(linhas, 'pedido', 'D')

    expect(exclusao).toHaveLength(1)
    expect(exclusao[0].usuario_uuid).toBe(ADMIN_UUID)
    expect(exclusao[0].dados_depois).toBeNull()
    // dados_antes PREENCHIDO: sem ele a exclusao nao diz o que se perdeu.
    expect(exclusao[0].dados_antes).not.toBeNull()
    expect(Number(exclusao[0].dados_antes.cliente_id)).toBe(clienteId)
    expect(exclusao[0].dados_antes.localizador_pedido).toMatch(
      /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/
    )

    // Os filhos tambem: o dados_antes do pedido nao contem os itens dele.
    const itensExcluidos = eventosDe(linhas, 'produto_pedido', 'D')
    expect(itensExcluidos).toHaveLength(1)
    expect(Number(itensExcluidos[0].dados_antes.quantidade)).toBe(10)

    // A impressao cai por ON DELETE CASCADE, sem DELETE explicito no controller.
    const impressoesExcluidas = eventosDe(linhas, 'impressao_item', 'D')
    expect(impressoesExcluidas).toHaveLength(1)
    expect(Number(impressoesExcluidas[0].dados_antes.quantidade)).toBe(3)
  })

  it('POST /produto_pedido registra o item no historico do pedido', async () => {
    const clienteId = await criaCliente()
    const pedidoId = await criaPedido(clienteId)
    const itemId = await criaItem(pedidoId)

    const linhas = await auditoria(pedidoId)
    const criacao = eventosDe(linhas, 'produto_pedido', 'I')

    expect(criacao).toHaveLength(1)
    // pedido_id e o do pedido DONO; registro_id e o da linha filha.
    expect(Number(criacao[0].pedido_id)).toBe(pedidoId)
    expect(Number(criacao[0].registro_id)).toBe(itemId)
    expect(criacao[0].usuario_uuid).toBe(ADMIN_UUID)
    expect(criacao[0].dados_depois.nome_avulso).toBe('Papel quadriculado')
  })

  it('PUT /produto_pedido registra a alteracao do item', async () => {
    const clienteId = await criaCliente()
    const pedidoId = await criaPedido(clienteId)
    const itemId = await criaItem(pedidoId)

    const res = await request(app)
      .put('/api/mapoteca/produto_pedido')
      .set('Authorization', generateAdminToken())
      .send({ id: itemId, ...corpoDoItem(pedidoId, { quantidade: 25 }) })
    expect(res.status).toBe(200)

    const linhas = await auditoria(pedidoId)
    const alteracao = eventosDe(linhas, 'produto_pedido', 'U')

    expect(alteracao).toHaveLength(1)
    expect(Number(alteracao[0].registro_id)).toBe(itemId)
    expect(Number(alteracao[0].dados_antes.quantidade)).toBe(10)
    expect(Number(alteracao[0].dados_depois.quantidade)).toBe(25)
    expect(alteracao[0].campos_alterados).toEqual(['quantidade'])
  })

  it('DELETE /produto_pedido registra o item removido', async () => {
    const clienteId = await criaCliente()
    const pedidoId = await criaPedido(clienteId)
    const itemId = await criaItem(pedidoId)

    const res = await request(app)
      .delete('/api/mapoteca/produto_pedido')
      .set('Authorization', generateAdminToken())
      .send({ produto_pedido_ids: [itemId] })
    expect(res.status).toBe(200)

    const linhas = await auditoria(pedidoId)
    const exclusao = eventosDe(linhas, 'produto_pedido', 'D')

    expect(exclusao).toHaveLength(1)
    expect(Number(exclusao[0].pedido_id)).toBe(pedidoId)
    expect(Number(exclusao[0].registro_id)).toBe(itemId)
    expect(exclusao[0].dados_antes).not.toBeNull()
    expect(Number(exclusao[0].dados_antes.quantidade)).toBe(10)
  })

  it('POST /impressao registra a sessao de impressao', async () => {
    const clienteId = await criaCliente()
    const pedidoId = await criaPedido(clienteId)
    const itemId = await criaItem(pedidoId)
    const impressaoId = await registraImpressao(itemId)

    const linhas = await auditoria(pedidoId)
    const criacao = eventosDe(linhas, 'impressao_item', 'I')

    expect(criacao).toHaveLength(1)
    expect(Number(criacao[0].pedido_id)).toBe(pedidoId)
    expect(Number(criacao[0].registro_id)).toBe(impressaoId)
    expect(Number(criacao[0].dados_depois.quantidade)).toBe(3)
  })

  it('DELETE /impressao registra a remocao com o usuario que a fez', async () => {
    const clienteId = await criaCliente()
    const pedidoId = await criaPedido(clienteId)
    const itemId = await criaItem(pedidoId)
    const impressaoId = await registraImpressao(itemId)

    const res = await request(app)
      .delete('/api/mapoteca/impressao')
      .set('Authorization', generateAdminToken())
      .send({ impressao_ids: [impressaoId] })
    expect(res.status).toBe(200)

    const linhas = await auditoria(pedidoId)
    const exclusao = eventosDe(linhas, 'impressao_item', 'D')

    expect(exclusao).toHaveLength(1)
    expect(Number(exclusao[0].pedido_id)).toBe(pedidoId)
    expect(Number(exclusao[0].registro_id)).toBe(impressaoId)
    expect(exclusao[0].usuario_uuid).toBe(ADMIN_UUID)
    expect(Number(exclusao[0].dados_antes.quantidade)).toBe(3)
  })

  // O usuario gravado tem de ser o do TOKEN, e nao um valor fixo do servidor.
  // Sem este caso, uma auditoria que carimbasse sempre o admin passaria nos
  // outros testes, que usam o token de admin.
  it('grava o usuario do token, nao um usuario fixo', async () => {
    const clienteId = await criaCliente()
    const pedidoId = await criaPedido(clienteId)
    const itemId = await criaItem(pedidoId)

    // O usuario comum tem perfil de operador na mapoteca, entao registra
    // impressao (log operacional), mas nao cria nem apaga pedido.
    await registraImpressao(itemId, generateUserToken())

    const linhas = await auditoria(pedidoId)
    const impressao = eventosDe(linhas, 'impressao_item', 'I')

    expect(impressao).toHaveLength(1)
    expect(impressao[0].usuario_uuid).toBe(USER_UUID)
    expect(impressao[0].usuario_nome).toBe('Test User')

    // O mesmo pedido guarda os dois autores, cada evento com o seu.
    const criacaoPedido = eventosDe(linhas, 'pedido', 'I')
    expect(criacaoPedido[0].usuario_uuid).toBe(ADMIN_UUID)
  })

  it('devolve o historico do mais novo para o mais antigo', async () => {
    const clienteId = await criaCliente()
    const pedidoId = await criaPedido(clienteId)
    await criaItem(pedidoId)

    const res = await request(app)
      .put('/api/mapoteca/pedido')
      .set('Authorization', generateAdminToken())
      .send({
        id: pedidoId,
        ...corpoDoPedido(clienteId),
        observacao: 'segunda mexida'
      })
    expect(res.status).toBe(200)

    const linhas = await auditoria(pedidoId)

    expect(linhas).toHaveLength(3)
    expect(linhas[0].operacao).toBe('U')
    expect(linhas[0].tabela).toBe('pedido')
    expect(linhas[linhas.length - 1].tabela).toBe('pedido')
    expect(linhas[linhas.length - 1].operacao).toBe('I')
  })

  it('exige autenticacao na rota de auditoria', async () => {
    const semToken = await request(app).get('/api/mapoteca/pedido/1/auditoria')
    expect(semToken.status).toBe(401)
  })
})
