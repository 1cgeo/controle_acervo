'use strict'

// Teste de rota (supertest) da Meta do PIT. Mocka banco + autenticacao (admin).
// Cobre: listar (envelope), criar (sem validar exercicio), validacao Joi (400),
// e a regressao do 409 ao deletar com consumidor vinculado.
//
// A rota saiu de /api/orcamento/metas para /api/metas: virou
// PLATAFORMA. Ler pede so login; escrever pede administrador global.

const { createMockDb } = require('../helpers/orcamento/mockDb')

const mockDb = createMockDb()
jest.mock('../../database', () => ({
  db: mockDb,
  databaseVersion: { nome: '1.0.0', load: jest.fn() }
}))
jest.mock('../../login', () => require('../helpers/orcamento/mockLogin'))

const request = require('supertest')
const { buildTestApp } = require('../helpers/orcamento/testApp')
const { TEST_USER } = require('../helpers/orcamento/mockLogin')
const { pitRoute } = require('../../pit')

const app = buildTestApp([{ path: '/metas', router: pitRoute }])

beforeEach(() => mockDb.reset())

/**
 * O parametro do INSERT em auditoria.evento, ou falha dizendo que ele nao houve.
 *
 * Aqui o banco e mockado, entao o que se prova NAO e o SQL: e que a escrita
 * chamou o registro do rastro, dentro do `tx`, com o modulo, a entidade e o
 * autor que o MAPA resolve. A meta do PIT nao tem teste contra banco de verdade,
 * e sem isto a rota poderia deixar de auditar sem nada acusar.
 */
