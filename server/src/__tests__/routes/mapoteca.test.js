'use strict'

const request = require('supertest')
const { getApp } = require('../helpers/app')
const { conn, cleanTestData } = require('../helpers/db')
const { generateAdminToken, generateUserToken, generateToken, USER_UUID } = require('../helpers/auth')
const { createProduto, createVersao, createArquivo } = require('../helpers/fixtures')
// O recorte do RTM (acumulado ate o mes) se prova no CONTROLLER: a regra e o
// filtro, e o formato do .ods tem teste proprio em unit/rtm_ods.test.js.
const relatorioCtrl = require('../../mapoteca/relatorio_ctrl')

let app

beforeAll(async () => {
  app = await getApp()
})

afterEach(async () => {
  await cleanTestData()
})

// --- Helpers locais ---------------------------------------------------------

// Quantos meses uma serie mensal do dashboard deve trazer para um ano.
//
// NAO e 12 fixo, e nao pode ser 8 fixo tambem: as series param no mes
// CORRENTE, e um numero cravado no teste passaria hoje e reprovaria em setembro
// sem nada ter mudado no codigo. O helper carrega a regra, e nao o resultado
// dela num dia.
//
// Ano passado devolve os doze; ano corrente, os decorridos; ano futuro, nenhum.
// Ver MESES_DO_ANO em mapoteca/dashboard_ctrl.js.
const mesesEsperados = (ano) => {
  const hoje = new Date()
  if (ano < hoje.getFullYear()) return 12
  if (ano > hoje.getFullYear()) return 0
  return hoje.getMonth() + 1
}

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

