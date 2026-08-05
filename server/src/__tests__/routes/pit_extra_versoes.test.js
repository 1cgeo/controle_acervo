'use strict'

// AS VERSÕES DO ACERVO QUE MATERIALIZAM A DEMANDA EXTRA-PIT.
//
// O vínculo mora em `acervo.versao.demanda_extra_id` (er/acervo.sql:148) e é
// EXCLUSIVO com `meta_pit_id`, pelo CHECK `versao_plano_ou_excecao`
// (er/acervo.sql:163): a folha cumpre o plano OU é a exceção autorizada, nunca
// as duas, e essa exclusão é o que impede a contagem dupla.
//
// O QUE ESTES CASOS FIXAM: o servidor RECUSA antes de o CHECK do banco recusar,
// com uma frase que diz onde desfazer o vínculo, e não grava nada nesse caso. O
// banco é mockado, então o que se prova aqui é o CAMINHO (rota, validação,
// guarda, parâmetro do UPDATE), e não o SQL.
//
// A autenticação é passthrough de administrador (mockLogin), então a diferença
// entre `verifyLogin` na leitura e `verifyAdmin` na escrita não se prova aqui.

const { createMockDb, eventosDeAuditoria } = require('../helpers/orcamento/mockDb')

const mockDb = createMockDb()
jest.mock('../../database', () => ({
  db: mockDb,
  databaseVersion: { nome: '1.0.0', load: jest.fn() }
}))
jest.mock('../../login', () => require('../helpers/orcamento/mockLogin'))

const request = require('supertest')
const { buildTestApp } = require('../helpers/orcamento/testApp')
const { pitRoute } = require('../../pit')

const app = buildTestApp([{ path: '/metas', router: pitRoute }])

beforeEach(() => mockDb.reset())

// A linha da versão como o `lerAntes` a devolve (SELECT * da tabela).
const versao = (extra = {}) => ({
  id: 101,
  produto_id: 55,
  versao: '1',
  nome: 'Edição 1',
  meta_pit_id: null,
  demanda_extra_id: null,
  ...extra
})

// A demanda existe (primeiro `oneOrNone` do controller), e depois a versão
// (o `oneOrNone` do `lerAntes`).
const cenario = (linhaVersao) => {
  mockDb.conn.oneOrNone.mockResolvedValueOnce({ id: 7 })
  mockDb.conn.oneOrNone.mockResolvedValueOnce(linhaVersao)
}

// Os UPDATEs em acervo.versao que chegaram ao banco. É o que separa "recusou" de
// "recusou depois de gravar".
const updatesDaVersao = () =>
  mockDb.conn.one.mock.calls
    .filter(([sql]) => typeof sql === 'string' && sql.includes('UPDATE acervo.versao'))

describe('GET /metas/extra/:id/versoes', () => {
  test('devolve o envelope e consulta pelo vínculo da demanda', async () => {
    mockDb.conn.any.mockResolvedValueOnce([{ id: 101, mi: '2966-1-NE' }])

    const res = await request(app).get('/metas/extra/7/versoes')

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ success: true })
    expect(res.body.dados).toHaveLength(1)
    expect(mockDb.conn.any).toHaveBeenCalledWith(
      expect.stringContaining('WHERE v.demanda_extra_id = $<id>'),
      { id: 7 }
    )
  })
})

describe('GET /metas/extra/:id/versoes/candidatas', () => {
  // A rota das candidatas vem ANTES da que tem `:versao_id`, e o caminho tem um
  // segmento a mais que '/extra/:id': sem a ordem, 'candidatas' cairia na rota
  // do id e reprovaria na validação.
  test('a busca vira ILIKE e não engole a rota do id', async () => {
    mockDb.conn.any.mockResolvedValueOnce([])

    const res = await request(app).get('/metas/extra/7/versoes/candidatas?termo=2966')

    expect(res.status).toBe(200)
    expect(mockDb.conn.any).toHaveBeenCalledWith(
      expect.stringContaining('ILIKE $<busca>'),
      { id: 7, busca: '%2966%' }
    )
  })

  // A folha que já cumpre meta NÃO sai da lista: some-a e a pessoa procuraria
  // para sempre uma versão que existe. Quem a exclui é só o vínculo com ESTA
  // demanda, que já está do outro lado da tela.
  test('sem termo, busca nula, e exclui só quem já é desta demanda', async () => {
    mockDb.conn.any.mockResolvedValueOnce([])

    const res = await request(app).get('/metas/extra/7/versoes/candidatas')

    expect(res.status).toBe(200)
    const [sql, params] = mockDb.conn.any.mock.calls[0]
    expect(params).toEqual({ id: 7, busca: null })
    expect(sql).toContain('v.demanda_extra_id IS NULL OR v.demanda_extra_id <> $<id>')
    expect(sql).not.toContain('meta_pit_id IS NULL')
  })
})