const eventosAuditados = () =>
  mockDb.conn.none.mock.calls
    .filter(([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO auditoria.evento'))
    .map(c => c[1])

// Uma escrita de meta gera DOIS eventos: a identidade (`pit.meta_item`) e o que
// a revisao declara (`pit.meta_item_revisao`). O `tabela` diz de qual deles se
// fala. O GRUPO (`pit.meta`) so gera evento quando ele mesmo e criado.
const eventoAuditado = (tabela = 'pit.meta_item') => {
  const chamadas = eventosAuditados().filter(e => e.tabela === tabela)
  expect(chamadas).toHaveLength(1)
  return chamadas[0]
}

// O exercicio VIGENTE e a revisao ABERTA, que toda escrita de meta consulta
// antes de gravar. Sem elas o controller recusa com 400, que e o comportamento
// desejado e tem teste proprio.
const comRevisaoAberta = () => {
  mockDb.conn.oneOrNone.mockResolvedValueOnce({ situacao_id: 2 })
  // O duble copia as colunas do SELECT real. `data_vigencia` nula e o que define
  // o RASCUNHO: sem ela o controller pediria o motivo da correcao.
  mockDb.conn.oneOrNone.mockResolvedValueOnce({
    id: 7, ano: 2026, codigo: 'R1', data_vigencia: null
  })
  // O GRUPO, que `resolverMeta` acha por (ano, numero_meta). Existindo, ele nao
  // e criado: o item so pendura nele.
  mockDb.conn.oneOrNone.mockResolvedValueOnce({ id: 40, ano: 2026, numero_meta: 1 })
}

// O corpo minimo de um cadastro de item. `unidade_id` entrou na lista porque a
// coluna virou NOT NULL em 1.30.0.
const corpoMeta = (extra = {}) => ({
  ano: 2026, numero_meta: 1, item: '1.1', descricao: 'Carta 1:25.000.',
  unidade_id: 1, ...extra
})

// A META que o DELETE le, mais o exercicio VIGENTE. As declaracoes saem do
// `t.any`, que no duble responde lista vazia por padrao: meta sem declaracao
// nenhuma passa as duas metades da regra de apagar.
const metaApagavel = (meta = { id: 1, meta_id: 40, item: '7.1' }) => {
  mockDb.conn.oneOrNone.mockResolvedValueOnce(meta)
  // O ANO vem do GRUPO: `pit.meta_item` nao o guarda.
  mockDb.conn.oneOrNone.mockResolvedValueOnce({ ano: 2026 })
  mockDb.conn.oneOrNone.mockResolvedValueOnce({ situacao_id: 2 })
}

describe('GET /metas', () => {
  test('devolve o envelope padrao com os dados', async () => {
    mockDb.conn.any.mockResolvedValueOnce([{ id: 1, ano: 2026 }])
    const res = await request(app).get('/metas')
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ version: expect.any(String), success: true })
    expect(res.body.dados).toHaveLength(1)
  })

  test('aceita filtro ?ano=', async () => {
    mockDb.conn.any.mockResolvedValueOnce([{ id: 1 }])
    const res = await request(app).get('/metas?ano=2026')
    expect(res.status).toBe(200)
    expect(mockDb.conn.any).toHaveBeenCalledWith(
      expect.stringContaining('WHERE ano = $<ano>'),
      { ano: 2026 }
    )
  })
})

describe('POST /metas', () => {
  test('rejeita body sem ano com 400 (validacao Joi)', async () => {
    const res = await request(app).post('/metas').send({ numero_meta: 1 })
    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
  })

  test('rejeita body sem numero_meta com 400 (validacao Joi)', async () => {
    const res = await request(app).post('/metas').send({ ano: 2026 })
    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
  })

  test('rejeita body sem descricao com 400: ela e a frase que a revisao declara', async () => {
    const res = await request(app)
      .post('/metas')
      .send({ ano: 2026, numero_meta: 1, item: '1.1', unidade_id: 1 })
    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
  })

  // O ITEM E OBRIGATORIO desde 1.30.0: `pit.meta_item.item` e NOT NULL, e o item
  // nulo era a linha de CABECALHO, que virou `pit.meta.nome`.
  test('rejeita body sem item com 400', async () => {
    const res = await request(app)
      .post('/metas')
      .send({ ano: 2026, numero_meta: 1, descricao: 'Carta', unidade_id: 1 })
    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
  })

  // A UNIDADE TAMBEM. Sem esta recusa o corpo chegaria ao INSERT e o banco
  // devolveria 500 cru pelo NOT NULL.
  test('rejeita body sem unidade_id com 400', async () => {
    const res = await request(app)
      .post('/metas')
      .send({ ano: 2026, numero_meta: 1, item: '1.1', descricao: 'Carta' })
    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
  })

  test('cria meta e responde com sucesso', async () => {
    comRevisaoAberta()
    mockDb.conn.one.mockResolvedValueOnce({ id: 9 })
    mockDb.conn.one.mockResolvedValueOnce({ id: 3, meta_item_id: 9 })
    const res = await request(app).post('/metas').send(corpoMeta())
    expect([200, 201]).toContain(res.status)
    expect(res.body.success).toBe(true)
    expect(res.body.dados).toEqual({ id: 9 })
  })

  test('sem exercicio cadastrado, recusa com 400', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce(null)
    const res = await request(app)
      .post('/metas')
      .send(corpoMeta({ ano: 2031 }))
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/exerc/i)
  })

  // O guard que faz o historico ficar completo POR CONSTRUCAO: nao da para mudar
  // o que o PIT promete sem dizer qual documento autorizou.
  test('sem revisao aberta, recusa com 400 e diz o que fazer', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce({ situacao_id: 2 })
    mockDb.conn.oneOrNone.mockResolvedValueOnce(null)
    const res = await request(app)
      .post('/metas')
      .send(corpoMeta())
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/revis/i)
  })

  test('exercicio encerrado recusa com 400', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce({ situacao_id: 3 })
    const res = await request(app)
      .post('/metas')
      .send(corpoMeta({ ano: 2025 }))
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/encerrado/i)
  })

  // A coerencia entre a origem e a unidade: a origem Producao conta versao do
  // acervo, e uma versao e uma FOLHA.
  // A REVISAO E ESCOLHIDA POR QUEM CHAMA, e nao adivinhada. A tela sempre manda
  // `revisao_id`, porque ela sabe qual revisao esta aberta nela; o CLI omite e
  // cai no rascunho do ano.
  test('com revisao_id, a meta entra na revisao escolhida', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce({ situacao_id: 2 }) // exercicio
    mockDb.conn.oneOrNone.mockResolvedValueOnce({
      id: 12, ano: 2026, codigo: 'R2', data_vigencia: null
    })
    mockDb.conn.oneOrNone.mockResolvedValueOnce({ id: 40, ano: 2026, numero_meta: 1 })
    mockDb.conn.one.mockResolvedValueOnce({ id: 9, meta_id: 40, item: '1.1' })
    mockDb.conn.one.mockResolvedValueOnce({ id: 3, meta_item_id: 9, revisao_id: 12 })

    const res = await request(app)
      .post('/metas')
      .send(corpoMeta({ revisao_id: 12 }))

    expect(res.status).toBe(201)
    // CONTROLE NEGATIVO: sem esta passagem a declaracao cairia no rascunho que o
    // servidor achasse sozinho, e nao no 12 que veio no corpo.
    expect(mockDb.conn.one).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO pit.meta_item_revisao'),
      expect.objectContaining({ revisaoId: 12 })
    )
  })

  // ACRESCENTAR A META QUE A COPIA ESQUECEU, numa revisao ja PUBLICADA. O texto
  // assinado e o rei: se o R0 tem uma meta que nunca foi transcrita, ela entra
  // no R0, com motivo, e nao numa revisao inventada.
  test('meta nova em revisao PUBLICADA sem motivo recusa com 400', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce({ situacao_id: 2 })
    mockDb.conn.oneOrNone.mockResolvedValueOnce({
      id: 2, ano: 2026, codigo: 'R0', data_vigencia: '2026-01-15'
    })

    const res = await request(app)
      .post('/metas')
      .send(corpoMeta({ numero_meta: 6, item: '6.9', revisao_id: 2 }))

    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/motivo/i)
    expect(mockDb.conn.one).not.toHaveBeenCalled()
  })

  test('meta nova em revisao PUBLICADA com motivo grava', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce({ situacao_id: 2 })
    mockDb.conn.oneOrNone.mockResolvedValueOnce({
      id: 2, ano: 2026, codigo: 'R0', data_vigencia: '2026-01-15'
    })
    mockDb.conn.oneOrNone.mockResolvedValueOnce({ id: 46, ano: 2026, numero_meta: 6 })
    mockDb.conn.one.mockResolvedValueOnce({ id: 9, meta_id: 46, item: '6.9' })
    mockDb.conn.one.mockResolvedValueOnce({ id: 3, meta_item_id: 9, revisao_id: 2 })

    const res = await request(app)
      .post('/metas')
      .send(corpoMeta({
        numero_meta: 6,
        item: '6.9',
        revisao_id: 2,
        motivo: 'A 6.9 esta no R0 assinado e nao foi transcrita'
      }))

    expect(res.status).toBe(201)
    expect(eventoAuditado('pit.meta_item').motivo)
      .toBe('A 6.9 esta no R0 assinado e nao foi transcrita')
  })

  // A revisao de um ano so declara meta DAQUELE ano.
  test('revisao_id de outro ano recusa com 400', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce({ situacao_id: 2 })
    mockDb.conn.oneOrNone.mockResolvedValueOnce({
      id: 2, ano: 2025, codigo: 'R0', data_vigencia: null
    })

    const res = await request(app)
      .post('/metas')
      .send(corpoMeta({ revisao_id: 2 }))

    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/2025/)
    expect(mockDb.conn.one).not.toHaveBeenCalled()
  })

  test('origem Producao com unidade que nao e Folha recusa com 400', async () => {
    const res = await request(app)
      .post('/metas')
      .send(corpoMeta({ origem_id: 3, unidade_id: 2 }))
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/Folha/)
  })
})