// A meta do PIT deixou de ser texto no pedido: virou linha em pit.meta_item,
// com chave estrangeira. O teste precisa do item antes do pedido.
// Insere direto no banco porque POST /api/metas e outro modulo, e o que se
// prova aqui e o pedido, nao a rota de metas.
const criaMeta = async (item = '4.1', ano = 2026) => {
  const numeroMeta = parseInt(String(item).split('.')[0], 10)

  // O GRUPO primeiro. Ele tem NOME proprio desde a 1.30.0, e nao promete nada:
  // quem promete e o item.
  const grupo = await conn.one(
    `INSERT INTO pit.meta (ano, numero_meta, nome, usuario_cadastramento_uuid)
     VALUES ($1, $2, $3, (SELECT uuid FROM dgeo.usuario ORDER BY id LIMIT 1))
     ON CONFLICT (ano, numero_meta) DO UPDATE SET ano = EXCLUDED.ano
     RETURNING id`,
    [ano, numeroMeta, `Meta ${numeroMeta}`]
  )

  // O ITEM, que e o alvo de `meta_pit_id`. `unidade_id` e NOT NULL: 1 e Folha.
  const row = await conn.one(
    `INSERT INTO pit.meta_item (meta_id, item, unidade_id, usuario_cadastramento_uuid)
     VALUES ($1, $2, 1, (SELECT uuid FROM dgeo.usuario ORDER BY id LIMIT 1))
     ON CONFLICT (meta_id, item) DO UPDATE SET item = EXCLUDED.item
     RETURNING id`,
    [grupo.id, item]
  )

  // A DESCRICAO mora na revisao. A fixtura cria a R0 do ano e
  // declara o item nela, que e o que a migracao fez em producao.
  const revisao = await conn.one(
    `INSERT INTO pit.revisao (ano, codigo, data_vigencia, usuario_cadastramento_uuid)
     VALUES ($1, 'R0', make_date($1, 1, 1), (SELECT uuid FROM dgeo.usuario ORDER BY id LIMIT 1))
     ON CONFLICT (ano, codigo) DO UPDATE SET ano = EXCLUDED.ano
     RETURNING id`,
    [ano]
  )
  await conn.none(
    `INSERT INTO pit.meta_item_revisao
       (meta_item_id, revisao_id, descricao, usuario_cadastramento_uuid)
     VALUES ($1, $2, $3, (SELECT uuid FROM dgeo.usuario ORDER BY id LIMIT 1))
     ON CONFLICT (meta_item_id, revisao_id) DO UPDATE SET descricao = EXCLUDED.descricao`,
    [row.id, revisao.id, `Meta ${item}`]
  )
  // BIGSERIAL volta como STRING no driver, e o Joi do pedido pede number strict.
  return Number(row.id)
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

// O avulso NAO tem cadastro proprio: ele e descrito no proprio item, junto do
// pedido. Nao ha helper de criacao porque nao ha o que criar antes.

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

// O ESTOQUE NAO TEM MAIS PORTA PROPRIA DE ESCRITA desde 2026-08-08: o saldo e o
// acumulado do livro de movimentos. Semear estoque e lancar uma ENTRADA, que e
// como o material chega de verdade.
const criaEstoque = async (tipoMaterialId, localizacaoId, quantidade) => {
  const res = await request(app)
    .post('/api/mapoteca/movimento_material')
    .set('Authorization', generateAdminToken())
    .send({
      tipo_material_id: tipoMaterialId,
      tipo_movimento_id: 1,
      quantidade,
      data_movimento: '2026-08-08',
      localizacao_destino_id: localizacaoId
    })
  expect(res.status).toBe(201)
}

const transferir = (corpo, token = generateAdminToken()) =>
  request(app)
    .post('/api/mapoteca/movimento_material')
    .set('Authorization', token)
    .send({
      tipo_movimento_id: 2,
      data_movimento: '2026-08-08',
      ...corpo
    })

const getEstoque = async (tipoMaterialId, localizacaoId) => {
  return conn.oneOrNone(
    `SELECT quantidade FROM mapoteca.estoque_material
     WHERE tipo_material_id = $1 AND localizacao_id = $2`,
    [tipoMaterialId, localizacaoId]
  )
}

// --- Testes -----------------------------------------------------------------

describe('Mapoteca Routes', () => {
  describe('Domain endpoints (perfil consulta na mapoteca)', () => {
    it('GET /api/mapoteca/dominio/tipo_cliente exige perfil (antes era publico)', async () => {
      const semPerfil = await request(app).get('/api/mapoteca/dominio/tipo_cliente')
      expect(semPerfil.status).toBe(401)

      const res = await request(app)
        .get('/api/mapoteca/dominio/tipo_cliente')
        .set('Authorization', generateUserToken())
      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(Array.isArray(res.body.dados)).toBe(true)
    })

    it('GET /api/mapoteca/dominio/situacao_pedido should include Aguardando produção (7)', async () => {
      const res = await request(app)
        .get('/api/mapoteca/dominio/situacao_pedido')
        .set('Authorization', generateUserToken())
      expect(res.status).toBe(200)
      const codes = res.body.dados.map(d => d.code)
      expect(codes).toContain(7)
    })

    it('GET /api/mapoteca/dominio/tipo_midia should include Tyvek (8)', async () => {
      const res = await request(app)
        .get('/api/mapoteca/dominio/tipo_midia')
        .set('Authorization', generateUserToken())
      expect(res.status).toBe(200)
      const nomes = res.body.dados.map(d => d.nome)
      expect(nomes).toContain('Tyvek')
    })

    it('GET /api/mapoteca/dominio/forma_entrega should return 5 values', async () => {
      const res = await request(app)
        .get('/api/mapoteca/dominio/forma_entrega')
        .set('Authorization', generateUserToken())
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

    it('a mesma OM não se cadastra duas vezes, e a recusa explica por quê', async () => {
      // A produção tinha o caso: o 3º GAC Ap em duas fichas, com um pedido
      // concluído em cada. Nada dava erro -- a contagem de OM atendidas é que
      // somava duas onde há uma. Ver migrations/2026-08-12.
      await criaCliente({ nome: 'OM Homônima', sigla: 'OM Hom' })

      const res = await request(app)
        .post('/api/mapoteca/cliente')
        .set('Authorization', generateAdminToken())
        .send({ nome: 'OM Homônima', sigla: 'OM Hom', tipo_cliente_id: 1 })

      expect(res.status).toBe(409)
      expect(res.body.message).toMatch(/Já existe um cliente com este nome/)
    })

    it('a recusa vale para quem NÃO tem sigla, que é o NULLS NOT DISTINCT', async () => {
      // O UNIQUE comum do Postgres não casa nulo com nulo, e sem a cláusula a
      // restrição protegeria só quem tem sigla -- deixando de fora justamente o
      // cliente civil, que é o que se cadastra às pressas no meio de um pedido.
      await criaCliente({ nome: 'Órgão Sem Sigla', tipo_cliente_id: 4 })

      const res = await request(app)
        .post('/api/mapoteca/cliente')
        .set('Authorization', generateAdminToken())
        .send({ nome: 'Órgão Sem Sigla', tipo_cliente_id: 4 })

      expect(res.status).toBe(409)
    })

    it('sigla diferente NÃO é duplicata, e o cadastro passa', async () => {
      // A variância: uma restrição que recusasse pelo nome sozinho barraria duas
      // unidades distintas cujo nome por extenso coincide, e o teste acima
      // passaria do mesmo jeito.
      await criaCliente({ nome: 'OM Com Duas Siglas', sigla: 'OM A' })

      const res = await request(app)
        .post('/api/mapoteca/cliente')
        .set('Authorization', generateAdminToken())
        .send({ nome: 'OM Com Duas Siglas', sigla: 'OM B', tipo_cliente_id: 1 })

      expect(res.status).toBe(201)
    })

    it('renomear uma ficha para o nome de outra também é recusado', async () => {
      // O UPDATE cria a duplicata pelo mesmo caminho do INSERT, e um `catch` só
      // no `criaCliente` deixaria a porta aberta pela tela de edição.
      await criaCliente({ nome: 'OM Destino', sigla: 'OM Dst' })
      const origem = await criaCliente({ nome: 'OM Origem', sigla: 'OM Org' })

      const res = await request(app)
        .put('/api/mapoteca/cliente')
        .set('Authorization', generateAdminToken())
        .send({
          id: origem,
          nome: 'OM Destino',
          sigla: 'OM Dst',
          tipo_cliente_id: 1
        })

      expect(res.status).toBe(409)
      expect(res.body.message).toMatch(/Já existe um cliente com este nome/)
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

  // O produto avulso e o que a mapoteca imprime sem ser do acervo: papel
  // quadriculado, carta de outro CGEO. Os testes abaixo guardam a RN08 na sua
  // forma nova ("todo item aponta EXATAMENTE UM produto identificado") e, mais
  // importante, guardam as SOMAS: o modo de falhar deste recurso nao e erro, e
  // numero menor, porque um JOIN interno esquecido apaga o avulso calado.
  describe('Item avulso', () => {
    it('cria avulso e o usa como item do pedido', async () => {
      const clienteId = await criaCliente()
      const pedido = await criaPedido(clienteId)
      await criaProdutoPedido({
        nome_avulso: 'Papel quadriculado',
        descricao_avulso: '80 x 68 cm, quadrícula de 4 x 4 cm',
        pedido_id: pedido.id,
        quantidade: 100,
        tipo_midia_id: 6
      })

      const res = await request(app)
        .get(`/api/mapoteca/pedido/${pedido.id}`)
        .set('Authorization', generateAdminToken())

      expect(res.status).toBe(200)
      expect(res.body.dados.produtos).toHaveLength(1)
      expect(res.body.dados.produtos[0].quantidade).toBe(100)
      expect(res.body.dados.produtos[0].uuid_versao).toBeNull()
      expect(res.body.dados.produtos[0].produto_nome).toBe('Papel quadriculado')
    })

    // GET /pedido/:id era a QUINTA consulta que parte do item do pedido, e a
    // unica que escrevia a escala a mao (`te.nome`). O que se prova aqui e que
    // ela nao pode divergir do /download_impressao, que o plugin do QGIS le na
    // MESMA sessao: a tabela de itens e o manifesto CSV sairiam com escalas
    // diferentes para a mesma carta.
    it('a escala do detalhe do pedido e a MESMA do download_impressao', async () => {
      const produto = await createProduto({
        tipo_produto_id: 2,
        tipo_escala_id: 5,
        denominador_escala_especial: 30000,
        mi: '2965-1'
      })
      const versao = await createVersao(produto.id)
      await createArquivo(versao.id, { nome_arquivo: 'carta_30k', extensao: 'pdf' })

      const clienteId = await criaCliente()
      const pedido = await criaPedido(clienteId)
      await criaProdutoPedido({
        uuid_versao: versao.uuid_versao,
        pedido_id: pedido.id, quantidade: 2, tipo_midia_id: 5
      })
      await criaProdutoPedido({
        nome_avulso: 'Papel quadriculado',
        pedido_id: pedido.id, quantidade: 10, tipo_midia_id: 6
      })

      const detalhe = await request(app)
        .get(`/api/mapoteca/pedido/${pedido.id}`)
        .set('Authorization', generateAdminToken())
      const download = await request(app)
        .post(`/api/mapoteca/pedido/${pedido.id}/download_impressao`)
        .set('Authorization', generateAdminToken())

      const doAcervo = detalhe.body.dados.produtos.find(p => !p.item_avulso)
      const avulso = detalhe.body.dados.produtos.find(p => p.item_avulso)

      // Escala personalizada se ESCREVE, nao se nomeia: era 'Escala personalizada'
      expect(doAcervo.escala).toBe('1:30000')
      expect(doAcervo.escala).toBe(download.body.dados.arquivos[0].escala)

      // O avulso nao aponta produto do acervo: era NULO, e a tela mostrava "null"
      expect(avulso.escala).toBe('Sem escala')
      expect(avulso.escala).toBe(download.body.dados.itens_sem_pdf[0].escala)
    })

    it('item sem destino nenhum should return 400', async () => {
      const clienteId = await criaCliente()
      const pedido = await criaPedido(clienteId)
      const res = await request(app)
        .post('/api/mapoteca/produto_pedido')
        .set('Authorization', generateAdminToken())
        .send({ pedido_id: pedido.id, quantidade: 1, tipo_midia_id: 6 })

      expect(res.status).toBe(400)
    })

    it('item com os DOIS destinos should return 400', async () => {
      const clienteId = await criaCliente()
      const pedido = await criaPedido(clienteId)
      const produto = await createProduto({ tipo_produto_id: 2, tipo_escala_id: 2, mi: '2965-1' })
      const versao = await createVersao(produto.id)

      const res = await request(app)
        .post('/api/mapoteca/produto_pedido')
        .set('Authorization', generateAdminToken())
        .send({
          pedido_id: pedido.id,
          uuid_versao: versao.uuid_versao,
          nome_avulso: 'Outro',
          quantidade: 1,
          tipo_midia_id: 6
        })

      expect(res.status).toBe(400)
    })

    it('o avulso aparece IDENTIFICADO na consulta publica por localizador', async () => {
      const clienteId = await criaCliente({ nome: 'OM Publica' })
      const pedido = await criaPedido(clienteId, {
        observacao_interna: 'anotacao da equipe que nao pode vazar'
      })
      await criaProdutoPedido({
        nome_avulso: 'Papel quadriculado A0',
        descricao_avulso: '80 x 68 cm, quadricula de 4 x 4 cm',
        pedido_id: pedido.id, quantidade: 100, tipo_midia_id: 6
      })

      // Rota PUBLICA: sem Authorization de proposito.
      const res = await request(app)
        .get(`/api/mapoteca/pedido/localizador/${pedido.localizador_pedido}`)

      expect(res.status).toBe(200)
      expect(res.body.dados.produtos).toHaveLength(1)
      const item = res.body.dados.produtos[0]
      // Sem os COALESCE, o cliente veria uma linha em branco com "100" ao lado.
      expect(item.produto_nome).toBe('Papel quadriculado A0')
      expect(item.avulso_descricao).toBe('80 x 68 cm, quadricula de 4 x 4 cm')
      expect(item.item_avulso).toBe(true)
      expect(item.quantidade).toBe(100)
      // O que a rota publica NUNCA pode devolver continua de fora.
      expect(JSON.stringify(res.body)).not.toContain('anotacao da equipe')
    })

    it('pedido com item avulso e um pedido NORMAL: entra na fila e conta igual', async () => {
      // NAO existe "pedido avulso". O que muda e o produto do ITEM; o pedido
      // segue o mesmo fluxo. Este teste guarda isso na fila de atendimento, que
      // e onde a diferenca apareceria primeiro para quem imprime.
      const clienteId = await criaCliente({ nome: 'OM Fila', tipo_cliente_id: 1 })
      const pedido = await criaPedido(clienteId, { situacao_pedido_id: 3 })
      await criaProdutoPedido({
        nome_avulso: 'Papel quadriculado da fila',
        pedido_id: pedido.id, quantidade: 40, tipo_midia_id: 6
      })

      const fila = await request(app)
        .get('/api/mapoteca/pedido/em_aberto')
        .set('Authorization', generateAdminToken())

      expect(fila.status).toBe(200)
      const nafila = fila.body.dados.find(p => p.id === pedido.id)
      // Se este undefined aparecer, o pedido com item avulso sumiu da fila.
      expect(nafila).toBeDefined()
      // Conta igual: um item, 40 copias, nada impresso ainda.
      expect(nafila.total_itens).toBe(1)
      expect(nafila.quantidade_pedida).toBe(40)
      expect(nafila.itens_impressos).toBe(0)

      // E a tela de quem imprime mostra o item, com o nome do avulso e sem
      // arquivo para baixar (nao existe PDF no acervo para papel quadriculado).
      const impressao = await request(app)
        .get(`/api/mapoteca/pedido/${pedido.id}/impressao`)
        .set('Authorization', generateAdminToken())

      expect(impressao.status).toBe(200)
      const itens = impressao.body.dados.itens || impressao.body.dados
      expect(itens).toHaveLength(1)
      expect(itens[0].produto_nome).toBe('Papel quadriculado da fila')
      expect(itens[0].item_avulso).toBe(true)
      expect(itens[0].uuid_arquivo == null).toBe(true)
    })

    it('o avulso ENTRA nas somas do dashboard, e as parcelas fecham o total', async () => {
      // O modo de falhar aqui e silencioso: com JOIN interno o avulso sumiria, e
      // com "NULL NOT IN (...)" ele entraria no total e ficaria fora de outros.
      const clienteId = await criaCliente({ nome: 'OM Avulso', tipo_cliente_id: 1 })
      const pedido = await criaPedido(clienteId, {
        situacao_pedido_id: 5,
        data_atendimento: '2026-03-20'
      })
      await criaProdutoPedido({
        nome_avulso: 'Papel quadriculado do teste',
        pedido_id: pedido.id,
        quantidade: 100,
        tipo_midia_id: 6
      })

      const res = await request(app)
        .get('/api/mapoteca/dashboard/entregas_por_mes?ano=2026')
        .set('Authorization', generateAdminToken())

      expect(res.status).toBe(200)
      const marco = res.body.dados.find(m => m.mes === 3)
      expect(marco.total).toBeGreaterThanOrEqual(100)
      // A conta que o "IS NULL OR" existe para manter de pe.
      for (const mes of res.body.dados) {
        expect(mes.carta_topo + mes.carta_orto + mes.outros).toBe(mes.total)
      }
    })
  })

  describe('Pedidos', () => {
    // A lista respeita o ANO DE CONTEXTO, e nao traz o acervo inteiro. O custo
    // e deliberado: o pedido de dezembro concluido em janeiro so aparece
    // trocando o ano na navbar.
    it('GET /api/mapoteca/pedido devolve so os pedidos do ano', async () => {
      const clienteId = await criaCliente({ nome: 'OM Lista Ano' })
      await criaPedido(clienteId, { data_pedido: '2025-12-20', data_atendimento: null, situacao_pedido_id: 2 })
      await criaPedido(clienteId, { data_pedido: '2026-02-05', data_atendimento: null, situacao_pedido_id: 2 })

      const r2026 = await request(app)
        .get('/api/mapoteca/pedido?ano=2026')
        .set('Authorization', generateUserToken())
      const r2025 = await request(app)
        .get('/api/mapoteca/pedido?ano=2025')
        .set('Authorization', generateUserToken())

      expect(r2026.status).toBe(200)
      expect(r2026.body.dados).toHaveLength(1)
      expect(r2025.body.dados).toHaveLength(1)
      expect(r2026.body.dados[0].data_pedido).toContain('2026-02-05')
      expect(r2025.body.dados[0].data_pedido).toContain('2025-12-20')
    })

    it('POST /api/mapoteca/pedido should create with demandante/previsto_pit', async () => {
      const clienteId = await criaCliente()
      const metaId = await criaMeta('4.1')
      const pedido = await criaPedido(clienteId, {
        demandante: 'CMS',
        previsto_pit: true,
        meta_pit_id: metaId
      })

      expect(pedido.id).toBeDefined()
      expect(pedido.localizador_pedido).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/)

      const res = await request(app)
        .get(`/api/mapoteca/pedido/${pedido.id}`)
        .set('Authorization', generateAdminToken())

      expect(res.status).toBe(200)
      expect(res.body.dados.demandante).toBe('CMS')
      expect(res.body.dados.previsto_pit).toBe(true)
      // O id serve a escrita; o codigo derivado e o que a tela e a planilha leem.
      // NUMERO, e nao texto: as tres consultas de pedido trazem `meta_pit_id::int`
      // desde 2026-08-07, porque o driver devolve int8 como string e o Joi da
      // escrita e strict, o que recusava toda leitura-altera-reenvia.
      expect(res.body.dados.meta_pit_id).toBe(metaId)
      expect(res.body.dados.meta_pit_codigo).toBe('4.1')
    })

    it('POST /api/mapoteca/pedido previsto no PIT sem meta_pit_id should return 400', async () => {
      const clienteId = await criaCliente()
      const res = await request(app)
        .post('/api/mapoteca/pedido')
        .set('Authorization', generateAdminToken())
        .send({
          data_pedido: '2026-01-15',
          cliente_id: clienteId,
          situacao_pedido_id: 3,
          previsto_pit: true
        })

      expect(res.status).toBe(400)
    })

    it('PUT /api/mapoteca/pedido preserva meta_pit_id quando a chave é omitida', async () => {
      const clienteId = await criaCliente()
      const metaId = await criaMeta('4.2')
      const pedido = await criaPedido(clienteId, { previsto_pit: true, meta_pit_id: metaId })

      // Corpo sem previsto_pit e sem meta_pit_id: é o que a edição a partir da
      // LISTA manda. Nenhum dos dois pode ser zerado em silêncio.
      const res = await request(app)
        .put('/api/mapoteca/pedido')
        .set('Authorization', generateAdminToken())
        .send({
          id: pedido.id,
          data_pedido: '2026-01-15',
          cliente_id: clienteId,
          situacao_pedido_id: 3,
          demandante: 'CMS'
        })

      expect(res.status).toBe(200)

      const depois = await request(app)
        .get(`/api/mapoteca/pedido/${pedido.id}`)
        .set('Authorization', generateAdminToken())

      expect(depois.body.dados.previsto_pit).toBe(true)
      expect(depois.body.dados.meta_pit_codigo).toBe('4.2')
      expect(depois.body.dados.demandante).toBe('CMS')
    })

    it('PUT /api/mapoteca/pedido marcando previsto_pit sem meta_pit_id should return 400', async () => {
      const clienteId = await criaCliente()
      const pedido = await criaPedido(clienteId)

      const res = await request(app)
        .put('/api/mapoteca/pedido')
        .set('Authorization', generateAdminToken())
        .send({
          id: pedido.id,
          data_pedido: '2026-01-15',
          cliente_id: clienteId,
          situacao_pedido_id: 3,
          previsto_pit: true,
          meta_pit_id: null
        })

      expect(res.status).toBe(400)
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

    it('GET /api/mapoteca/pedido/localizador/:localizador (público) returns status, observação e itens', async () => {
      const produto = await createProduto({ tipo_produto_id: 2, tipo_escala_id: 2 })
      const versao = await createVersao(produto.id)
      const clienteId = await criaCliente()
      const pedido = await criaPedido(clienteId, {
        observacao: 'Pedido urgente para exercício',
        // A forma de entrega é do PEDIDO, e não mais do item.
        forma_entrega_id: 1
      })

      await criaProdutoPedido({
        uuid_versao: versao.uuid_versao,
        pedido_id: pedido.id,
        quantidade: 4,
        tipo_midia_id: 5,
        observacao: 'Plotagem em papel A0'
      })

      // Sem autenticação, rota pública de acompanhamento (RN04)
      const res = await request(app)
        .get(`/api/mapoteca/pedido/localizador/${pedido.localizador_pedido}`)

      expect(res.status).toBe(200)
      const dados = res.body.dados
      expect(dados.localizador_pedido).toBe(pedido.localizador_pedido)
      expect(dados.situacao_pedido_nome).toBeDefined()
      expect(dados.observacao).toBe('Pedido urgente para exercício')
      // A forma de entrega sai UMA vez, no pedido, e não repetida em cada item.
      expect(dados.forma_entrega_nome).toBe('Correios')
      // Não deve expor o id interno do pedido
      expect(dados.id).toBeUndefined()

      expect(Array.isArray(dados.produtos)).toBe(true)
      expect(dados.produtos).toHaveLength(1)
      const item = dados.produtos[0]
      expect(item.quantidade).toBe(4)
      expect(item.tipo_midia_nome).toBeDefined()
      expect(item.observacao).toBe('Plotagem em papel A0')
      expect(item.produto_nome).toBeDefined()
      expect(item.tipo_produto_nome).toBe('Carta Topográfica')
    })

    // A observacao interna existe para NAO aparecer aqui. A rota e publica (sem
    // autenticacao), e observacao e observacao_envio saem nela; se a interna
    // saisse tambem, a coluna nao teria razao de existir. Este teste e o que faz
    // a promessa cumprir: a lista de colunas do controller e explicita, e um
    // SELECT * futuro derruba este teste.
    it('GET /api/mapoteca/pedido/localizador/:localizador NAO expõe a observação interna', async () => {
      const clienteId = await criaCliente()
      const pedido = await criaPedido(clienteId, {
        observacao: 'Entregar na S3',
        observacao_envio: 'Enviado por PAC',
        observacao_interna: 'Sd Silva levou aos Correios; cartão devolvido ao Ten'
      })

      const detalhe = await request(app)
        .get(`/api/mapoteca/pedido/${pedido.id}`)
        .set('Authorization', generateAdminToken())
      expect(detalhe.status).toBe(200)
      // Quem tem perfil na mapoteca LE o campo: a separação é de consulta
      // pública, não de permissão.
      expect(detalhe.body.dados.observacao_interna)
        .toBe('Sd Silva levou aos Correios; cartão devolvido ao Ten')

      const publico = await request(app)
        .get(`/api/mapoteca/pedido/localizador/${pedido.localizador_pedido}`)
      expect(publico.status).toBe(200)
      const dados = publico.body.dados
      expect(dados.observacao).toBe('Entregar na S3')
      expect(dados.observacao_envio).toBe('Enviado por PAC')
      expect(dados.observacao_interna).toBeUndefined()
      expect(JSON.stringify(dados)).not.toContain('Sd Silva')
    })

    // A tela de acompanhamento mostra esta data como "envio/entrega": é o dia em
    // que o material saiu. Não existe coluna data_envio, de propósito.
    it('GET /api/mapoteca/pedido/localizador/:localizador devolve a data de atendimento', async () => {
      const clienteId = await criaCliente()
      const pedido = await criaPedido(clienteId, {
        situacao_pedido_id: 5,
        data_pedido: '2026-03-10',
        data_atendimento: '2026-03-20'
      })

      const res = await request(app)
        .get(`/api/mapoteca/pedido/localizador/${pedido.localizador_pedido}`)

      expect(res.status).toBe(200)
      // DATE volta como string crua ('AAAA-MM-DD'), sem fuso no caminho.
      expect(res.body.dados.data_atendimento).toBe('2026-03-20')
    })

    // A FILA da tela de atendimento. Ela existe separada da lista de pedidos por
    // duas decisões, e as duas são testadas aqui: só o que está em aberto, e sem
    // recorte de ano.
    describe('GET /api/mapoteca/pedido/em_aberto (fila de atendimento)', () => {
      const emAberto = (token = generateAdminToken()) => request(app)
        .get('/api/mapoteca/pedido/em_aberto')
        .set('Authorization', token)

      // A segunda fila, pedida por query. Ver o describe do fim deste bloco.
      const filaAtendimento = (token = generateAdminToken()) => request(app)
        .get('/api/mapoteca/pedido/em_aberto?incluir_remetidos=true')
        .set('Authorization', token)

      it('traz o pedido em aberto e deixa de fora concluído e cancelado', async () => {
        const clienteId = await criaCliente()
        const aberto = await criaPedido(clienteId, { situacao_pedido_id: 3, data_atendimento: null })
        const concluido = await criaPedido(clienteId, {
          situacao_pedido_id: 5, data_atendimento: '2026-03-20'
        })
        const cancelado = await criaPedido(clienteId, {
          situacao_pedido_id: 6, data_atendimento: null, motivo_cancelamento: 'desistência'
        })

        const res = await emAberto()

        expect(res.status).toBe(200)
        const ids = res.body.dados.map(p => Number(p.id))
        expect(ids).toContain(Number(aberto.id))
        expect(ids).not.toContain(Number(concluido.id))
        expect(ids).not.toContain(Number(cancelado.id))
      })

      // Remetido (4) NÃO entra na fila PADRÃO, que é a de IMPRESSÃO. O pedido já
      // foi impresso, etiquetado e despachado: pô-lo de volta é oferecer ao
      // plugin do QGIS um trabalho já feito. Ele entra na fila de ATENDIMENTO,
      // logo abaixo, porque ali a pergunta é outra: o que falta FECHAR.
      it('tira da fila PADRÃO (impressão) o pedido Remetido', async () => {
        const clienteId = await criaCliente()
        const remetido = await criaPedido(clienteId, { situacao_pedido_id: 4 })

        const res = await emAberto()

        expect(res.body.dados.map(p => Number(p.id))).not.toContain(Number(remetido.id))
      })

      // A FILA DE ATENDIMENTO, por `?incluir_remetidos=true`.
      //
      // O beco sem saída que ela fecha: marcar Remetido é a última ação de quem
      // atende, e era ela que apagava o pedido da tela. Dali em diante o pedido
      // dependia de alguém abrir a lista de pedidos, achar o filtro "Remetido" e
      // marcar Concluído. Ficava aberto por tempo indefinido.
      //
      // Situação 4 = Remetido, conferido em er/mapoteca.sql (INSERT de
      // mapoteca.situacao_pedido).
      it('com incluir_remetidos=true traz o Remetido, e segue sem Concluído nem Cancelado', async () => {
        const clienteId = await criaCliente()
        const remetido = await criaPedido(clienteId, { situacao_pedido_id: 4 })
        const emAndamento = await criaPedido(clienteId, {
          situacao_pedido_id: 3, data_atendimento: null
        })
        const concluido = await criaPedido(clienteId, {
          situacao_pedido_id: 5, data_atendimento: '2026-03-20'
        })
        const cancelado = await criaPedido(clienteId, {
          situacao_pedido_id: 6, data_atendimento: null, motivo_cancelamento: 'desistência'
        })

        const res = await filaAtendimento()

        expect(res.status).toBe(200)
        const ids = res.body.dados.map(p => Number(p.id))
        expect(ids).toContain(Number(remetido.id))
        expect(ids).toContain(Number(emAndamento.id))
        // O corte que continua valendo: a fila de atendimento é do que falta
        // fechar, e o que já fechou não volta.
        expect(ids).not.toContain(Number(concluido.id))
        expect(ids).not.toContain(Number(cancelado.id))
      })

      // O controle NEGATIVO da mudança: a mesma base, as duas filas, e a
      // diferença tem de ser exatamente o pedido Remetido. Sem esta comparação o
      // teste acima passaria mesmo se a query fosse ignorada e as duas filas
      // fossem a mesma lista.
      it('a fila de atendimento é a de impressão MAIS o Remetido', async () => {
        const clienteId = await criaCliente()
        const remetido = await criaPedido(clienteId, { situacao_pedido_id: 4 })
        await criaPedido(clienteId, { situacao_pedido_id: 3, data_atendimento: null })

        const impressao = (await emAberto()).body.dados.map(p => Number(p.id))
        const atendimento = (await filaAtendimento()).body.dados.map(p => Number(p.id))

        expect(atendimento.length).toBe(impressao.length + 1)
        const soNaDeAtendimento = atendimento.filter(id => !impressao.includes(id))
        expect(soNaDeAtendimento).toEqual([Number(remetido.id)])
      })

      // Query desconhecida vira 400: a validação de query não descarta chave, ao
      // contrário da de corpo. Vale registrar porque quem errar o nome do
      // parâmetro recebe erro, e não a fila errada em silêncio.
      it('recusa query desconhecida e valor não booleano', async () => {
        expect((await request(app)
          .get('/api/mapoteca/pedido/em_aberto?incluir_remetido=true')
          .set('Authorization', generateAdminToken())).status).toBe(400)

        expect((await request(app)
          .get('/api/mapoteca/pedido/em_aberto?incluir_remetidos=talvez')
          .set('Authorization', generateAdminToken())).status).toBe(400)
      })

      // O pedido de dezembro ainda não atendido é trabalho em janeiro.
      it('NÃO filtra por ano, ao contrário da lista de pedidos', async () => {
        const clienteId = await criaCliente()
        const antigo = await criaPedido(clienteId, {
          data_pedido: '2025-12-20', situacao_pedido_id: 3, data_atendimento: null
        })

        const fila = await emAberto()
        expect(fila.body.dados.map(p => Number(p.id))).toContain(Number(antigo.id))

        // A lista de pedidos, por contraste, é do ano consultado.
        const lista = await request(app)
          .get('/api/mapoteca/pedido?ano=2026')
          .set('Authorization', generateAdminToken())
        expect(lista.body.dados.map(p => Number(p.id))).not.toContain(Number(antigo.id))
      })

      it('ordena por prazo, com o pedido sem prazo no fim', async () => {
        const clienteId = await criaCliente()
        const semPrazo = await criaPedido(clienteId, { situacao_pedido_id: 3, data_atendimento: null, prazo: null })
        const tarde = await criaPedido(clienteId, { situacao_pedido_id: 3, data_atendimento: null, prazo: '2026-12-01' })
        const cedo = await criaPedido(clienteId, { situacao_pedido_id: 3, data_atendimento: null, prazo: '2026-01-05' })

        const res = await emAberto()
        const ids = res.body.dados.map(p => Number(p.id))

        expect(ids.indexOf(Number(cedo.id))).toBeLessThan(ids.indexOf(Number(tarde.id)))
        expect(ids.indexOf(Number(tarde.id))).toBeLessThan(ids.indexOf(Number(semPrazo.id)))
      })

      it('conta os itens e as cópias já impressas, e diz quantos dias faltam', async () => {
        const produto = await createProduto({ tipo_produto_id: 2, tipo_escala_id: 2 })
        const versao = await createVersao(produto.id)
        const clienteId = await criaCliente()
        const pedido = await criaPedido(clienteId, {
          situacao_pedido_id: 3, data_atendimento: null, prazo: '2026-01-05'
        })
        await criaProdutoPedido({
          uuid_versao: versao.uuid_versao, pedido_id: pedido.id, quantidade: 10, tipo_midia_id: 5
        })
        // POST /produto_pedido nao devolve o id do item: ele sai do banco.
        const item = await conn.one(
          'SELECT id FROM mapoteca.produto_pedido WHERE pedido_id = $1', [pedido.id]
        )
        await request(app)
          .post('/api/mapoteca/impressao')
          .set('Authorization', generateAdminToken())
          .send({ registros: [{ produto_pedido_id: item.id, quantidade: 4 }] })

        const res = await emAberto()
        const linha = res.body.dados.find(p => Number(p.id) === Number(pedido.id))

        expect(linha.total_itens).toBe(1)
        expect(linha.quantidade_pedida).toBe(10)
        expect(linha.quantidade_impressa).toBe(4)
        expect(linha.itens_impressos).toBe(0)
        // Calculado no BANCO (prazo - CURRENT_DATE), para a tela não fazer conta
        // de data e não errar por fuso. Prazo no passado dá negativo.
        expect(typeof linha.dias_para_prazo).toBe('number')
        expect(linha.dias_para_prazo).toBeLessThan(0)
        // O endereço vem junto porque a etiqueta de envio sai desta tela.
        expect(linha).toHaveProperty('endereco_entrega')
        expect(linha).toHaveProperty('cliente_endereco_entrega')
      })

      // O usuario comum dos testes JA e operador na mapoteca (setup.js), entao
      // provar a restricao exige rebaixa-lo a consulta e devolver depois. Sem
      // isso o teste passaria sem exercitar nada.
      it('exige perfil OPERADOR: quem só consulta não vê a fila', async () => {
        expect((await request(app).get('/api/mapoteca/pedido/em_aberto')).status).toBe(401)
        expect((await emAberto(generateUserToken())).status).toBe(200)

        await conn.none(
          `UPDATE dgeo.usuario_perfil SET perfil_id = 1
           WHERE modulo_id = 2 AND usuario_id = (
             SELECT id FROM dgeo.usuario WHERE uuid = $1)`,
          [USER_UUID]
        )
        try {
          expect((await emAberto(generateUserToken())).status).toBe(403)
        } finally {
          await conn.none(
            `UPDATE dgeo.usuario_perfil SET perfil_id = 2
             WHERE modulo_id = 2 AND usuario_id = (
               SELECT id FROM dgeo.usuario WHERE uuid = $1)`,
            [USER_UUID]
          )
        }
      })
    })

    describe('GET /api/mapoteca/pedido/:id/impressao (o que imprimir)', () => {
      const montaPedidoComPdf = async () => {
        const produto = await createProduto({ tipo_produto_id: 2, tipo_escala_id: 2, mi: '2965-2' })
        const versao = await createVersao(produto.id)
        // O PDF do produto: é ele que a tela manda imprimir.
        const pdf = await createArquivo(versao.id, {
          nome: 'Carta 2965-2', nome_arquivo: 'ct_2965-2_ed1', extensao: 'pdf',
          tipo_arquivo_id: 1, tipo_status_id: 1
        })
        // Um XML de metadado na MESMA versão, que não pode ser escolhido.
        await createArquivo(versao.id, {
          nome: 'Metadado', nome_arquivo: 'ct_2965-2_ed1_meta', extensao: 'xml',
          tipo_arquivo_id: 4, tipo_status_id: 1
        })
        const clienteId = await criaCliente()
        const pedido = await criaPedido(clienteId, { situacao_pedido_id: 3, data_atendimento: null })
        await criaProdutoPedido({
          uuid_versao: versao.uuid_versao, pedido_id: pedido.id, quantidade: 5, tipo_midia_id: 5
        })
        const item = await conn.one(
          'SELECT id FROM mapoteca.produto_pedido WHERE pedido_id = $1', [pedido.id]
        )
        return { pedido, item, pdf, versao }
      }

      it('devolve o uuid do PDF da carta, e não o do metadado', async () => {
        const { pedido, pdf } = await montaPedidoComPdf()

        const res = await request(app)
          .get(`/api/mapoteca/pedido/${pedido.id}/impressao`)
          .set('Authorization', generateAdminToken())

        expect(res.status).toBe(200)
        expect(res.body.dados.itens).toHaveLength(1)
        const item = res.body.dados.itens[0]
        // É pelo uuid que o navegador chama /acervo/arquivo/:uuid/download.
        expect(item.uuid_arquivo).toBe(pdf.uuid_arquivo)
        expect(item.arquivo_nome_fisico).toBe('ct_2965-2_ed1.pdf')
        expect(item.quantidade).toBe(5)
        expect(item.quantidade_restante).toBe(5)
        expect(item.impressao_concluida).toBe(false)
      })

      it('desconta o que já foi impresso', async () => {
        const { pedido, item } = await montaPedidoComPdf()
        await request(app)
          .post('/api/mapoteca/impressao')
          .set('Authorization', generateAdminToken())
          .send({ registros: [{ produto_pedido_id: item.id, quantidade: 5 }] })

        const res = await request(app)
          .get(`/api/mapoteca/pedido/${pedido.id}/impressao`)
          .set('Authorization', generateAdminToken())

        const linha = res.body.dados.itens[0]
        expect(linha.quantidade_impressa).toBe(5)
        expect(linha.quantidade_restante).toBe(0)
        expect(linha.impressao_concluida).toBe(true)
        expect(res.body.dados.impressao.concluida).toBe(true)
      })

      // Item sem PDF aparece com uuid nulo, e não desaparece: quem atende precisa
      // saber que aquela carta não tem arquivo, e não descobrir na hora de plotar.
      it('item sem PDF vem com uuid nulo e é contado', async () => {
        const produto = await createProduto({ tipo_produto_id: 2, tipo_escala_id: 2 })
        const versao = await createVersao(produto.id)
        const clienteId = await criaCliente()
        const pedido = await criaPedido(clienteId, { situacao_pedido_id: 3, data_atendimento: null })
        await criaProdutoPedido({
          uuid_versao: versao.uuid_versao, pedido_id: pedido.id, quantidade: 2, tipo_midia_id: 5
        })

        const res = await request(app)
          .get(`/api/mapoteca/pedido/${pedido.id}/impressao`)
          .set('Authorization', generateAdminToken())

        expect(res.body.dados.itens).toHaveLength(1)
        expect(res.body.dados.itens[0].uuid_arquivo).toBeNull()
        expect(res.body.dados.impressao.itens_sem_arquivo).toBe(1)
      })

      // A rota é LEITURA: ao contrário de /download_impressao, ela não cria token.
      // Token criado aqui viraria linha pendente em acervo.download que ninguém
      // confirma, e o cron a marcaria como falha.
      it('não cria registro de download', async () => {
        const { pedido, pdf } = await montaPedidoComPdf()

        await request(app)
          .get(`/api/mapoteca/pedido/${pedido.id}/impressao`)
          .set('Authorization', generateAdminToken())

        const downloads = await conn.any(
          'SELECT id FROM acervo.download WHERE arquivo_id = $1', [pdf.id]
        )
        expect(downloads).toHaveLength(0)
      })

      // Rota IRMA, e nao a do acervo, por causa da permissao: quem atende tem
      // operador na MAPOTECA e pode nao ter perfil nenhum no acervo. E ela confere
      // o par (pedido, arquivo), senao viraria download do acervo inteiro com
      // perfil de mapoteca, bastando trocar o uuid.
      it('baixa a carta do item pela rota do pedido', async () => {
        const { pedido, pdf } = await montaPedidoComPdf()
        // O byte no volume: o volume de teste e /data/test, semeado no setup.
        const fs = require('fs')
        const path = require('path')
        const volume = await conn.one('SELECT volume FROM acervo.volume_armazenamento WHERE id = 1')
        const destino = path.join(volume.volume, `${pdf.nome_arquivo}.${pdf.extensao}`)
        fs.mkdirSync(path.dirname(destino), { recursive: true })
        fs.writeFileSync(destino, Buffer.from('%PDF-1.4 carta de teste'))

        try {
          const res = await request(app)
            .get(`/api/mapoteca/pedido/${pedido.id}/arquivo/${pdf.uuid_arquivo}/download`)
            .set('Authorization', generateAdminToken())
            .buffer()
            .parse((res, cb) => {
              const partes = []
              res.on('data', (p) => partes.push(p))
              res.on('end', () => cb(null, Buffer.concat(partes)))
            })

          expect(res.status).toBe(200)
          expect(res.headers['content-disposition']).toContain('ct_2965-2_ed1.pdf')
          expect(Buffer.from(res.body).toString()).toContain('carta de teste')
        } finally {
          fs.rmSync(destino, { force: true })
        }
      })

      it('recusa arquivo que não é carta de item DESTE pedido', async () => {
        const { pdf } = await montaPedidoComPdf()
        // Outro pedido, sem nenhum item: o mesmo uuid nao vale aqui.
        const outro = await criaPedido(await criaCliente({ nome: 'Outra OM' }), {
          situacao_pedido_id: 3, data_atendimento: null
        })

        const res = await request(app)
          .get(`/api/mapoteca/pedido/${outro.id}/arquivo/${pdf.uuid_arquivo}/download`)
          .set('Authorization', generateAdminToken())

        expect(res.status).toBe(404)
        expect(res.body.message).toMatch(/não é a carta de nenhum item/i)
      })

      it('pedido inexistente dá 404, e sem token dá 401', async () => {
        const semToken = await request(app).get('/api/mapoteca/pedido/999999/impressao')
        expect(semToken.status).toBe(401)

        const admin = await request(app)
          .get('/api/mapoteca/pedido/999999/impressao')
          .set('Authorization', generateAdminToken())
        expect(admin.status).toBe(404)
      })
    })

    it('GET /api/mapoteca/pedido/localizador/:localizador inexistente returns 404', async () => {
      const res = await request(app)
        .get('/api/mapoteca/pedido/localizador/AAAA-BBBB-CCCC')

      expect(res.status).toBe(404)
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
      // A forma e a data de entrega sao do PEDIDO. O item so
      // descreve O QUE se imprime.
      const pedido = await criaPedido(clienteId, {
        forma_entrega_id: 1,
        data_atendimento: '2026-03-20'
      })

      // A MIDIA diverge, e a QUANTIDADE nao tem como divergir: pedido em
      // sulfite (5) e atendido em tyvek (8). A `quantidade_fornecida` saiu em
      // 2026-08-08 (igual a `quantidade` em 1759 de 1759 linhas da producao); a
      // midia fornecida ficou, com 25 divergencias reais medidas nas mesmas
      // linhas.
      await criaProdutoPedido({
        uuid_versao: versao.uuid_versao,
        pedido_id: pedido.id,
        quantidade: 10,
        tipo_midia_id: 5,
        tipo_midia_fornecida_id: 8,
        observacao: 'Entrega parcial'
      })

      const res = await request(app)
        .get(`/api/mapoteca/pedido/${pedido.id}`)
        .set('Authorization', generateAdminToken())

      expect(res.status).toBe(200)
      expect(res.body.dados.forma_entrega_id).toBe(1)
      expect(res.body.dados.forma_entrega_nome).toBe('Correios')
      // toBe, e nao toContain: o toContain passaria tambem com um timestamp em
      // UTC ('2026-03-20T00:00:00.000Z'), que e justamente o que produz o D-1 na
      // tela. A igualdade exata exige que a data volte sem hora e sem fuso.
      expect(res.body.dados.data_atendimento).toBe('2026-03-20')
      const item = res.body.dados.produtos[0]
      expect(item.quantidade).toBe(10)
      // A coluna saiu, e o detalhe do pedido nao a inventa de volta.
      expect(item).not.toHaveProperty('quantidade_fornecida')
      expect(item.tipo_midia_fornecida_nome).toBe('Tyvek')
      expect(item.observacao).toBe('Entrega parcial')
      expect(item.tipo_produto_nome).toBe('Carta Topográfica')
    })

    // Guarda do D-1. O formulario manda data PURA ('AAAA-MM-DD'), porque o campo
    // do client e um <input type="date">. Ela tem que voltar no mesmo dia de
    // calendario, sem depender do fuso do processo nem da sessao do banco.
    it('data pura do formulario volta no mesmo dia, no detalhe e na lista', async () => {
      const clienteId = await criaCliente()
      const pedido = await criaPedido(clienteId, {
        data_pedido: '2026-03-10',
        data_atendimento: '2026-03-20',
        prazo: '2026-03-15'
      })

      const res = await request(app)
        .get(`/api/mapoteca/pedido/${pedido.id}`)
        .set('Authorization', generateAdminToken())

      expect(res.status).toBe(200)
      expect(res.body.dados.data_pedido).toBe('2026-03-10')
      expect(res.body.dados.data_atendimento).toBe('2026-03-20')
      expect(res.body.dados.prazo).toBe('2026-03-15')

      // A lista le as mesmas datas por OUTRA consulta, entao ela tem guarda propria.
      const lista = await request(app)
        .get('/api/mapoteca/pedido')
        .set('Authorization', generateAdminToken())
      const naLista = lista.body.dados.find(p => p.id === pedido.id)
      expect(naLista.data_pedido).toBe('2026-03-10')
      expect(naLista.data_atendimento).toBe('2026-03-20')
    })
  })

  describe('Tipo de Material', () => {
    it('POST with estoque_minimo/ativo should persist; list returns abaixo_minimo', async () => {
      // meta_anual saiu em 2026-08-08, junto com categoria_id e tipo_midia_id:
      // estava NULA nas 34 linhas da producao e nao tinha leitor.
      const id = await criaTipoMaterial({
        nome: 'Papel Sulfite 90g',
        estoque_minimo: 10,
        ativo: true
      })

      const res = await request(app)
        .get('/api/mapoteca/tipo_material')
        .set('Authorization', generateUserToken())

      expect(res.status).toBe(200)
      const material = res.body.dados.find(m => m.id === id)
      expect(material).toBeDefined()
      expect(parseFloat(material.estoque_minimo)).toBe(10)
      expect(material.ativo).toBe(true)
      // Sem estoque cadastrado: 0 < 10 → abaixo do mínimo
      expect(material.abaixo_minimo).toBe(true)
    })

    it('o alerta de estoque mínimo conta só Seção + Almoxarifado', async () => {
      // 'Aquisição realizada' (3) é material comprado e ainda não entregue.
      // Contá-lo no alerta esconderia a falta na Seção atrás de uma compra que
      // ainda está com o fornecedor.
      const id = await criaTipoMaterial({ nome: 'Tyvek comprado', estoque_minimo: 10 })
      await criaEstoque(id, 3, 50)

      const res = await request(app)
        .get('/api/mapoteca/tipo_material')
        .set('Authorization', generateUserToken())

      const material = res.body.dados.find(m => m.id === id)
      // O total mostra os 50 que vêm vindo; o disponível é zero, e é ele que
      // dispara o alerta.
      expect(parseFloat(material.estoque_total)).toBe(50)
      expect(parseFloat(material.estoque_disponivel)).toBe(0)
      expect(material.abaixo_minimo).toBe(true)
    })

    it('o nome do material é ÚNICO, e a recusa explica por quê', async () => {
      // A 7.2 do RPCMTec casa a linha do mês anterior pelo NOME, e com a fusão
      // de 2026-08-08 papel e tinta passaram a dividir um espaço de nomes só.
      await criaTipoMaterial({ nome: 'Cartucho homônimo' })

      const res = await request(app)
        .post('/api/mapoteca/tipo_material')
        .set('Authorization', generateAdminToken())
        .send({ nome: 'Cartucho homônimo' })

      expect(res.status).toBe(409)
      expect(res.body.message).toMatch(/Já existe um material com este nome/)
    })

    it('o OPERADOR cadastra material, e a consulta não cadastra', async () => {
      // Era de GERENTE até 2026-08-08. Quem faz contagem na prateleira é quem
      // descobre, ali, que o cartucho novo ainda não existe no sistema: exigir
      // gerente para essa linha fazia a contagem parar e esperar.
      const doOperador = await request(app)
        .post('/api/mapoteca/tipo_material')
        .set('Authorization', generateUserToken())
        .send({ nome: 'Material do operador' })
      expect(doOperador.status).not.toBe(403)

      const leitura = await request(app)
        .get('/api/mapoteca/tipo_material')
        .set('Authorization', generateUserToken())
      expect(leitura.status).toBe(200)
    })
  })

  // A TRANSFERENCIA virou o tipo 2 do LIVRO em 2026-08-08. Era
  // POST /estoque_material/transferir, que fazia dois UPDATEs sem data e sem
  // motivo: o saldo mudava e nada dizia quando nem por que. As regras de negocio
  // sao as mesmas; o que mudou foi o endereco e o rastro.
  describe('Transferência entre localizações, pelo livro', () => {
    it('move a quantidade entre as localizações', async () => {
      const materialId = await criaTipoMaterial()
      await criaEstoque(materialId, 2, 10) // Almoxarifado

      const res = await transferir({
        tipo_material_id: materialId,
        localizacao_origem_id: 2,
        localizacao_destino_id: 1,
        quantidade: 4
      })

      expect(res.status).toBe(201)

      const origem = await getEstoque(materialId, 2)
      const destino = await getEstoque(materialId, 1)
      expect(parseFloat(origem.quantidade)).toBe(6)
      expect(parseFloat(destino.quantidade)).toBe(4)
    })

    it('soma no destino que já tinha saldo', async () => {
      const materialId = await criaTipoMaterial()
      await criaEstoque(materialId, 2, 10)
      await criaEstoque(materialId, 1, 3)

      const res = await transferir({
        tipo_material_id: materialId,
        localizacao_origem_id: 2,
        localizacao_destino_id: 1,
        quantidade: 2
      })

      expect(res.status).toBe(201)
      const destino = await getEstoque(materialId, 1)
      expect(parseFloat(destino.quantidade)).toBe(5)
    })

    it('recusa com 400 quando a origem não tem saldo suficiente', async () => {
      const materialId = await criaTipoMaterial()
      await criaEstoque(materialId, 2, 1)

      const res = await transferir({
        tipo_material_id: materialId,
        localizacao_origem_id: 2,
        localizacao_destino_id: 1,
        quantidade: 100
      })

      expect(res.status).toBe(400)
      expect(res.body.message).toContain('insuficiente')
    })

    it('recusa com 400 quando a origem não tem estoque nenhum, e ensina o conserto', async () => {
      const materialId = await criaTipoMaterial()

      const res = await transferir({
        tipo_material_id: materialId,
        localizacao_origem_id: 3,
        localizacao_destino_id: 1,
        quantidade: 1
      })

      expect(res.status).toBe(400)
      // A mensagem do gatilho sobe inteira, em vez de virar a genérica de 500.
      expect(res.body.message).toMatch(/não tem estoque em/)
    })

    it('recusa com 400 origem igual ao destino', async () => {
      // Somaria e subtrairia o mesmo saldo, e passaria por lançamento válido.
      const materialId = await criaTipoMaterial()

      const res = await transferir({
        tipo_material_id: materialId,
        localizacao_origem_id: 1,
        localizacao_destino_id: 1,
        quantidade: 1
      })

      expect(res.status).toBe(400)
    })

    it('recusa com 400 quantidade não positiva', async () => {
      const materialId = await criaTipoMaterial()

      const res = await transferir({
        tipo_material_id: materialId,
        localizacao_origem_id: 2,
        localizacao_destino_id: 1,
        quantidade: 0
      })

      expect(res.status).toBe(400)
    })

    it('aceita o operador da mapoteca (lançar movimento é rotina de quem imprime)', async () => {
      const res = await transferir({
        tipo_material_id: 1,
        localizacao_origem_id: 2,
        localizacao_destino_id: 1,
        quantidade: 1
      }, generateUserToken())

      // O que se afirma aqui e a AUTORIZACAO: o operador nao e barrado por
      // perfil. O resultado de negocio depende do estoque semeado, entao a
      // asserção é sobre nao levar 403.
      expect(res.status).not.toBe(403)
    })

    it('a leitura do livro é de CONSULTA, e o estoque não tem mais porta de escrita', async () => {
      const leitura = await request(app)
        .get('/api/mapoteca/movimento_material')
        .set('Authorization', generateUserToken())
      expect(leitura.status).toBe(200)

      // As quatro portas antigas do saldo sumiram: uma delas viva ao lado do
      // livro faria a soma do livro deixar de bater com o saldo no primeiro uso.
      const upsert = await request(app)
        .post('/api/mapoteca/estoque_material')
        .set('Authorization', generateAdminToken())
        .send({ tipo_material_id: 1, quantidade: 1, localizacao_id: 1 })
      expect(upsert.status).toBe(404)

      const antiga = await request(app)
        .post('/api/mapoteca/estoque_material/transferir')
        .set('Authorization', generateAdminToken())
        .send({ tipo_material_id: 1, origem_id: 2, destino_id: 1, quantidade: 1 })
      expect(antiga.status).toBe(404)
    })
  })

  describe('Relatórios', () => {
    // Cenário: pedido militar 2026 com carta topo 1:50.000 entregue
    const setupPedidoMilitar = async () => {
      const produto = await createProduto({ tipo_produto_id: 2, tipo_escala_id: 2, mi: 'MI-2965-2' })
      const versao = await createVersao(produto.id)
      const clienteId = await criaCliente({ nome: '3º RCC', tipo_cliente_id: 1 })
      const metaId = await criaMeta('4.1')
      // Sem `omds`: a coluna saiu em 2026-08-08, e a coluna "OMDS" da aba do
      // RTM passou a sair de fora do pedido (ver o bloco OMDS em
      // relatorio_ctrl.js; era literal ate 2026-08-09, e hoje e a sigla de
      // `dgeo.instituicao`). O caso do relatorio abaixo continua exigindo o
      // valor, e e ele que guarda essa troca.
      const pedido = await criaPedido(clienteId, {
        demandante: 'CMS',
        previsto_pit: true,
        meta_pit_id: metaId,
        operacao: 'Operação Teste',
        // O prazo existe no cenário de propósito: ele NÃO pode sair na coluna
        // "Meta" do relatório, e um caso do .ods guarda isso.
        prazo: '2026-04-10',
        documento_solicitacao: 'DIEx 123-S3/3º RCC',
        // As colunas "Data da Entrega" e "Forma da Entrega" das abas saem do
        // PEDIDO. A data é a data_atendimento, que o helper
        // criaPedido já põe.
        forma_entrega_id: 1
      })
      await criaProdutoPedido({
        uuid_versao: versao.uuid_versao,
        pedido_id: pedido.id,
        quantidade: 10,
        tipo_midia_id: 5,
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
      // A SEMENTE, e nao uma constante do codigo. O '1º CGEO' desta instalacao
      // e o valor semeado por `er/dgeo.sql`, e nao uma verdade universal: outro
      // Centro instala o SAP e esta coluna sai com a sigla DELE. Ler a semente
      // aqui e o que faz este caso continuar provando a ligacao em vez de fixar
      // o nome desta casa.
      const semente = await conn.one('SELECT sigla FROM dgeo.instituicao WHERE id = 1')
      expect(item.omds).toBe(semente.sigla)
      expect(item.demandante).toBe('CMS')
      expect(item.om_destino).toBe('3º RCC')
      expect(item.mi).toBe('MI-2965-2')
      expect(item.escala).toBe('1:50.000')
      expect(item.quantidade_prevista).toBe(10)
      expect(item.material_previsto).toBe('Sulfite 90g')
      expect(item.forma_entrega).toBe('Correios')
      expect(item.mes).toBe(3)
    })

    it('GET /relatorio/impressao_detalhada?formato=csv should return the 15-column CSV', async () => {
      await setupPedidoMilitar()

      const res = await request(app)
        .get('/api/mapoteca/relatorio/impressao_detalhada?ano=2026&formato=csv')
        .set('Authorization', generateUserToken())

      expect(res.status).toBe(200)
      expect(res.headers['content-type']).toContain('text/csv')
      expect(res.headers['content-disposition']).toContain('impressao_detalhada_2026.csv')
      expect(res.text.charCodeAt(0)).toBe(0xFEFF)
      const [header, primeiraLinha] = res.text.slice(1).split('\r\n')
      const colunas = header.split(';')
      expect(colunas).toHaveLength(15)
      expect(colunas[0]).toBe('OMDS')
      // o recorte enxuto não traz as colunas extras do Detalhado
      expect(header).not.toContain('Nome do Produto')
      expect(header).not.toContain('Localizador')
      expect(primeiraLinha).toContain('3º RCC')
    })

    // O .ods é rota PRÓPRIA, e não ?formato=ods da rota acima: ele não devolve o
    // mesmo conteúdo. Aqui se prova o que muda, porque é isso que faz a planilha
    // colar na aba META4_DETALHADA do RTM sem retrabalho.
    describe('Impressão detalhada em .ods (aba META4_DETALHADA do RTM)', () => {
      const lerZip = (buffer) => {
        const zlib = require('zlib')
        const entradas = {}
        let i = 0
        while (i + 4 <= buffer.length && buffer.readUInt32LE(i) === 0x04034b50) {
          const metodo = buffer.readUInt16LE(i + 8)
          const comprimido = buffer.readUInt32LE(i + 18)
          const tamNome = buffer.readUInt16LE(i + 26)
          const tamExtra = buffer.readUInt16LE(i + 28)
          const nome = buffer.slice(i + 30, i + 30 + tamNome).toString('utf8')
          const inicio = i + 30 + tamNome + tamExtra
          const dados = buffer.slice(inicio, inicio + comprimido)
          entradas[nome] = metodo === 0 ? dados : zlib.inflateRawSync(dados)
          i = inicio + comprimido
        }
        return entradas
      }

      const baixar = async () => {
        const res = await request(app)
          .get('/api/mapoteca/relatorio/impressao_detalhada_ods?ano=2026')
          .set('Authorization', generateUserToken())
          .buffer()
          .parse((res, cb) => {
            const partes = []
            res.on('data', (p) => partes.push(p))
            res.on('end', () => cb(null, Buffer.concat(partes)))
          })
        return res
      }

      it('baixa um .ods de verdade, com a aba do RTM', async () => {
        await setupPedidoMilitar()

        const res = await baixar()

        expect(res.status).toBe(200)
        expect(res.headers['content-type']).toContain('application/vnd.oasis.opendocument.spreadsheet')
        expect(res.headers['content-disposition']).toContain('META4_DETALHADA_2026.ods')

        const entradas = lerZip(res.body)
        expect(entradas.mimetype.toString()).toBe('application/vnd.oasis.opendocument.spreadsheet')
        const content = entradas['content.xml'].toString('utf8')
        expect(content).toContain('table:name="META4_DETALHADA"')
      })

      it('traduz para o vocabulário da aba: sim/não, material minúsculo, data como DATA', async () => {
        await setupPedidoMilitar()

        const content = lerZip((await baixar()).body)['content.xml'].toString('utf8')

        // previsto_pit = true no cenário
        expect(content).toContain('<text:p>sim</text:p>')
        // A coluna "Meta" traz o CÓDIGO da meta apontada pelo pedido, como
        // texto, e nunca o `p.prazo` (uma data sob o rótulo "Meta"). O prazo
        // está no cenário justamente para guardar essa distinção.
        expect(content).toContain('<text:p>4.1</text:p>')
        expect(content).not.toContain('office:date-value="2026-04-10"')
        // 'Sulfite 90g' no banco vira 'sulfite' na aba (que nunca teve gramatura)
        expect(content).toContain('<text:p>sulfite</text:p>')
        expect(content).not.toContain('Sulfite 90g')
        // data_entrega 2026-03-20: célula DATE, e não texto
        expect(content).toContain('office:date-value="2026-03-20"')
        expect(content).toContain('<text:p>20/03/26</text:p>')
        // quantidade como número
        expect(content).toContain('office:value="10"')
      })

      it('as 15 colunas saem na ordem da aba, e "Meta" não traz mais o prazo', async () => {
        await setupPedidoMilitar()

        const content = lerZip((await baixar()).body)['content.xml'].toString('utf8')

        // Le a PRIMEIRA linha da tabela, sem citar nome de estilo. O arquivo
        // passou a sair da planilha-semente da propria aba, e com
        // ele mudou o estilo do cabecalho (era `ceCab`, do gerador que montava o
        // arquivo do zero; hoje e o `ce1` do modelo). O que este teste protege
        // sao os ROTULOS e a ORDEM deles, e amarra-lo ao estilo fazia a troca de
        // gerador reprovar uma aba que estava certa.
        const linhaCabecalho = content.slice(
          content.indexOf('<table:table-row'),
          content.indexOf('</table:table-row>')
        )
        const rotulos = [...linhaCabecalho.matchAll(/<table:table-cell[^>]*>([\s\S]*?)<\/table:table-cell>/g)]
          .map(m => m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())

        expect(rotulos).toEqual([
          'OMDS', 'Demandante', 'OM Destino', 'Previsto no PIT', 'Meta', 'Produto',
          'MI', 'Escala', 'Qnt Prevista', 'Mat Previsto', 'Qnt Fornecida',
          'Material Fornecido', 'Data da Entrega', 'Forma da Entrega', 'Observações'
        ])
        // O pedido do cenário tem prazo; ele NÃO pode aparecer sob "Meta".
        expect(content).not.toContain('office:date-value="2026-04-10"')
      })

      it('exige perfil na mapoteca', async () => {
        const res = await request(app)
          .get('/api/mapoteca/relatorio/impressao_detalhada_ods?ano=2026')
        expect(res.status).toBe(401)
      })
    })

    // O RTM (a mesma aba META4_DETALHADA) e ACUMULADO ATE O MES: escolher marco
    // traz janeiro, fevereiro e marco. O `mes` tem de CHEGAR a consulta;
    // ignorado, a tela do RPCMTec devolve sempre o mesmo arquivo do ano inteiro
    // e nada diz isso.
    //
    // O teste bate no CONTROLLER, e nao no .ods: a regra e o recorte, e o
    // formato do arquivo tem teste proprio em unit/rtm_ods.test.js. Contar
    // linhas dentro do ZIP aqui provaria a mesma coisa por um caminho mais caro
    // e mais fragil.
    describe('o RTM acumula do inicio do ano ate o mes', () => {
      const pedidoEm = async (dataPedido) => {
        const produto = await createProduto({
          tipo_produto_id: 2, tipo_escala_id: 2, mi: `MI-${dataPedido.slice(5, 7)}`
        })
        const versao = await createVersao(produto.id)
        const clienteId = await criaCliente({ nome: `OM ${dataPedido}`, tipo_cliente_id: 1 })
        // A data de atendimento acompanha a do pedido: o helper a fixa em marco,
        // e atender ANTES de pedir e recusado pelo servidor.
        const pedido = await criaPedido(clienteId, {
          data_pedido: dataPedido,
          data_atendimento: dataPedido
        })
        await criaProdutoPedido({
          uuid_versao: versao.uuid_versao,
          pedido_id: pedido.id,
          quantidade: 1,
          tipo_midia_id: 5,
          producao_especifica: false
        })
        return pedido
      }

      it('mes = 3 traz janeiro a marco, e deixa junho de fora', async () => {
        await pedidoEm('2026-01-15T10:00:00Z')
        await pedidoEm('2026-03-10T10:00:00Z')
        await pedidoEm('2026-06-20T10:00:00Z')

        const ate3 = await relatorioCtrl.getRelatorioPedidosDetalhado(2026, 3)
        expect(ate3).toHaveLength(2)

        const ate6 = await relatorioCtrl.getRelatorioPedidosDetalhado(2026, 6)
        expect(ate6).toHaveLength(3)

        // O limite superior e INCLUSIVE: o proprio mes 3 entra.
        const ate2 = await relatorioCtrl.getRelatorioPedidosDetalhado(2026, 2)
        expect(ate2).toHaveLength(1)
      })

      it('dezembro traz o ano inteiro, e nao vaza para o ano seguinte', async () => {
        await pedidoEm('2026-12-31T10:00:00Z')
        await pedidoEm('2027-01-02T10:00:00Z')

        const ate12 = await relatorioCtrl.getRelatorioPedidosDetalhado(2026, 12)
        expect(ate12).toHaveLength(1)
      })

      // O caminho de `GET /api/mapoteca/relatorio/impressao_detalhada_ods`, que
      // continua ANUAL: sem `mes` nada muda, e e o que mantem aquela rota
      // gemea da de rpcmtec quando as duas pedem o ano inteiro.
      it('sem mes, continua o ano inteiro', async () => {
        await pedidoEm('2026-01-15T10:00:00Z')
        await pedidoEm('2026-11-20T10:00:00Z')

        const anual = await relatorioCtrl.getRelatorioPedidosDetalhado(2026)
        expect(anual).toHaveLength(2)
      })
    })

    it('GET /relatorio/pedidos_resumo should summarize one row per order with type/scale pivot', async () => {
      const { pedido } = await setupPedidoMilitar()

      const res = await request(app)
        .get('/api/mapoteca/relatorio/pedidos_resumo?ano=2026')
        .set('Authorization', generateUserToken())

      expect(res.status).toBe(200)
      expect(res.body.dados).toHaveLength(1)
      const linha = res.body.dados[0]
      expect(Number(linha.numero_pedido)).toBe(Number(pedido.id))
      expect(linha.unidade).toBe('3º RCC')
      expect(linha.topo_50k).toBe(10)
      expect(linha.total_topo).toBe(10)
      expect(linha.total_orto).toBe(0)
      expect(linha.total).toBe(10)
    })

    it('GET /relatorio/pedidos_resumo should include civilian orders too', async () => {
      const clienteLai = await criaCliente({ nome: 'Solicitante LAI', tipo_cliente_id: 9 })
      await criaPedido(clienteLai, {
        documento_solicitacao_nup: '60143.000014/2026-78',
        observacao: 'Fotos aéreas do município de Caçapava'
      })

      const res = await request(app)
        .get('/api/mapoteca/relatorio/pedidos_resumo?ano=2026')
        .set('Authorization', generateUserToken())

      expect(res.status).toBe(200)
      expect(res.body.dados.map(l => l.unidade)).toContain('Solicitante LAI')
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

    // itens_sem_pdf mistura duas coisas que o operador trata de formas opostas.
    // Sem `item_avulso`, o plugin anuncia as duas com a mesma frase e manda
    // procurar um arquivo que nunca vai existir.
    it('itens_sem_pdf separa o AVULSO do item do acervo sem PDF', async () => {
      const produto = await createProduto({ tipo_produto_id: 2, tipo_escala_id: 2, mi: '2965-3' })
      const versao = await createVersao(produto.id) // do acervo, mas sem PDF
      const clienteId = await criaCliente()
      const pedido = await criaPedido(clienteId)
      await criaProdutoPedido({
        uuid_versao: versao.uuid_versao,
        pedido_id: pedido.id, quantidade: 4, tipo_midia_id: 5
      })
      await criaProdutoPedido({
        nome_avulso: 'Papel quadriculado',
        descricao_avulso: '80 x 68 cm',
        pedido_id: pedido.id, quantidade: 100, tipo_midia_id: 6
      })

      const res = await request(app)
        .post(`/api/mapoteca/pedido/${pedido.id}/download_impressao`)
        .set('Authorization', generateUserToken())

      expect(res.status).toBe(200)
      expect(res.body.dados.arquivos).toHaveLength(0)
      const semPdf = res.body.dados.itens_sem_pdf
      expect(semPdf).toHaveLength(2)

      const avulso = semPdf.find(i => i.item_avulso)
      const doAcervo = semPdf.find(i => !i.item_avulso)
      expect(avulso.produto_nome).toBe('Papel quadriculado')
      expect(avulso.avulso_descricao).toBe('80 x 68 cm')
      expect(doAcervo.mi).toBe('2965-3')
      expect(doAcervo.avulso_descricao).toBeNull()
    })

    it('POST /pedido/:id/download_impressao should return 404 for missing pedido', async () => {
      const res = await request(app)
        .post('/api/mapoteca/pedido/99999/download_impressao')
        .set('Authorization', generateUserToken())

      expect(res.status).toBe(404)
    })

    // O par prepare/confirm do plugin fechava em POST /acervo/confirm-download,
    // que e verifyPerfil('consulta') SEM modulo, ou seja, consulta no ACERVO. O
    // test_user da semente tem perfil nos DOIS modulos, e por isso o 403 nunca
    // aparecia em teste: quem imprime de verdade costuma ter operador so na
    // mapoteca. Este usuario e o caso real.
    const criaOperadorSoDaMapoteca = async () => {
      const uuid = 'c2eebc99-9c0b-4ef8-bb6d-6bb9bd380a33'
      const row = await conn.one(
        `INSERT INTO dgeo.usuario (login, nome, nome_guerra, tipo_posto_grad_id, administrador, ativo, uuid)
         VALUES ('op_mapoteca', 'Operador Mapoteca', 'Mapoteca', 1, FALSE, TRUE, $1)
         RETURNING id`,
        [uuid]
      )
      await conn.none(
        'INSERT INTO dgeo.usuario_perfil (usuario_id, modulo_id, perfil_id) VALUES ($1, 2, 2)',
        [row.id]
      )
      return generateToken({ id: Number(row.id), uuid, administrador: false })
    }

    it('quem so tem perfil na mapoteca prepara, confirma e nao passa pela rota do acervo', async () => {
      const { pedido } = await setupPedidoComPdf()
      const token = await criaOperadorSoDaMapoteca()

      const prepare = await request(app)
        .post(`/api/mapoteca/pedido/${pedido.id}/download_impressao`)
        .set('Authorization', token)
      expect(prepare.status).toBe(200)
      const downloadToken = prepare.body.dados.arquivos[0].download_token

      // A rota do acervo recusa este usuario: e o 403 que o plugin levava no
      // fim de um download bem-sucedido, deixando o token pendente.
      const peloAcervo = await request(app)
        .post('/api/acervo/confirm-download')
        .set('Authorization', token)
        .send({ confirmations: [{ download_token: downloadToken, success: true }] })
      expect(peloAcervo.status).toBe(403)

      const res = await request(app)
        .post('/api/mapoteca/impressao/confirmar_download')
        .set('Authorization', token)
        .send({ confirmations: [{ download_token: downloadToken, success: true }] })

      expect(res.status).toBe(200)
      expect(res.body.dados[0].status).toBe('completed')

      const download = await conn.one(
        'SELECT status FROM acervo.download WHERE download_token = $1',
        [downloadToken]
      )
      expect(download.status).toBe('completed')
    })

    it('POST /impressao/confirmar_download registra a falha declarada pelo plugin', async () => {
      const { pedido } = await setupPedidoComPdf()

      const prepare = await request(app)
        .post(`/api/mapoteca/pedido/${pedido.id}/download_impressao`)
        .set('Authorization', generateUserToken())
      const downloadToken = prepare.body.dados.arquivos[0].download_token

      const res = await request(app)
        .post('/api/mapoteca/impressao/confirmar_download')
        .set('Authorization', generateUserToken())
        .send({
          confirmations: [{
            download_token: downloadToken,
            success: false,
            error_message: 'Falha na verificação de integridade (checksum não corresponde)'
          }]
        })

      expect(res.status).toBe(200)
      const download = await conn.one(
        'SELECT status, error_message FROM acervo.download WHERE download_token = $1',
        [downloadToken]
      )
      expect(download.status).toBe('failed')
      expect(download.error_message).toContain('checksum')
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
    // Payload do mapa das entregas.
    //
    // O envelope de resposta põe TUDO em `dados`, e o payload deste endpoint
    // também tem um `dados` (as feições). Ou seja, `res.body.dados` parece o
    // array de feições e é o objeto inteiro; as feições estão um nível abaixo.
    // Errar isso fez os sete testes deste bloco falharem de uma vez.
    const mapaDe = (res) => res.body.dados

    const setupEntrega = async () => {
      const produto = await createProduto({ tipo_produto_id: 2, tipo_escala_id: 2 })
      const versao = await createVersao(produto.id)
      const clienteId = await criaCliente()
      // O dashboard conta a entrega pela `data_atendimento` do PEDIDO. O helper
      // criaPedido já a põe.
      const pedido = await criaPedido(clienteId, { operacao: 'Operação Dash' })
      await criaProdutoPedido({
        uuid_versao: versao.uuid_versao,
        pedido_id: pedido.id,
        quantidade: 7,
        tipo_midia_id: 5
      })
    }

    // O ano de contexto vale para as metricas de PEDIDO, contadas pela DATA DO
    // PEDIDO. E um recorte diferente do resumo anual e do mapa, que contam por
    // data de ENTREGA.
    describe('o ano de contexto vale para as metricas de pedido', () => {
      const doisAnos = async () => {
        const clienteId = await criaCliente({ nome: 'OM Ano', tipo_cliente_id: 1 })
        await criaPedido(clienteId, {
          data_pedido: '2025-11-10', data_atendimento: '2025-11-20', situacao_pedido_id: 5
        })
        await criaPedido(clienteId, {
          data_pedido: '2026-03-10', data_atendimento: '2026-03-20', situacao_pedido_id: 5
        })
        await criaPedido(clienteId, {
          data_pedido: '2026-04-10', data_atendimento: '2026-04-20', situacao_pedido_id: 5
        })
      }

      it('GET /dashboard/order_status conta so os pedidos do ano', async () => {
        await doisAnos()

        const r2026 = await request(app)
          .get('/api/mapoteca/dashboard/order_status?ano=2026')
          .set('Authorization', generateUserToken())
        const r2025 = await request(app)
          .get('/api/mapoteca/dashboard/order_status?ano=2025')
          .set('Authorization', generateUserToken())

        expect(r2026.status).toBe(200)
        expect(r2026.body.dados.total).toBe(2)
        expect(r2025.body.dados.total).toBe(1)
      })

      // Todo mes DECORRIDO, mesmo vazio: sem o mes vazio, um ano com movimento
      // em marco e outubro desenharia uma reta entre os dois, sugerindo
      // movimento que nao houve. E a soma tem de fechar com o cartao, senao o
      // grafico e o numero acima dele contam populacoes diferentes.
      //
      // O mes que AINDA NAO CHEGOU fica de fora, e e diferente do mes vazio: o
      // vazio afirma que nao houve movimento, e o futuro nao afirma nada. Com os
      // doze fixos, a curva do ano corrente despencava a zero de setembro a
      // dezembro, e a queda lia-se como colapso da producao.
      it('GET /dashboard/orders_timeline devolve os meses decorridos do ano, e fecha com o cartao', async () => {
        await doisAnos()

        const res = await request(app)
          .get('/api/mapoteca/dashboard/orders_timeline?ano=2026')
          .set('Authorization', generateUserToken())

        expect(res.status).toBe(200)
        expect(res.body.dados).toHaveLength(mesesEsperados(2026))
        const soma = res.body.dados.reduce((a, m) => a + Number(m.total_pedidos), 0)
        expect(soma).toBe(2)
        // Marco e abril, um cada.
        expect(Number(res.body.dados[2].total_pedidos)).toBe(1)
        expect(Number(res.body.dados[3].total_pedidos)).toBe(1)
      })

      // A regra do corte, provada nos tres casos. O teste acima passaria com o
      // corte OU sem ele enquanto o ano da fixture tiver movimento so em meses
      // passados: e preciso um teste que reprove o codigo antigo.
      it('a serie mensal para no mes corrente, e o ano futuro nao devolve mes nenhum', async () => {
        await doisAnos()
        const hoje = new Date()
        const anoCorrente = hoje.getFullYear()

        const corrente = await request(app)
          .get(`/api/mapoteca/dashboard/orders_timeline?ano=${anoCorrente}`)
          .set('Authorization', generateUserToken())
        expect(corrente.status).toBe(200)
        // O ultimo mes da serie e o mes de HOJE, e nao dezembro.
        expect(corrente.body.dados).toHaveLength(hoje.getMonth() + 1)
        const ultimo = corrente.body.dados[corrente.body.dados.length - 1]
        expect(new Date(ultimo.mes).getUTCMonth()).toBe(hoje.getMonth())

        // Ano que ainda nao comecou nao tem mes decorrido nenhum. Devolver doze
        // zeros diria "nao houve movimento em 2027", que e afirmacao sobre o
        // futuro.
        const futuro = await request(app)
          .get(`/api/mapoteca/dashboard/orders_timeline?ano=${anoCorrente + 1}`)
          .set('Authorization', generateUserToken())
        expect(futuro.status).toBe(200)
        expect(futuro.body.dados).toHaveLength(0)

        // Ano passado segue com os doze, porque todos decorreram.
        const passado = await request(app)
          .get(`/api/mapoteca/dashboard/orders_timeline?ano=${anoCorrente - 1}`)
          .set('Authorization', generateUserToken())
        expect(passado.status).toBe(200)
        expect(passado.body.dados).toHaveLength(12)
      })

      it('GET /dashboard/client_activity conta so os pedidos do ano', async () => {
        await doisAnos()

        const res = await request(app)
          .get('/api/mapoteca/dashboard/client_activity?limite=10&ano=2026')
          .set('Authorization', generateUserToken())

        expect(res.status).toBe(200)
        expect(Number(res.body.dados[0].total_pedidos)).toBe(2)
      })

      // Estoque e o saldo de HOJE, nao um acumulado de periodo: mandar ano para
      // ele sugeriria que existe "estoque de 2025".
      it('GET /dashboard/stock_by_location IGNORA o parametro ano', async () => {
        const pedir = (query) => request(app)
          .get(`/api/mapoteca/dashboard/stock_by_location${query}`)
          .set('Authorization', generateUserToken())

        const semAno = await pedir('')
        const comAno = await pedir('?ano=2025')

        // O `schema_validation` descarta chave desconhecida, entao a rota
        // responde 200 nos dois casos. O que se prova e que a RESPOSTA e a
        // mesma: so ela separa "ignorou o ano" de "filtrou por ele".
        expect(semAno.status).toBe(200)
        expect(comAno.status).toBe(200)
        expect(comAno.body.dados).toEqual(semAno.body.dados)
      })
    })

    // O dashboard de pedido e a visao de PRODUCAO (OM); o civil tem o relatorio
    // Civ proprio. As tres linhas do cartao de tempo medio (geral, por tipo de
    // cliente e mensal) contam a MESMA populacao, senao o painel se contradiz
    // na propria tela.
    it('GET /dashboard/avg_fulfillment_time conta so militar nas tres linhas', async () => {
      const militarId = await criaCliente({ nome: 'OM Militar Dash', tipo_cliente_id: 1 })
      const civilId = await criaCliente({ nome: 'Prefeitura Dash', tipo_cliente_id: 6 })

      // Militar leva 10 dias; civil leva 100. Se o civil vazar, a media muda.
      await criaPedido(militarId, {
        situacao_pedido_id: 5, data_pedido: '2026-03-01', data_atendimento: '2026-03-11'
      })
      await criaPedido(civilId, {
        situacao_pedido_id: 5, data_pedido: '2026-03-01', data_atendimento: '2026-06-09'
      })

      const res = await request(app)
        .get('/api/mapoteca/dashboard/avg_fulfillment_time')
        .set('Authorization', generateAdminToken())

      expect(res.status).toBe(200)
      const tipos = res.body.dados.por_tipo_cliente.map(t => t.tipo_cliente_id)
      expect(tipos).not.toContain(6)          // nenhum civil na quebra por tipo
      expect(tipos.every(id => [1, 2, 3].includes(id))).toBe(true)
    })

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
      // O CUSTO DE MANUTENCAO SAIU DAQUI em 2026-08-13, e o teste guarda a
      // saida em vez de so deixar de olhar. Ele somava
      // `mapoteca.manutencao_plotter`, e o plotter passou a ser bem do modulo
      // Equipamento: o mesmo cartao vive no painel de la, lendo
      // `equipamento.manutencao`. Duas telas respondiam a mesma pergunta, e a
      // desta lia uma tabela vazia. Campo que volta a aparecer aqui e a
      // duplicacao renascendo.
      expect(res.body.dados.custo_manutencao_total).toBeUndefined()
      expect(res.body.dados.manutencoes_count).toBeUndefined()
    })

    it('GET /dashboard/entregas_por_mes devolve os meses decorridos do ano', async () => {
      await setupEntrega()

      const res = await request(app)
        .get('/api/mapoteca/dashboard/entregas_por_mes?ano=2026')
        .set('Authorization', generateUserToken())

      expect(res.status).toBe(200)
      // Os DECORRIDOS, e nao doze fixos: esta serie usa o mesmo MESES_DO_ANO
      // das outras. Ver o helper no topo do arquivo.
      expect(res.body.dados).toHaveLength(mesesEsperados(2026))
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

    // O mapa das entregas tem de mostrar a MESMA população do cartão "Produtos
    // entregues" do resumo anual, só que agregada por produto. Se os dois
    // números divergirem na tela, o mapa deixa de valer como leitura do painel.
    it('GET /dashboard/entregas_geo devolve geometria e fecha com o resumo anual', async () => {
      await setupEntrega()

      const geo = await request(app)
        .get('/api/mapoteca/dashboard/entregas_geo?ano=2026')
        .set('Authorization', generateUserToken())
      const resumo = await request(app)
        .get('/api/mapoteca/dashboard/resumo_anual?ano=2026')
        .set('Authorization', generateUserToken())

      expect(geo.status).toBe(200)
      const payload = mapaDe(geo)
      expect(payload.dados).toHaveLength(1)
      expect(payload.dados[0].total_produtos).toBe(7)
      expect(payload.dados[0].total_pedidos).toBe(1)
      expect(payload.dados[0].total_clientes).toBe(1)
      expect(payload.dados[0].geom.type).toBe('Polygon')
      // Ponto de rótulo próprio: rotulando o polígono, a folha que cruza a
      // borda de um ladrilho do MapLibre ganha um rótulo de cada lado, e a
      // mesma carta aparece duas vezes no mapa.
      expect(payload.dados[0].ponto.type).toBe('Point')
      expect(payload.dados[0].area).toBeGreaterThan(0)
      // Sem o membro `crs`, que a RFC 7946 removeu e o MapLibre ignora: eram
      // 65 bytes por geometria, quase um terço do corpo da resposta.
      expect(payload.dados[0].geom.crs).toBeUndefined()
      // O id sai NÚMERO: o mapa usa o id como identificador de feição, e '1'
      // nunca casaria com 1 na hora de realçar.
      expect(typeof payload.dados[0].id).toBe('number')
      expect(payload.total_produtos).toBe(resumo.body.dados.total_entregas)
      expect(payload.sem_geometria).toBe(0)
    })

    it('GET /dashboard/entregas_geo filtra por tipo de produto, escala e cliente', async () => {
      await setupEntrega()

      const casa = await request(app)
        .get('/api/mapoteca/dashboard/entregas_geo?ano=2026&tipo_produto_id=2&escala=1%3A50.000')
        .set('Authorization', generateUserToken())

      expect(casa.status).toBe(200)
      expect(mapaDe(casa).dados).toHaveLength(1)
      expect(mapaDe(casa).filtrado).toBe(true)
      expect(mapaDe(casa).total_produtos).toBe(7)
      // O total do ano IGNORA os filtros: é ele que dá a noção de tamanho do
      // recorte ("7 de 7"). Sem ele, filtrar deixaria o número sem referência.
      expect(mapaDe(casa).total_ano).toBe(7)

      // Escala que não é a do produto: o recorte esvazia, mas o total do ano fica.
      const naoCasa = await request(app)
        .get('/api/mapoteca/dashboard/entregas_geo?ano=2026&escala=1%3A25.000')
        .set('Authorization', generateUserToken())

      expect(naoCasa.status).toBe(200)
      expect(mapaDe(naoCasa).dados).toEqual([])
      expect(mapaDe(naoCasa).total_produtos).toBe(0)
      expect(mapaDe(naoCasa).total_ano).toBe(7)
    })

    it('GET /dashboard/entregas_geo filtra por cliente', async () => {
      await setupEntrega()
      const outroId = await criaCliente({ nome: 'OM Sem Entrega' })

      const semNada = await request(app)
        .get(`/api/mapoteca/dashboard/entregas_geo?ano=2026&cliente_id=${outroId}`)
        .set('Authorization', generateUserToken())

      expect(semNada.status).toBe(200)
      expect(mapaDe(semNada).dados).toEqual([])
    })

    // As escalas PARTICIONAM as entregas do ano: cada produto tem uma só. Se a
    // soma dos recortes não fechar com o total, algum filtro está perdendo ou
    // duplicando linha.
    it('GET /dashboard/entregas_geo: a soma por escala fecha com o total do ano', async () => {
      await setupEntrega()

      const filtros = await request(app)
        .get('/api/mapoteca/dashboard/entregas_filtros?ano=2026')
        .set('Authorization', generateUserToken())

      expect(filtros.status).toBe(200)
      expect(filtros.body.dados.escalas.length).toBeGreaterThan(0)

      let soma = 0
      for (const e of filtros.body.dados.escalas) {
        const res = await request(app)
          .get(`/api/mapoteca/dashboard/entregas_geo?ano=2026&escala=${encodeURIComponent(e.escala)}`)
          .set('Authorization', generateUserToken())
        soma += mapaDe(res).total_produtos
      }

      const total = await request(app)
        .get('/api/mapoteca/dashboard/entregas_geo?ano=2026')
        .set('Authorization', generateUserToken())

      expect(soma).toBe(mapaDe(total).total_ano)
    })

    // Só o que TEM entrega no ano entra nas listas: oferecer os tipos inteiros do
    // domínio faria a pessoa procurar num menu onde quase tudo devolve tela vazia.
    it('GET /dashboard/entregas_filtros lista so o que tem entrega no ano', async () => {
      await setupEntrega()
      await criaCliente({ nome: 'OM Sem Entrega' })

      const res = await request(app)
        .get('/api/mapoteca/dashboard/entregas_filtros?ano=2026')
        .set('Authorization', generateUserToken())

      expect(res.status).toBe(200)
      expect(res.body.dados.tipos_produto).toHaveLength(1)
      expect(res.body.dados.tipos_produto[0].nome).toBe('Carta Topográfica')
      expect(res.body.dados.escalas).toEqual([{ escala: '1:50.000', produtos: 1 }])
      expect(res.body.dados.clientes).toHaveLength(1)
      expect(res.body.dados.clientes[0].nome).toBe('OM Teste')
      expect(typeof res.body.dados.clientes[0].id).toBe('number')
    })

    // Um filtro filtra o QUANTITATIVO do outro, mas nunca o próprio: a lista de
    // OMs aplica tipo e escala e ignora a OM escolhida, senão ela ficaria com
    // uma opção só e trocar de OM exigiria limpar o filtro antes.
    it('GET /dashboard/entregas_filtros cruza os quantitativos entre os filtros', async () => {
      // Duas entregas bem diferentes: topográfica 1:50.000 para uma OM,
      // ortoimagem 1:25.000 para outra.
      const topo = await createProduto({ tipo_produto_id: 2, tipo_escala_id: 2, mi: 'MI-TOPO' })
      const orto = await createProduto({ tipo_produto_id: 3, tipo_escala_id: 1, mi: 'MI-ORTO' })
      const versaoTopo = await createVersao(topo.id)
      const versaoOrto = await createVersao(orto.id)
      const omTopo = await criaCliente({ nome: 'OM da Topo' })
      const omOrto = await criaCliente({ nome: 'OM da Orto' })
      const pedidoTopo = await criaPedido(omTopo)
      const pedidoOrto = await criaPedido(omOrto)
      await criaProdutoPedido({
        uuid_versao: versaoTopo.uuid_versao, pedido_id: pedidoTopo.id,
        quantidade: 3, tipo_midia_id: 5
      })
      await criaProdutoPedido({
        uuid_versao: versaoOrto.uuid_versao, pedido_id: pedidoOrto.id,
        quantidade: 4, tipo_midia_id: 5
      })

      const semFiltro = await request(app)
        .get('/api/mapoteca/dashboard/entregas_filtros?ano=2026')
        .set('Authorization', generateUserToken())
      expect(semFiltro.body.dados.escalas).toHaveLength(2)
      expect(semFiltro.body.dados.clientes).toHaveLength(2)

      // Filtrando pela OM da topográfica, as OUTRAS listas encolhem...
      const porOm = await request(app)
        .get(`/api/mapoteca/dashboard/entregas_filtros?ano=2026&cliente_id=${omTopo}`)
        .set('Authorization', generateUserToken())
      expect(porOm.body.dados.escalas).toEqual([{ escala: '1:50.000', produtos: 1 }])
      expect(porOm.body.dados.tipos_produto.map(t => t.nome)).toEqual(['Carta Topográfica'])
      // ...e a lista do PRÓPRIO filtro continua inteira.
      expect(porOm.body.dados.clientes).toHaveLength(2)

      // O mesmo no outro sentido: pela escala, sobra só a OM daquela escala.
      const porEscala = await request(app)
        .get('/api/mapoteca/dashboard/entregas_filtros?ano=2026&escala=1%3A25.000')
        .set('Authorization', generateUserToken())
      expect(porEscala.body.dados.clientes.map(c => c.nome)).toEqual(['OM da Orto'])
      expect(porEscala.body.dados.escalas).toHaveLength(2)
    })

    // Da MAIOR para a menor. O mapeamento é aninhado por escala, e a tela usa
    // essa ordem para pôr a folha pequena por cima da grande.
    it('GET /dashboard/entregas_geo ordena da maior area para a menor', async () => {
      const grande = await createProduto({
        tipo_produto_id: 2,
        tipo_escala_id: 3,
        mi: 'MI-GRANDE',
        geom: 'SRID=4674;POLYGON((-50 -15, -49 -15, -49 -14, -50 -14, -50 -15))'
      })
      const pequena = await createProduto({
        tipo_produto_id: 2,
        tipo_escala_id: 1,
        mi: 'MI-PEQUENA',
        geom: 'SRID=4674;POLYGON((-49.9 -14.9, -49.8 -14.9, -49.8 -14.8, -49.9 -14.8, -49.9 -14.9))'
      })
      const clienteId = await criaCliente()
      const pedido = await criaPedido(clienteId)
      for (const produto of [grande, pequena]) {
        const versao = await createVersao(produto.id)
        await criaProdutoPedido({
          uuid_versao: versao.uuid_versao, pedido_id: pedido.id,
          quantidade: 1, tipo_midia_id: 5
        })
      }

      const res = await request(app)
        .get('/api/mapoteca/dashboard/entregas_geo?ano=2026')
        .set('Authorization', generateUserToken())

      expect(mapaDe(res).dados.map(d => d.mi)).toEqual(['MI-GRANDE', 'MI-PEQUENA'])
      expect(mapaDe(res).dados[0].area).toBeGreaterThan(mapaDe(res).dados[1].area)
    })

    // A contagem ao lado da opção tem de ser exatamente o que o mapa desenha ao
    // escolhê-la. Se divergir, o menu promete um recorte e entrega outro.
    it('GET /dashboard/entregas_filtros: a contagem da opcao e o que o mapa desenha', async () => {
      await setupEntrega()

      const filtros = await request(app)
        .get('/api/mapoteca/dashboard/entregas_filtros?ano=2026')
        .set('Authorization', generateUserToken())

      for (const e of filtros.body.dados.escalas) {
        const mapa = await request(app)
          .get(`/api/mapoteca/dashboard/entregas_geo?ano=2026&escala=${encodeURIComponent(e.escala)}`)
          .set('Authorization', generateUserToken())
        expect(mapaDe(mapa).dados).toHaveLength(e.produtos)
      }
    })

    it('GET /dashboard/entregas_filtros em ano sem entrega devolve listas vazias', async () => {
      await setupEntrega()

      const res = await request(app)
        .get('/api/mapoteca/dashboard/entregas_filtros?ano=2019')
        .set('Authorization', generateUserToken())

      expect(res.status).toBe(200)
      expect(res.body.dados.tipos_produto).toEqual([])
      expect(res.body.dados.escalas).toEqual([])
      expect(res.body.dados.clientes).toEqual([])
    })

    it('GET /dashboard/entregas_geo em ano sem entrega devolve lista vazia', async () => {
      await setupEntrega()

      const res = await request(app)
        .get('/api/mapoteca/dashboard/entregas_geo?ano=2019')
        .set('Authorization', generateUserToken())

      expect(res.status).toBe(200)
      expect(mapaDe(res).dados).toEqual([])
      expect(mapaDe(res).total_produtos).toBe(0)
    })

    // O ano do pedido e o ano da entrega nem sempre coincidem: pedido de
    // dezembro entregue em janeiro tem de aparecer nos dois, senão um dos dois
    // some do seletor de ano da navbar.
    it('GET /dashboard/anos lista o ano do pedido E o ano da entrega', async () => {
      const produto = await createProduto({ tipo_produto_id: 2, tipo_escala_id: 2 })
      const versao = await createVersao(produto.id)
      const clienteId = await criaCliente()
      const pedido = await criaPedido(clienteId, {
        data_pedido: '2025-12-20T10:00:00Z',
        data_atendimento: '2026-01-15T10:00:00Z'
      })
      await criaProdutoPedido({
        uuid_versao: versao.uuid_versao,
        pedido_id: pedido.id,
        quantidade: 2,
        tipo_midia_id: 5
      })

      const res = await request(app)
        .get('/api/mapoteca/dashboard/anos')
        .set('Authorization', generateUserToken())

      expect(res.status).toBe(200)
      expect(res.body.dados).toEqual(expect.arrayContaining([2026, 2025]))
      // Do mais recente para o mais antigo, que e a ordem do seletor.
      expect(res.body.dados).toEqual([...res.body.dados].sort((a, b) => b - a))
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
