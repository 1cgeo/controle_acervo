'use strict'

// Varredura da rastreabilidade da MAPOTECA (auditoria.evento).
//
// Este arquivo e a TROCA por nao usar gatilho de banco. A insercao da linha de
// rastro mora no backend, porque o gatilho nao conhece o usuario da sessao HTTP
// (o Postgres ve so a conexao do pool). O preco dessa escolha e a rota nova que
// esquece de auditar. Este teste cobra o preco na hora: cada rota de escrita do
// router dispara e exige que o evento tenha nascido, com a operacao certa, o
// usuario certo e o agregado certo. O teste "toda rota de escrita esta coberta"
// reprova a rota nova que ninguem lembrou de auditar, e nao seis meses depois em
// producao.
//
// O ALCANCE E O ROUTER INTEIRO. Filtrar as rotas por caminho (so pedido,
// produto_pedido e impressao) deixa cliente, plotter, manutencao, tipo de
// material, estoque e consumo fora da rede, sem que nada diga isso.

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

const criaCliente = async (nome = 'OM Teste Auditoria') => {
  const res = await request(app)
    .post('/api/mapoteca/cliente')
    .set('Authorization', generateAdminToken())
    .send({
      nome,
      ponto_contato_principal: null,
      endereco_entrega_principal: 'Rua Teste, 1',
      tipo_cliente_id: 1
    })
  expect(res.status).toBe(201)
  const row = await conn.one(
    'SELECT id FROM mapoteca.cliente WHERE nome = $1 ORDER BY id DESC LIMIT 1',
    [nome]
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

const criaPlotter = async (nrSerie = 'SN-AUD-1') => {
  const res = await request(app)
    .post('/api/mapoteca/plotter')
    .set('Authorization', generateAdminToken())
    .send({ nr_serie: nrSerie, modelo: 'HP DesignJet', vida_util: 60 })
  expect(res.status).toBe(201)
  const row = await conn.one(
    'SELECT id FROM mapoteca.plotter WHERE nr_serie = $1 ORDER BY id DESC LIMIT 1',
    [nrSerie]
  )
  return Number(row.id)
}

const criaTipoMaterial = async (nome = 'Sulfite auditado') => {
  const res = await request(app)
    .post('/api/mapoteca/tipo_material')
    .set('Authorization', generateAdminToken())
    .send({ nome, estoque_minimo: 10 })
  expect(res.status).toBe(201)
  return Number(res.body.dados.id)
}

// O SALDO NAO TEM MAIS PORTA PROPRIA DE ESCRITA desde 2026-08-08: ele e o
// acumulado do LIVRO. Semear estoque e lancar uma ENTRADA (tipo 1), que e como o
// material chega de verdade. O default e a SECAO (localizacao 1), a unica de
// onde o consumo pode sair.
const criaEstoque = async (tipoMaterialId, quantidade, localizacaoId = 1) => {
  const res = await request(app)
    .post('/api/mapoteca/movimento_material')
    .set('Authorization', generateAdminToken())
    .send({
      tipo_material_id: tipoMaterialId,
      tipo_movimento_id: 1,
      quantidade,
      data_movimento: '2026-03-10',
      localizacao_destino_id: localizacaoId
    })
  expect(res.status).toBe(201)
  return Number(res.body.dados.id)
}

const criaConsumo = async (tipoMaterialId, quantidade, token = generateUserToken()) => {
  const res = await request(app)
    .post('/api/mapoteca/movimento_material')
    .set('Authorization', token)
    .send({
      tipo_material_id: tipoMaterialId,
      tipo_movimento_id: 3,
      quantidade,
      data_movimento: '2026-03-11',
      localizacao_origem_id: 1
    })
  expect(res.status).toBe(201)
  return Number(res.body.dados.id)
}

// Le o historico do PEDIDO pela rota de PLATAFORMA, a mesma que a tela usa.
//
// Havia aqui um `GET /api/mapoteca/pedido/:id/auditoria`, que servia este mesmo
// conteudo pelo caminho antigo. Ele foi removido por ser rota orfa: nenhuma
// tela, plugin ou CLI o chamava, so este teste. O `historico` abaixo faz o
// mesmo, e agora as duas leituras deste arquivo usam a MESMA rota.
const auditoria = pedidoId => historico('pedido', pedidoId)

// Historico de qualquer outra ficha, pela rota geral de rastreabilidade. Cliente,
// plotter e material nao tem rota propria de historico: a de plataforma serve
// todas, com o modulo saindo do proprio caminho.
const historico = async (entidade, id, token = generateAdminToken()) => {
  const res = await request(app)
    .get(`/api/auditoria/mapoteca/${entidade}/${id}`)
    .set('Authorization', token)
  expect(res.status).toBe(200)
  return res.body.dados
}

const eventosDe = (linhas, tabela, operacao) =>
  linhas.filter(l => l.tabela === tabela && l.operacao === operacao)

// --- A varredura ------------------------------------------------------------

// Chave de rota igual a que o teste "toda rota de escrita esta coberta" monta a
// partir do router de verdade.
const COBERTAS = new Set([
  'POST /cliente',
  'PUT /cliente',
  'DELETE /cliente',
  'POST /pedido',
  'PUT /pedido',
  'DELETE /pedido',
  'POST /produto_pedido',
  'PUT /produto_pedido',
  'DELETE /produto_pedido',
  'POST /impressao',
  // CORRECAO da data de um registro ja gravado. Rota propria, e
  // nao campo do POST: registrar impressao e operacao do dia, e mudar QUANDO um
  // gasto aconteceu muda o numero que o RPCMTec reporta naquele mes. O motivo e
  // obrigatorio, e cai no evento.
  'PUT /impressao/:id/data',
  'DELETE /impressao',
  // Escreve em mapoteca.etiqueta_envio e audita com
  // tabela = 'mapoteca.etiqueta_envio'. Os casos dela vivem em
  // mapoteca_etiqueta.test.js.
  'PUT /pedido/:id/etiqueta',
  // O anexo AUDITA, e nao se apoia no carimbo da propria tabela: carimbo diz
  // quem mexeu por ultimo, e a alteracao seguinte o sobrescreve.
  'POST /pedido/:id/anexos',
  'DELETE /pedido/anexo/:anexoId',
  'POST /plotter',
  'PUT /plotter',
  'DELETE /plotter',
  'POST /manutencao_plotter',
  'PUT /manutencao_plotter',
  'DELETE /manutencao_plotter',
  'POST /tipo_material',
  'PUT /tipo_material',
  'DELETE /tipo_material',
  // O ESTOQUE PERDEU AS QUATRO PORTAS DE ESCRITA em 2026-08-08 (o upsert, o
  // PUT, o DELETE e a transferencia): ele virou o acumulado do LIVRO, e quem o
  // move e o gatilho. Sobrou o livro, e ele audita nos tres sentidos, com o
  // efeito no saldo junto e no mesmo lote.
  'POST /movimento_material',
  'PUT /movimento_material',
  'DELETE /movimento_material'
])

// Rotas de escrita que NAO alteram dado da mapoteca. Cada uma com o motivo,
// porque lista sem motivo vira gaveta: quem acrescentar uma rota aqui tem de
// dizer por que ela nao audita.
const FORA_DO_ESCOPO = new Map([
  // Cria token de download em acervo.download; nao muda o pedido.
  ['POST /pedido/:id/download_impressao', 'so prepara download, nao muda pedido'],
  // O outro lado do mesmo par: fecha o token em acervo.download, com o mesmo
  // controlador do acervo. Nao toca pedido, item nem impressao -- registrar o
  // que foi IMPRESSO continua sendo POST /impressao, que audita.
  ['POST /impressao/confirmar_download', 'so fecha o token de download, nao muda pedido']
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

  // SEM FILTRO de caminho: filtrar deixa grupos inteiros de rotas de escrita
  // fora da rede, sem que nada diga isso.
  return chaves
}

describe('Rastreabilidade da mapoteca - varredura das rotas de escrita', () => {
  it('toda rota de escrita do router esta coberta', () => {
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
})

describe('Rastreabilidade da mapoteca - pedido', () => {
  it('POST /pedido registra a criacao', async () => {
    const clienteId = await criaCliente()
    const pedidoId = await criaPedido(clienteId)

    const linhas = await auditoria(pedidoId)
    const criacao = eventosDe(linhas, 'mapoteca.pedido', 'I')

    expect(criacao).toHaveLength(1)
    // O agregado dono, que substituiu o `pedido_id` da tabela antiga.
    expect(criacao[0].modulo).toBe('mapoteca')
    expect(criacao[0].entidade).toBe('pedido')
    expect(Number(criacao[0].entidade_id)).toBe(pedidoId)
    expect(Number(criacao[0].registro_id)).toBe(pedidoId)
    expect(criacao[0].usuario_uuid).toBe(ADMIN_UUID)
    expect(criacao[0].usuario_nome).toBe('Test Admin')
    expect(criacao[0].dados_antes).toBeNull()
    expect(criacao[0].dados_depois.localizador_pedido).toMatch(
      /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/
    )
  })

  it('grava a ROTA por onde a mudanca entrou, e a origem do token', async () => {
    const clienteId = await criaCliente()
    const pedidoId = await criaPedido(clienteId)

    const criacao = eventosDe(await auditoria(pedidoId), 'mapoteca.pedido', 'I')

    expect(criacao[0].rota).toBe('POST /api/mapoteca/pedido')
    // O token da suite nao traz `cliente` no payload, e por isso a origem e
    // 'desconhecido' em vez de 'web'. E o comportamento desejado: adivinhar a
    // porta daria um valor plausivel e errado.
    expect(criacao[0].origem).toBe('desconhecido')
    // Um lote por REQUISICAO, sempre preenchido.
    expect(criacao[0].lote_id).toMatch(/^[0-9a-f-]{36}$/)
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
    const alteracao = eventosDe(linhas, 'mapoteca.pedido', 'U')

    expect(alteracao).toHaveLength(1)
    expect(alteracao[0].dados_antes.observacao).toBeNull()
    expect(alteracao[0].dados_depois.observacao).toBe('Cliente pediu urgencia')

    // O diff e CALCULADO: so o campo que mudou de verdade entra. O carimbo de
    // escrituracao (quem/quando) muda em todo UPDATE e por isso fica de fora,
    // senao ele apareceria em cada linha do historico e afogaria o que importa.
    expect(alteracao[0].campos_alterados).toEqual(['observacao'])
  })

  it('a rota do pedido entrega o diff RENDERIZADO, e nao so o nome da coluna', async () => {
    const clienteId = await criaCliente()
    const pedidoId = await criaPedido(clienteId)

    const res = await request(app)
      .put('/api/mapoteca/pedido')
      .set('Authorization', generateAdminToken())
      .send({
        id: pedidoId,
        ...corpoDoPedido(clienteId),
        situacao_pedido_id: 5,
        // Concluído exige a data de atendimento (RN do pedidoBase), e é ela que
        // conta o pedido no relatório do mês.
        data_atendimento: '2026-03-20'
      })
    expect(res.status).toBe(200)

    const alteracao = eventosDe(await auditoria(pedidoId), 'mapoteca.pedido', 'U')[0]

    // O resumo identifica o registro sem obrigar quem le a abrir 20 campos.
    expect(alteracao.resumo).toMatch(/^Pedido [A-Z0-9-]+$/)

    const mudanca = alteracao.mudancas.find(m => m.campo === 'situacao_pedido_id')
    expect(mudanca.rotulo).toBe('Situação')
    expect(mudanca.tipo).toBe('dominio')
    // De QUE para QUE, em portugues: e a pergunta que a tela nao respondia.
    expect(mudanca.antes_texto).toBe('Em andamento (3)')
    expect(mudanca.depois_texto).toBe('Concluído (5)')
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
    // para registrar, e a razao de `entidade_id` NAO ter chave estrangeira.
    const linhas = await auditoria(pedidoId)
    const exclusao = eventosDe(linhas, 'mapoteca.pedido', 'D')

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
    const itensExcluidos = eventosDe(linhas, 'mapoteca.produto_pedido', 'D')
    expect(itensExcluidos).toHaveLength(1)
    expect(Number(itensExcluidos[0].dados_antes.quantidade)).toBe(10)

    // A impressao cai por ON DELETE CASCADE, sem DELETE explicito no controller.
    const impressoesExcluidas = eventosDe(linhas, 'mapoteca.impressao_item', 'D')
    expect(impressoesExcluidas).toHaveLength(1)
    expect(Number(impressoesExcluidas[0].dados_antes.quantidade)).toBe(3)
    // O agregado da impressao continua sendo o PEDIDO, embora a linha aponte o
    // item: e o que faz o historico do pedido trazer tudo o que aconteceu nele.
    expect(Number(impressoesExcluidas[0].entidade_id)).toBe(pedidoId)
  })

  it('POST /produto_pedido registra o item no historico do pedido', async () => {
    const clienteId = await criaCliente()
    const pedidoId = await criaPedido(clienteId)
    const itemId = await criaItem(pedidoId)

    const linhas = await auditoria(pedidoId)
    const criacao = eventosDe(linhas, 'mapoteca.produto_pedido', 'I')

    expect(criacao).toHaveLength(1)
    // entidade_id e o do pedido DONO; registro_id e o da linha filha.
    expect(Number(criacao[0].entidade_id)).toBe(pedidoId)
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
    const alteracao = eventosDe(linhas, 'mapoteca.produto_pedido', 'U')

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
    const exclusao = eventosDe(linhas, 'mapoteca.produto_pedido', 'D')

    expect(exclusao).toHaveLength(1)
    expect(Number(exclusao[0].entidade_id)).toBe(pedidoId)
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
    const criacao = eventosDe(linhas, 'mapoteca.impressao_item', 'I')

    expect(criacao).toHaveLength(1)
    expect(Number(criacao[0].entidade_id)).toBe(pedidoId)
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
    const exclusao = eventosDe(linhas, 'mapoteca.impressao_item', 'D')

    expect(exclusao).toHaveLength(1)
    expect(Number(exclusao[0].entidade_id)).toBe(pedidoId)
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
    const impressao = eventosDe(linhas, 'mapoteca.impressao_item', 'I')

    expect(impressao).toHaveLength(1)
    expect(impressao[0].usuario_uuid).toBe(USER_UUID)
    expect(impressao[0].usuario_nome).toBe('Test User')

    // O mesmo pedido guarda os dois autores, cada evento com o seu.
    const criacaoPedido = eventosDe(linhas, 'mapoteca.pedido', 'I')
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
    expect(linhas[0].tabela).toBe('mapoteca.pedido')
    expect(linhas[linhas.length - 1].tabela).toBe('mapoteca.pedido')
    expect(linhas[linhas.length - 1].operacao).toBe('I')
  })

  it('o historico do pedido NAO traz evento de outro agregado', async () => {
    // O cliente do pedido tambem e auditado, e o evento dele mora no agregado
    // `cliente`. Se os dois cairem na mesma ficha, a tela do pedido passa a
    // mostrar o cadastro do cliente como se fosse mexida no pedido.
    const clienteId = await criaCliente()
    const pedidoId = await criaPedido(clienteId)

    const linhas = await auditoria(pedidoId)

    expect(linhas.every(l => l.entidade === 'pedido')).toBe(true)
    expect(eventosDe(linhas, 'mapoteca.cliente', 'I')).toHaveLength(0)
  })

  it('exige autenticacao na rota de auditoria', async () => {
    const semToken = await request(app).get('/api/auditoria/mapoteca/pedido/1')
    expect(semToken.status).toBe(401)
  })

  // O caminho antigo `GET /mapoteca/pedido/:id/auditoria` foi REMOVIDO por ser
  // rota orfa. Este caso reprova quem o recriar em silencio: duas rotas para o
  // mesmo dado divergem na primeira que alguem corrigir.
  it('o caminho antigo do historico do pedido nao existe mais', async () => {
    const res = await request(app)
      .get('/api/mapoteca/pedido/1/auditoria')
      .set('Authorization', generateAdminToken())
    expect(res.status).toBe(404)
  })
})

describe('Rastreabilidade da mapoteca - anexo do pedido', () => {
  const PDF_BYTES = Buffer.from('%PDF-1.4\n1 0 obj\n<< >>\nendobj\n%%EOF\n')

  const anexa = async pedidoId => {
    const res = await request(app)
      .post(`/api/mapoteca/pedido/${pedidoId}/anexos`)
      .set('Authorization', generateAdminToken())
      .field('tipo_anexo_id', 1)
      .field('descricao', 'DIEx de solicitação')
      .attach('arquivo', PDF_BYTES, {
        filename: 'diex_134.pdf',
        contentType: 'application/pdf'
      })
    expect(res.status).toBe(201)
    return Number(res.body.dados[0].id)
  }

  it('POST /pedido/:id/anexos registra no historico do pedido, SEM os bytes', async () => {
    const clienteId = await criaCliente()
    const pedidoId = await criaPedido(clienteId)
    const anexoId = await anexa(pedidoId)

    const criacao = eventosDe(await auditoria(pedidoId), 'mapoteca.anexo_pedido', 'I')

    expect(criacao).toHaveLength(1)
    expect(Number(criacao[0].entidade_id)).toBe(pedidoId)
    expect(Number(criacao[0].registro_id)).toBe(anexoId)
    expect(criacao[0].dados_depois.nome_original).toBe('diex_134.pdf')
    expect(Number(criacao[0].dados_depois.tamanho_bytes)).toBe(PDF_BYTES.length)

    // O BYTEA nunca entra no rastro: copiar o anexo para dentro dele dobraria o
    // armazenamento do sistema a cada anexo. O tamanho e o nome continuam la,
    // que e o que o diff precisa para acusar a mudanca.
    expect(criacao[0].dados_depois.conteudo).toBeUndefined()
  })

  it('DELETE /pedido/anexo/:anexoId registra o que se perdeu, com o autor', async () => {
    const clienteId = await criaCliente()
    const pedidoId = await criaPedido(clienteId)
    const anexoId = await anexa(pedidoId)

    const res = await request(app)
      .delete(`/api/mapoteca/pedido/anexo/${anexoId}`)
      .set('Authorization', generateAdminToken())
    expect(res.status).toBe(200)

    const exclusao = eventosDe(await auditoria(pedidoId), 'mapoteca.anexo_pedido', 'D')

    expect(exclusao).toHaveLength(1)
    expect(Number(exclusao[0].registro_id)).toBe(anexoId)
    // A exclusao de anexo tambem carrega o AUTOR: nenhum ato da mapoteca fica
    // sem quem o fez.
    expect(exclusao[0].usuario_uuid).toBe(ADMIN_UUID)
    expect(exclusao[0].dados_antes.nome_original).toBe('diex_134.pdf')
    expect(exclusao[0].dados_depois).toBeNull()
  })
})

describe('Rastreabilidade da mapoteca - cliente', () => {
  it('POST /cliente registra a criacao com o autor', async () => {
    const clienteId = await criaCliente()

    const linhas = await historico('cliente', clienteId)
    const criacao = eventosDe(linhas, 'mapoteca.cliente', 'I')

    expect(criacao).toHaveLength(1)
    expect(Number(criacao[0].entidade_id)).toBe(clienteId)
    expect(Number(criacao[0].registro_id)).toBe(clienteId)
    // A tabela nao tem coluna de escrituracao, entao o EVENTO e o unico lugar
    // que responde quem cadastrou o cliente.
    expect(criacao[0].usuario_uuid).toBe(ADMIN_UUID)
    expect(criacao[0].dados_depois.nome).toBe('OM Teste Auditoria')
  })

  it('PUT /cliente registra o valor anterior de cada campo', async () => {
    const clienteId = await criaCliente()

    const res = await request(app)
      .put('/api/mapoteca/cliente')
      .set('Authorization', generateAdminToken())
      .send({
        id: clienteId,
        nome: 'OM Teste Auditoria',
        endereco_entrega_principal: 'Rua Nova, 42',
        tipo_cliente_id: 1
      })
    expect(res.status).toBe(200)

    const alteracao = eventosDe(
      await historico('cliente', clienteId), 'mapoteca.cliente', 'U'
    )

    expect(alteracao).toHaveLength(1)
    expect(alteracao[0].campos_alterados).toEqual(['endereco_entrega_principal'])
    expect(alteracao[0].dados_antes.endereco_entrega_principal).toBe('Rua Teste, 1')
    expect(alteracao[0].dados_depois.endereco_entrega_principal).toBe('Rua Nova, 42')
  })

  it('DELETE /cliente registra o que se perdeu', async () => {
    const clienteId = await criaCliente()

    const res = await request(app)
      .delete('/api/mapoteca/cliente')
      .set('Authorization', generateAdminToken())
      .send({ cliente_ids: [clienteId] })
    expect(res.status).toBe(200)

    const exclusao = eventosDe(
      await historico('cliente', clienteId), 'mapoteca.cliente', 'D'
    )

    expect(exclusao).toHaveLength(1)
    expect(exclusao[0].usuario_uuid).toBe(ADMIN_UUID)
    expect(exclusao[0].dados_antes.nome).toBe('OM Teste Auditoria')
    expect(exclusao[0].dados_depois).toBeNull()
  })

  it('a rota de historico segue o perfil do MODULO, e recusa quem nao o tem', async () => {
    const clienteId = await criaCliente()

    // Quem le a ficha le o historico dela: o operador da mapoteca passa.
    const comPerfil = await request(app)
      .get(`/api/auditoria/mapoteca/cliente/${clienteId}`)
      .set('Authorization', generateUserToken())
    expect(comPerfil.status).toBe(200)

    // E o mesmo usuario nao ve o historico do orcamento, onde nao tem perfil
    // nenhum. Sem este caso, a guarda por caminho passaria despercebida.
    const semPerfil = await request(app)
      .get('/api/auditoria/orcamento/nota_empenho/1')
      .set('Authorization', generateUserToken())
    expect(semPerfil.status).toBe(403)
  })
})

describe('Rastreabilidade da mapoteca - plotter e manutencao', () => {
  it('POST /plotter registra a criacao, que nao tinha autor nenhum', async () => {
    const plotterId = await criaPlotter()

    const criacao = eventosDe(
      await historico('plotter', plotterId), 'mapoteca.plotter', 'I'
    )

    expect(criacao).toHaveLength(1)
    expect(Number(criacao[0].registro_id)).toBe(plotterId)
    // `criaPlotter` recebia `usuarioUuid` e o IGNORAVA por completo.
    expect(criacao[0].usuario_uuid).toBe(ADMIN_UUID)
    expect(criacao[0].dados_depois.nr_serie).toBe('SN-AUD-1')
  })

  it('PUT /plotter registra a desativacao com os dois lados', async () => {
    const plotterId = await criaPlotter()

    const res = await request(app)
      .put('/api/mapoteca/plotter')
      .set('Authorization', generateAdminToken())
      .send({
        id: plotterId,
        ativo: false,
        nr_serie: 'SN-AUD-1',
        modelo: 'HP DesignJet',
        vida_util: 60
      })
    expect(res.status).toBe(200)

    const alteracao = eventosDe(
      await historico('plotter', plotterId), 'mapoteca.plotter', 'U'
    )

    expect(alteracao).toHaveLength(1)
    expect(alteracao[0].campos_alterados).toEqual(['ativo'])
    expect(alteracao[0].dados_antes.ativo).toBe(true)
    expect(alteracao[0].dados_depois.ativo).toBe(false)

    const mudanca = alteracao[0].mudancas.find(m => m.campo === 'ativo')
    expect(mudanca.rotulo).toBe('Ativo')
    expect(mudanca.antes_texto).toBe('Sim')
    expect(mudanca.depois_texto).toBe('Não')
  })

  it('DELETE /plotter registra o que se perdeu', async () => {
    const plotterId = await criaPlotter()

    const res = await request(app)
      .delete('/api/mapoteca/plotter')
      .set('Authorization', generateAdminToken())
      .send({ plotter_ids: [plotterId] })
    expect(res.status).toBe(200)

    const exclusao = eventosDe(
      await historico('plotter', plotterId), 'mapoteca.plotter', 'D'
    )

    expect(exclusao).toHaveLength(1)
    expect(exclusao[0].dados_antes.nr_serie).toBe('SN-AUD-1')
    expect(exclusao[0].usuario_uuid).toBe(ADMIN_UUID)
  })

  it('a manutencao cai no historico do PLOTTER, e nao num agregado proprio', async () => {
    const plotterId = await criaPlotter()

    const criada = await request(app)
      .post('/api/mapoteca/manutencao_plotter')
      .set('Authorization', generateAdminToken())
      .send({
        plotter_id: plotterId,
        data_manutencao: '2026-03-12',
        valor: 1250.5,
        descricao: 'Troca de cabeçote'
      })
    expect(criada.status).toBe(201)

    const manutencao = await conn.one(
      'SELECT id FROM mapoteca.manutencao_plotter WHERE plotter_id = $1',
      [plotterId]
    )

    const linhas = await historico('plotter', plotterId)
    const evento = eventosDe(linhas, 'mapoteca.manutencao_plotter', 'I')

    expect(evento).toHaveLength(1)
    // Ninguem abre a ficha "manutencao n.o 12": abre a do plotter e olha as
    // manutencoes dele. E a mesma regra que poe o item no historico do pedido.
    expect(Number(evento[0].entidade_id)).toBe(plotterId)
    expect(Number(evento[0].registro_id)).toBe(Number(manutencao.id))

    const valor = evento[0].mudancas.find(m => m.campo === 'valor')
    expect(valor.tipo).toBe('dinheiro')
    expect(valor.depois_texto).toContain('1.250,50')
  })

  it('PUT e DELETE de manutencao registram os dois lados', async () => {
    const plotterId = await criaPlotter()

    const criada = await request(app)
      .post('/api/mapoteca/manutencao_plotter')
      .set('Authorization', generateAdminToken())
      .send({
        plotter_id: plotterId,
        data_manutencao: '2026-03-12',
        valor: 100,
        descricao: null
      })
    expect(criada.status).toBe(201)

    const { id: manutencaoId } = await conn.one(
      'SELECT id FROM mapoteca.manutencao_plotter WHERE plotter_id = $1',
      [plotterId]
    )

    const alterada = await request(app)
      .put('/api/mapoteca/manutencao_plotter')
      .set('Authorization', generateAdminToken())
      .send({
        id: manutencaoId,
        plotter_id: plotterId,
        data_manutencao: '2026-03-12',
        valor: 250,
        descricao: null
      })
    expect(alterada.status).toBe(200)

    const alteracao = eventosDe(
      await historico('plotter', plotterId), 'mapoteca.manutencao_plotter', 'U'
    )
    expect(alteracao).toHaveLength(1)
    expect(alteracao[0].campos_alterados).toEqual(['valor'])
    expect(Number(alteracao[0].dados_antes.valor)).toBe(100)
    expect(Number(alteracao[0].dados_depois.valor)).toBe(250)

    const apagada = await request(app)
      .delete('/api/mapoteca/manutencao_plotter')
      .set('Authorization', generateAdminToken())
      .send({ manutencao_ids: [Number(manutencaoId)] })
    expect(apagada.status).toBe(200)

    const exclusao = eventosDe(
      await historico('plotter', plotterId), 'mapoteca.manutencao_plotter', 'D'
    )
    expect(exclusao).toHaveLength(1)
    expect(Number(exclusao[0].dados_antes.valor)).toBe(250)
  })
})

describe('Rastreabilidade da mapoteca - tipo de material', () => {
  it('POST /tipo_material registra a criacao e a rota continua devolvendo o id', async () => {
    const tipoId = await criaTipoMaterial()

    // O RETURNING passou de `id` para `*` por causa do rastro. A resposta da
    // rota NAO pode ter mudado junto: quem a monta e o valor devolvido pelo
    // controller, e o `criaTipoMaterial` acima ja provou que ele veio.
    expect(tipoId).toBeGreaterThan(0)

    const criacao = eventosDe(
      await historico('material', tipoId), 'mapoteca.tipo_material', 'I'
    )

    expect(criacao).toHaveLength(1)
    expect(Number(criacao[0].registro_id)).toBe(tipoId)
    expect(criacao[0].usuario_uuid).toBe(ADMIN_UUID)
    expect(criacao[0].dados_depois.nome).toBe('Sulfite auditado')
  })

  it('PUT /tipo_material registra a troca de NOME, que muda o que a 7.2 acha', async () => {
    // Era a troca de CATEGORIA ate 2026-08-08, quando a coluna saiu com a fusao
    // das tabelas 7.2 e 7.3. O que sobrou de decisivo no material e o NOME: a
    // 7.2 casa a linha do mes anterior por ele, entao renomear muda o numero que
    // a coluna "Estoque mes anterior" traz.
    const tipoId = await criaTipoMaterial()

    const res = await request(app)
      .put('/api/mapoteca/tipo_material')
      .set('Authorization', generateAdminToken())
      .send({ id: tipoId, nome: 'Sulfite renomeado' })
    expect(res.status).toBe(200)

    const alteracao = eventosDe(
      await historico('material', tipoId), 'mapoteca.tipo_material', 'U'
    )

    expect(alteracao).toHaveLength(1)
    expect(alteracao[0].campos_alterados).toContain('nome')
    expect(alteracao[0].dados_antes.nome).toBe('Sulfite auditado')
    expect(alteracao[0].dados_depois.nome).toBe('Sulfite renomeado')

    const mudanca = alteracao[0].mudancas.find(m => m.campo === 'nome')
    expect(mudanca.rotulo).toBe('Nome')
  })

  it('DELETE /tipo_material registra o que se perdeu', async () => {
    const tipoId = await criaTipoMaterial('Material sem estoque')

    const res = await request(app)
      .delete('/api/mapoteca/tipo_material')
      .set('Authorization', generateAdminToken())
      .send({ tipo_material_ids: [tipoId] })
    expect(res.status).toBe(200)

    const exclusao = eventosDe(
      await historico('material', tipoId), 'mapoteca.tipo_material', 'D'
    )

    expect(exclusao).toHaveLength(1)
    expect(exclusao[0].dados_antes.nome).toBe('Material sem estoque')
  })

  it('DELETE /tipo_material recusa material com movimento, e manda DESATIVAR', async () => {
    // Apagar o material apagaria o LIVRO dele, que e a unica coisa que explica
    // de onde veio o saldo.
    const tipoId = await criaTipoMaterial('Material com historia')
    await criaEstoque(tipoId, 5)

    const res = await request(app)
      .delete('/api/mapoteca/tipo_material')
      .set('Authorization', generateAdminToken())
      .send({ tipo_material_ids: [tipoId] })

    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/Desative o material/)
  })
})

describe('Rastreabilidade da mapoteca - o livro e o efeito de gatilho', () => {
  it('POST /movimento_material registra o movimento E o efeito no saldo', async () => {
    const tipoId = await criaTipoMaterial()
    const entradaId = await criaEstoque(tipoId, 100)

    const linhas = await historico('material', tipoId)

    const movimento = eventosDe(linhas, 'mapoteca.movimento_material', 'I')
    expect(movimento).toHaveLength(1)
    expect(Number(movimento[0].registro_id)).toBe(entradaId)
    expect(movimento[0].origem).toBe('desconhecido')

    // O gatilho do livro escreve `estoque_material`, e sem este evento o
    // historico do material ficaria vazio no exato momento em que o saldo muda.
    // O destino NAO existia: o upsert o cria, e por isso a operacao e 'I'.
    const gatilho = linhas.filter(
      l => l.tabela === 'mapoteca.estoque_material' && l.origem === 'gatilho'
    )
    expect(gatilho).toHaveLength(1)
    expect(gatilho[0].operacao).toBe('I')
    expect(Number(gatilho[0].dados_depois.quantidade)).toBe(100)
    // A pessoa nao editou a linha de estoque: quem a mexeu foi o gatilho. Um
    // evento com origem 'web' aqui diria que alguem a editou a mao.
    expect(gatilho[0].lote_id).toBe(movimento[0].lote_id)
  })

  it('o CONSUMO registra a baixa do saldo da Secao', async () => {
    const tipoId = await criaTipoMaterial()
    await criaEstoque(tipoId, 100)
    const consumoId = await criaConsumo(tipoId, 30)

    const linhas = await historico('material', tipoId)

    const consumo = eventosDe(linhas, 'mapoteca.movimento_material', 'I')
      .find(l => Number(l.registro_id) === consumoId)
    expect(consumo).toBeDefined()
    expect(consumo.usuario_uuid).toBe(USER_UUID)

    const gatilho = linhas.find(
      l => l.tabela === 'mapoteca.estoque_material' &&
        l.origem === 'gatilho' &&
        l.lote_id === consumo.lote_id
    )
    expect(gatilho.operacao).toBe('U')
    expect(Number(gatilho.dados_antes.quantidade)).toBe(100)
    expect(Number(gatilho.dados_depois.quantidade)).toBe(70)
    expect(gatilho.usuario_uuid).toBe(USER_UUID)
  })

  it('a TRANSFERENCIA grava DOIS eventos de estoque, um por lado, no mesmo lote', async () => {
    const tipoId = await criaTipoMaterial()
    await criaEstoque(tipoId, 500, 2) // Almoxarifado

    const res = await request(app)
      .post('/api/mapoteca/movimento_material')
      .set('Authorization', generateUserToken())
      .send({
        tipo_material_id: tipoId,
        tipo_movimento_id: 2,
        quantidade: 200,
        data_movimento: '2026-03-11',
        localizacao_origem_id: 2,
        localizacao_destino_id: 1
      })
    expect(res.status).toBe(201)

    const linhas = await historico('material', tipoId)
    const daTransferencia = linhas.filter(
      l => l.tabela === 'mapoteca.estoque_material' && l.usuario_uuid === USER_UUID
    )

    expect(daTransferencia).toHaveLength(2)

    // Um ATO so: e o lote que diz isso. Sem ele, os dois eventos apareceriam
    // soltos e ninguem saberia que sairam da mesma requisicao.
    expect(daTransferencia[0].lote_id).toBe(daTransferencia[1].lote_id)
    expect(daTransferencia[0].lote_id).not.toBeNull()

    const origem = daTransferencia.find(
      l => l.dados_antes && Number(l.dados_antes.localizacao_id) === 2
    )
    expect(origem.operacao).toBe('U')
    expect(Number(origem.dados_antes.quantidade)).toBe(500)
    expect(Number(origem.dados_depois.quantidade)).toBe(300)

    // O destino NAO existia: o upsert o cria, e por isso o evento e uma
    // insercao, com `dados_antes` legitimamente nulo.
    const destino = daTransferencia.find(l => l.dados_antes === null)
    expect(destino.operacao).toBe('I')
    expect(Number(destino.dados_depois.localizacao_id)).toBe(1)
    expect(Number(destino.dados_depois.quantidade)).toBe(200)
  })

  it('PUT /movimento_material registra o acerto do saldo nos dois sentidos', async () => {
    const tipoId = await criaTipoMaterial()
    await criaEstoque(tipoId, 100)
    const consumoId = await criaConsumo(tipoId, 30)

    // Consumiu MENOS: o gatilho devolve a diferenca ao saldo da Secao.
    const res = await request(app)
      .put('/api/mapoteca/movimento_material')
      .set('Authorization', generateUserToken())
      .send({
        id: consumoId,
        tipo_material_id: tipoId,
        tipo_movimento_id: 3,
        quantidade: 10,
        data_movimento: '2026-03-11',
        localizacao_origem_id: 1
      })
    expect(res.status).toBe(200)

    const linhas = await historico('material', tipoId)

    const alteracao = eventosDe(linhas, 'mapoteca.movimento_material', 'U')
    expect(alteracao).toHaveLength(1)
    expect(Number(alteracao[0].dados_antes.quantidade)).toBe(30)
    expect(Number(alteracao[0].dados_depois.quantidade)).toBe(10)

    const daAtualizacao = linhas.find(
      l => l.tabela === 'mapoteca.estoque_material' &&
        l.origem === 'gatilho' &&
        l.lote_id === alteracao[0].lote_id
    )
    // O gatilho DESFAZ o antigo e APLICA o novo, entao o antes e o saldo de
    // depois do consumo de 30, e o depois ja tem so os 10 baixados.
    expect(Number(daAtualizacao.dados_antes.quantidade)).toBe(70)
    expect(Number(daAtualizacao.dados_depois.quantidade)).toBe(90)
  })

  it('DELETE /movimento_material devolve o saldo, e o evento diz isso', async () => {
    const tipoId = await criaTipoMaterial()
    await criaEstoque(tipoId, 100)
    const consumoId = await criaConsumo(tipoId, 30)

    // APAGAR MOVIMENTO E DO OPERADOR desde 2026-08-08, e era de gerente no
    // consumo. A regua diz que operador LANCA, e desfazer o proprio lancamento
    // errado faz parte de lancar: com gerente, o erro de digitacao esperava.
    const res = await request(app)
      .delete('/api/mapoteca/movimento_material')
      .set('Authorization', generateUserToken())
      .send({ movimento_material_ids: [consumoId] })
    expect(res.status).toBe(200)

    const linhas = await historico('material', tipoId)

    const exclusao = eventosDe(linhas, 'mapoteca.movimento_material', 'D')
    expect(exclusao).toHaveLength(1)
    expect(exclusao[0].usuario_uuid).toBe(USER_UUID)
    expect(Number(exclusao[0].dados_antes.quantidade)).toBe(30)

    const daExclusao = linhas.filter(
      l => l.tabela === 'mapoteca.estoque_material' &&
        l.origem === 'gatilho' &&
        l.lote_id === exclusao[0].lote_id
    )
    expect(daExclusao).toHaveLength(1)
    expect(Number(daExclusao[0].dados_antes.quantidade)).toBe(70)
    expect(Number(daExclusao[0].dados_depois.quantidade)).toBe(100)
  })

  it('exclusao em LOTE grava um evento de estoque por linha apagada', async () => {
    const tipoId = await criaTipoMaterial()
    await criaEstoque(tipoId, 100)
    const consumo1 = await criaConsumo(tipoId, 30)
    const consumo2 = await criaConsumo(tipoId, 20)

    const res = await request(app)
      .delete('/api/mapoteca/movimento_material')
      .set('Authorization', generateAdminToken())
      .send({ movimento_material_ids: [consumo1, consumo2] })
    expect(res.status).toBe(200)

    const linhas = await historico('material', tipoId)
    const exclusoes = eventosDe(linhas, 'mapoteca.movimento_material', 'D')
    expect(exclusoes).toHaveLength(2)

    // O gatilho e FOR EACH ROW: num lote de dois ele dispara DUAS vezes, e o
    // rastro do estoque tem de mostrar as duas devolucoes, e nao uma soma.
    const lote = exclusoes[0].lote_id
    expect(exclusoes[1].lote_id).toBe(lote)

    const gatilhosDoLote = linhas.filter(
      l => l.tabela === 'mapoteca.estoque_material' &&
        l.origem === 'gatilho' &&
        l.lote_id === lote
    )
    expect(gatilhosDoLote).toHaveLength(2)

    // Cada um traz uma leitura de VERDADE do banco, e nao uma subtracao feita no
    // JavaScript: encadeados, eles vao de 50 (o saldo apos os dois consumos) a
    // 100, passando pelo estado intermediario.
    const saldos = gatilhosDoLote
      .map(g => [Number(g.dados_antes.quantidade), Number(g.dados_depois.quantidade)])
      .sort((a, b) => a[0] - b[0])
    expect(saldos[0][0]).toBe(50)
    expect(saldos[1][1]).toBe(100)
  })

  it('o CONSUMO registra o motivo, e o gatilho do saldo entra no mesmo lote', async () => {
    const tipoId = await criaTipoMaterial()
    await criaEstoque(tipoId, 100)

    const res = await request(app)
      .post('/api/mapoteca/movimento_material')
      .set('Authorization', generateUserToken())
      .send({
        tipo_material_id: tipoId,
        tipo_movimento_id: 3,
        quantidade: 7,
        data_movimento: '2026-03-11',
        localizacao_origem_id: 1,
        motivo: 'Bobina molhada'
      })
    expect(res.status).toBe(201)

    const linhas = await historico('material', tipoId)
    const consumo = eventosDe(linhas, 'mapoteca.movimento_material', 'I')
      .find(l => Number(l.registro_id) === Number(res.body.dados.id))

    // O MOTIVO E OPCIONAL desde 2026-08-08, quando a Contagem foi extinta e
    // levou junto a unica exigencia dele. Opcional nao e descartado: quando vem,
    // e ele que explica um consumo que nao foi trabalho -- que e todo o registro
    // que sobrou de quebra e extravio.
    expect(consumo.dados_depois.motivo).toBe('Bobina molhada')

    const gatilho = linhas.find(
      l => l.tabela === 'mapoteca.estoque_material' &&
        l.origem === 'gatilho' &&
        l.lote_id === consumo.lote_id
    )
    expect(Number(gatilho.dados_depois.quantidade)).toBe(93)
  })
})