// PUT /metas/:id: SO A IDENTIDADE.
//
// A declaracao saiu daqui. Ela entrava por esta rota e o servidor descobria
// sozinho em que revisao gravar, procurando o rascunho do ano: era a segunda
// porta para mudar o que a DSG promete, ao lado da revisao, e nenhuma tela
// conseguia explicar duas portas para o mesmo ato.
describe('PUT /metas/:id', () => {
  test('atualiza so a identidade, sem revisao nenhuma', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce({ id: 5, meta_id: 41, origem_id: 1, unidade_id: 1 })
    mockDb.conn.oneOrNone.mockResolvedValueOnce({ situacao_id: 2 })
    mockDb.conn.oneOrNone.mockResolvedValueOnce({ id: 41, numero_meta: 2 })
    mockDb.conn.one.mockResolvedValueOnce({ id: 5 })
    const res = await request(app)
      .put('/metas/5')
      .send({ ano: 2026, numero_meta: 2, item: '2.1', unidade_id: 1 })
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
  })

  // CONTROLE NEGATIVO do desenho novo: ate aqui este mesmo corpo respondia 200 e
  // gravava a quantidade nova na revisao aberta. Agora ele para na porta, e a
  // mensagem diz por onde ir.
  test('a quantidade nao entra pela meta: 400 que manda para a revisao', async () => {
    const res = await request(app)
      .put('/metas/5')
      .send({
        ano: 2026, numero_meta: 2, item: '2.1', quantidade_prevista: 20
      })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/revis/i)
    // Nada foi ao banco: a recusa e do Joi, antes do controller.
    expect(mockDb.conn.tx).not.toHaveBeenCalled()
  })

  test('a descricao tambem nao entra pela meta', async () => {
    const res = await request(app)
      .put('/metas/5')
      .send({ ano: 2026, numero_meta: 2, item: '2.1', descricao: 'Meta 2' })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/revis/i)
  })

  test('404 quando a meta nao existe', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce(null)
    const res = await request(app)
      .put('/metas/99')
      .send({ ano: 2026, numero_meta: 1, item: '1.1' })
    expect(res.status).toBe(404)
    expect(res.body.success).toBe(false)
  })
})