describe('POST /metas/extra/:id/versoes', () => {
  test('liga a versão livre e registra o rastro', async () => {
    cenario(versao())
    mockDb.conn.one.mockResolvedValueOnce(versao({ demanda_extra_id: 7 }))

    const res = await request(app)
      .post('/metas/extra/7/versoes')
      .send({ versao_id: 101 })

    expect(res.status).toBe(200)
    expect(updatesDaVersao()).toHaveLength(1)
    // `idParams` é `Joi.number()` NÃO estrito, então o id do caminho chega
    // convertido em número, e não como o texto da URL.
    expect(updatesDaVersao()[0][1]).toMatchObject({ id: 7, versaoId: 101 })

    const eventos = eventosDeAuditoria(mockDb).filter(e => e.tabela === 'acervo.versao')
    expect(eventos).toHaveLength(1)
  })

  // O CASO QUE O CHEFE PEDIU: a recusa é do servidor, com frase própria, antes
  // de o CHECK do banco responder "violates check constraint".
  //
  // CONTROLE NEGATIVO junto: nenhum UPDATE chegou ao banco. Sem esta asserção o
  // caso passaria numa implementação que grava e só depois reclama.
  test('recusa a versão que já cumpre meta do PIT, sem gravar', async () => {
    cenario(versao({ meta_pit_id: 55 }))

    const res = await request(app)
      .post('/metas/extra/7/versoes')
      .send({ versao_id: 101 })

    expect(res.status).toBe(400)
    expect(res.body.message).toContain('já cumpre uma meta do PIT')
    expect(updatesDaVersao()).toHaveLength(0)
  })

  test('recusa a versão que já materializa outra demanda, sem gravar', async () => {
    cenario(versao({ demanda_extra_id: 99 }))

    const res = await request(app)
      .post('/metas/extra/7/versoes')
      .send({ versao_id: 101 })

    expect(res.status).toBe(400)
    expect(res.body.message).toContain('outra demanda Extra-PIT')
    expect(updatesDaVersao()).toHaveLength(0)
  })

  // Dois cliques na mesma linha são acidente comum, e o segundo não é erro.
  test('ligar de novo o que já está ligado devolve OK sem gravar', async () => {
    cenario(versao({ demanda_extra_id: 7 }))

    const res = await request(app)
      .post('/metas/extra/7/versoes')
      .send({ versao_id: 101 })

    expect(res.status).toBe(200)
    expect(res.body.dados).toMatchObject({ jaEstava: true })
    expect(updatesDaVersao()).toHaveLength(0)
  })

  test('a demanda que não existe dá 404, e não erro de chave estrangeira', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce(null)

    const res = await request(app)
      .post('/metas/extra/7/versoes')
      .send({ versao_id: 101 })

    expect(res.status).toBe(404)
    expect(updatesDaVersao()).toHaveLength(0)
  })

  // Validação ESTRITA: o corpo não repete o id da demanda, que já vem no
  // caminho, e chave desconhecida vira 400 em vez de sumir no stripUnknown.
  test('corpo sem versao_id, ou com chave a mais, reprova', async () => {
    const semId = await request(app).post('/metas/extra/7/versoes').send({})
    expect(semId.status).toBe(400)

    const aMais = await request(app)
      .post('/metas/extra/7/versoes')
      .send({ versao_id: 101, demanda_extra_id: 7 })
    expect(aMais.status).toBe(400)
  })
})

describe('DELETE /metas/extra/:id/versoes/:versao_id', () => {
  test('desliga a versão desta demanda', async () => {
    cenario(versao({ demanda_extra_id: 7 }))
    mockDb.conn.one.mockResolvedValueOnce(versao({ demanda_extra_id: null }))

    const res = await request(app).delete('/metas/extra/7/versoes/101')

    expect(res.status).toBe(200)
    expect(updatesDaVersao()).toHaveLength(1)
    expect(updatesDaVersao()[0][0]).toContain('demanda_extra_id = NULL')
  })

  // Sem esta conferência, um id errado apagaria em silêncio o vínculo de OUTRA
  // demanda, e o UPDATE devolveria sucesso do mesmo jeito.
  test('recusa desligar versão que não é desta demanda, sem gravar', async () => {
    cenario(versao({ demanda_extra_id: 99 }))

    const res = await request(app).delete('/metas/extra/7/versoes/101')

    expect(res.status).toBe(400)
    expect(res.body.message).toContain('não materializa esta demanda')
    expect(updatesDaVersao()).toHaveLength(0)
  })

  test('recusa desligar versão sem vínculo nenhum, sem gravar', async () => {
    cenario(versao())

    const res = await request(app).delete('/metas/extra/7/versoes/101')

    expect(res.status).toBe(400)
    expect(updatesDaVersao()).toHaveLength(0)
  })
})