// A META DENTRO DE UMA REVISAO: a porta unica para mudar o que o PIT promete.
// Os dois ids vao no caminho, e a revisao PUBLICADA e recusada em vez de
// desviada para o rascunho.
describe('PUT /metas/revisoes/:revisaoId/meta/:metaId', () => {
  test('grava a declaracao no rascunho e responde 200', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce({
      id: 7, ano: 2026, codigo: 'R1', data_vigencia: null
    })
    mockDb.conn.oneOrNone.mockResolvedValueOnce({ id: 5, ano: 2026, numero_meta: 1 })
    mockDb.conn.oneOrNone.mockResolvedValueOnce({ situacao_id: 2 })
    mockDb.conn.one.mockResolvedValueOnce({ id: 3, meta_item_id: 5, revisao_id: 7 })

    const res = await request(app)
      .put('/metas/revisoes/7/meta/5')
      .send({ descricao: 'Carta Topografica 1:25.000', quantidade_prevista: 24 })

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(mockDb.conn.one).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO pit.meta_item_revisao'),
      expect.objectContaining({ metaId: 5, revisaoId: 7, quantidade_prevista: 24 })
    )
  })

  // A REVISAO PUBLICADA ACEITA A EDICAO, e o MOTIVO e o portao. O texto assinado
  // e o rei: editar o R0 publicado conserta a nossa COPIA dele, e nao o plano.
  test('a revisao PUBLICADA sem motivo recusa com 400, e nao grava nada', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce({
      id: 7, ano: 2026, codigo: 'R0', data_vigencia: '2026-01-15'
    })

    const res = await request(app)
      .put('/metas/revisoes/7/meta/5')
      .send({ descricao: 'Carta Topografica 1:25.000' })

    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/motivo/i)
    expect(mockDb.conn.one).not.toHaveBeenCalled()
  })

  // CONTROLE NEGATIVO do teste acima: com o motivo, a MESMA requisicao passa.
  // Ate aqui ela era recusada sempre, e esta asercao reprova aquele estado.
  test('a revisao PUBLICADA com motivo grava, e o rastro leva o motivo', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce({
      id: 7, ano: 2026, codigo: 'R0', data_vigencia: '2026-01-15'
    })
    mockDb.conn.oneOrNone.mockResolvedValueOnce({ id: 5, ano: 2026, numero_meta: 1 })
    mockDb.conn.oneOrNone.mockResolvedValueOnce({ situacao_id: 2 })
    mockDb.conn.oneOrNone.mockResolvedValueOnce({
      id: 3, meta_item_id: 5, revisao_id: 7, quantidade_prevista: 53
    })
    mockDb.conn.one.mockResolvedValueOnce({
      id: 3, meta_item_id: 5, revisao_id: 7, quantidade_prevista: 35
    })

    const res = await request(app)
      .put('/metas/revisoes/7/meta/5')
      .send({
        descricao: 'Carta Topografica 1:25.000',
        quantidade_prevista: 35,
        motivo: 'O R0 assinado diz 35, e a transcricao ficou 53'
      })

    expect(res.status).toBe(200)
    const evento = eventoAuditado('pit.meta_item_revisao')
    expect(evento.motivo).toBe('O R0 assinado diz 35, e a transcricao ficou 53')
    expect(evento.operacao).toBe('U')
    expect(JSON.parse(evento.dadosAntes).quantidade_prevista).toBe(53)
    expect(JSON.parse(evento.dadosDepois).quantidade_prevista).toBe(35)
  })

  // O MOTIVO CURTO nao vale: o minimo e o mesmo do Joi da correcao de
  // transcricao, e quem o cobra aqui e o proprio Joi da rota.
  test('motivo com menos de 5 caracteres reprova no Joi', async () => {
    const res = await request(app)
      .put('/metas/revisoes/7/meta/5')
      .send({ descricao: 'Carta', motivo: 'oi' })

    expect(res.status).toBe(400)
    expect(mockDb.conn.tx).not.toHaveBeenCalled()
  })

  test('sem descricao recusa com 400: a coluna e NOT NULL', async () => {
    const res = await request(app)
      .put('/metas/revisoes/7/meta/5')
      .send({ quantidade_prevista: 24 })

    expect(res.status).toBe(400)
    expect(mockDb.conn.tx).not.toHaveBeenCalled()
  })
})

describe('DELETE /metas/:id', () => {
  // O 409 por dependente tem prova em 'a exclusao barrada por dependente nao
  // registra nada': mesmos mocks, mesma requisicao, mesmo status, mais a
  // contagem de eventos.
  // O caminho feliz do DELETE tem prova em 'DELETE registra o que se perdeu',
  // com os mesmos mocks, a mesma requisicao e o mesmo status 200, mais o evento.
  test('404 quando a meta nao existe', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce(null)
    const res = await request(app).delete('/metas/99')
    expect(res.status).toBe(404)
    expect(res.body.success).toBe(false)
  })

  // APAGAR SO NA REVISAO QUE CRIOU. `?revisao_id=` diz de onde a tela esta
  // apagando, e o controller recusa quando nao e a criadora: la o que cabe e
  // CANCELAR a meta.
  test('apagar de uma revisao que nao criou a meta recusa com 400', async () => {
    metaApagavel()
    mockDb.conn.any.mockResolvedValueOnce([{ revisao_id: 7, codigo: 'R0' }])

    const res = await request(app).delete('/metas/1?revisao_id=9')

    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/R0/)
    expect(mockDb.conn.none).not.toHaveBeenCalled()
  })

  // CONTROLE NEGATIVO do teste acima: a MESMA meta, apagada da revisao que a
  // criou, sai. Sem esta prova o 400 acima passaria com uma guarda que barra
  // tudo.
  test('apagar da revisao criadora passa', async () => {
    metaApagavel()
    mockDb.conn.any.mockResolvedValueOnce([{ revisao_id: 7, codigo: 'R0' }])
    mockDb.conn.one.mockResolvedValueOnce({ n: 0 })

    const res = await request(app).delete('/metas/1?revisao_id=7')

    expect(res.status).toBe(200)
    expect(mockDb.conn.none).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM pit.meta_item'),
      { id: 1 }
    )
  })
})

// ---------------------------------------------------------------------------
// Rastreabilidade
//
// A meta do PIT e rota de PLATAFORMA e alimenta o RPCMTec: o PDR, a NC e o
// pedido de impressao apontam para ela, entao mudar uma meta muda o que os tres
// modulos contam. Ate aqui nenhuma das tres escritas deixava rastro, e a
// exclusao nem sequer recebia o usuario.
// ---------------------------------------------------------------------------

describe('Rastreabilidade da meta do PIT', () => {
  test('POST registra a criacao, com o autor do token', async () => {
    comRevisaoAberta()
    mockDb.conn.one.mockResolvedValueOnce({ id: 9, meta_id: 40, item: '1.1' })
    mockDb.conn.one.mockResolvedValueOnce({ id: 3, meta_item_id: 9, revisao_id: 7 })

    await request(app).post('/metas').send(corpoMeta())

    const evento = eventoAuditado()

    // `modulo`, `entidade` e `entidade_id` NAO sao passados pelo chamador: saem
    // do mapa. Passa-los a mao seria a lista digitada que envelhece.
    expect(evento.modulo).toBe('plataforma')
    expect(evento.entidade).toBe('meta')
    expect(evento.entidadeId).toBe('9')
    expect(evento.tabela).toBe('pit.meta_item')
    expect(evento.operacao).toBe('I')
    expect(evento.usuarioUuid).toBe(TEST_USER.uuid)
    expect(evento.dadosAntes).toBeNull()
  })

  test('PUT registra os dois lados, lidos do BANCO', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce({
      id: 5, meta_id: 42, item: '2.1', origem_id: 1, unidade_id: 1
    })
    mockDb.conn.oneOrNone.mockResolvedValueOnce({ situacao_id: 2 })
    mockDb.conn.oneOrNone.mockResolvedValueOnce({ id: 44, numero_meta: 4 })
    // O `RETURNING *` traz a linha inteira, e a origem vem junto: sem ela no
    // duble, o diff acusaria uma mudanca de origem que nao houve.
    mockDb.conn.one.mockResolvedValueOnce({
      id: 5, meta_id: 44, item: '2.1', origem_id: 1, unidade_id: 1
    })

    await request(app).put('/metas/5')
      .send({ ano: 2026, numero_meta: 4, item: '2.1' })

    const evento = eventoAuditado()

    expect(evento.operacao).toBe('U')
    // O `lerAntes` substituiu o `SELECT id` que existia so para o 404: sem ele o
    // rastro diria que o item mudou, sem dizer de que para que.
    //
    // O QUE MUDA E `meta_id`, e nao `numero_meta`: mover a 2.1 para a Meta 4 e
    // pendura-la noutro GRUPO. O numero da meta deixou de ser coluna do item.
    expect(JSON.parse(evento.dadosAntes).meta_id).toBe(42)
    expect(JSON.parse(evento.dadosDepois).meta_id).toBe(44)
    expect(evento.camposAlterados).toEqual(['meta_id'])
  })

  test('DELETE registra o que se perdeu', async () => {
    metaApagavel()
    mockDb.conn.one.mockResolvedValueOnce({ n: 0 })

    const res = await request(app).delete('/metas/1')
    expect(res.status).toBe(200)

    const evento = eventoAuditado()

    expect(evento.operacao).toBe('D')
    expect(evento.dadosDepois).toBeNull()
    expect(JSON.parse(evento.dadosAntes).item).toBe('7.1')
    // A exclusao carrega o AUTOR do token, e nao um autor nulo.
    expect(evento.usuarioUuid).toBe(TEST_USER.uuid)
  })

  test('a exclusao barrada por dependente nao registra nada', async () => {
    metaApagavel({ id: 1, meta_id: 40, item: '7.1' })
    mockDb.conn.one.mockResolvedValueOnce({ n: 1 })

    const res = await request(app).delete('/metas/1')
    expect(res.status).toBe(409)

    const chamadas = mockDb.conn.none.mock.calls.filter(
      ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO auditoria.evento')
    )
    expect(chamadas).toHaveLength(0)
  })
})
