'use strict'

// Teste de rota (supertest) do CRUD admin dos dominios editaveis (natureza de
// despesa, plano interno, UG). Mocka banco e autenticacao (admin passthrough).
// Cobre: criar (201, grupo derivado do GND, 409 codigo duplicado, 400 validacao),
// atualizar (200, 404) e excluir (200, 404, 409 em uso).
//
// A ORDEM DAS CONSULTAS MUDOU, com a rastreabilidade, e e por isso
// que os mocks deste arquivo nao sao os de antes:
//   * criar   -> `one` (INSERT ... RETURNING *), e nao mais `none`. O rastro
//                precisa da linha que o BANCO gravou, e nao do corpo enviado.
//   * alterar -> `oneOrNone` (o lerAntes, que produz o `dados_antes` e o 404 no
//                lugar do antigo rowCount) e depois `one` (UPDATE ... RETURNING *).
//   * excluir -> `oneOrNone` (lerAntes) e depois `none` (DELETE).
//
// Estas tres tabelas sao a alteracao de MAIOR ALCANCE do modulo: mudar o nome ou
// o GND de uma ND reclassifica NC e NE ja lancadas.

const { createMockDb, eventosDeAuditoria } = require('../../helpers/orcamento/mockDb')

const mockDb = createMockDb()
jest.mock('../../../database', () => ({
  db: mockDb,
  databaseVersion: { nome: '1.0.0', load: jest.fn() }
}))
jest.mock('../../../login', () => require('../../helpers/orcamento/mockLogin'))

const request = require('supertest')
const { buildTestApp } = require('../../helpers/orcamento/testApp')
const { dominioRoute } = require('../../../orcamento/dominio')

const app = buildTestApp([{ path: '/dominio', router: dominioRoute }])

const AUTOR = '11111111-1111-1111-1111-111111111111'

beforeEach(() => mockDb.reset())

describe('POST /dominio/natureza_despesa', () => {
  test('cria com 201 e deriva grupo=custeio do GND 3', async () => {
    mockDb.conn.one.mockResolvedValueOnce({
      code: '339030',
      nome: 'Material de consumo',
      gnd: 3,
      grupo: 'custeio'
    })
    const res = await request(app)
      .post('/dominio/natureza_despesa')
      .send({ code: '339030', nome: 'Material de consumo', gnd: 3 })
    expect(res.status).toBe(201)
    expect(res.body.success).toBe(true)
    expect(mockDb.conn.one).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO dominio.natureza_despesa'),
      expect.objectContaining({ code: '339030', gnd: 3, grupo: 'custeio' })
    )
  })

  test('deriva grupo=capital do GND 4', async () => {
    mockDb.conn.one.mockResolvedValueOnce({
      code: '449052',
      nome: 'Equipamentos',
      gnd: 4,
      grupo: 'capital'
    })
    await request(app)
      .post('/dominio/natureza_despesa')
      .send({ code: '449052', nome: 'Equipamentos', gnd: 4 })
    expect(mockDb.conn.one).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ grupo: 'capital' })
    )
  })

  test('registra a criacao com o autor do token', async () => {
    mockDb.conn.one.mockResolvedValueOnce({
      code: '339030',
      nome: 'Material de consumo',
      gnd: 3,
      grupo: 'custeio'
    })
    await request(app)
      .post('/dominio/natureza_despesa')
      .send({ code: '339030', nome: 'Material de consumo', gnd: 3 })

    const eventos = eventosDeAuditoria(mockDb)
    expect(eventos).toHaveLength(1)
    expect(eventos[0]).toMatchObject({
      modulo: 'orcamento',
      entidade: 'dominio',
      // O agregado e o proprio `code`: a tabela do evento e o que separa a ND da
      // UG que porventura tenha o mesmo codigo.
      entidadeId: '339030',
      tabela: 'dominio.natureza_despesa',
      operacao: 'I',
      usuarioUuid: AUTOR
    })
  })

  test('codigo duplicado (23505) vira 409', async () => {
    mockDb.conn.one.mockRejectedValueOnce({ code: '23505' })
    const res = await request(app)
      .post('/dominio/natureza_despesa')
      .send({ code: '339030', nome: 'Repetida', gnd: 3 })
    expect(res.status).toBe(409)
  })

  test('sem nome -> 400 (validacao Joi)', async () => {
    const res = await request(app)
      .post('/dominio/natureza_despesa')
      .send({ code: '339030', gnd: 3 })
    expect(res.status).toBe(400)
  })

  test('GND invalido -> 400', async () => {
    const res = await request(app)
      .post('/dominio/natureza_despesa')
      .send({ code: '339030', nome: 'X', gnd: 5 })
    expect(res.status).toBe(400)
  })
})

describe('PUT /dominio/natureza_despesa/:code', () => {
  test('atualiza com 200 quando existe', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce({
      code: '339030',
      nome: 'Material de consumo',
      gnd: 3,
      grupo: 'custeio'
    })
    mockDb.conn.one.mockResolvedValueOnce({
      code: '339030',
      nome: 'Novo nome',
      gnd: 4,
      grupo: 'capital'
    })
    const res = await request(app)
      .put('/dominio/natureza_despesa/339030')
      .send({ nome: 'Novo nome', gnd: 4 })
    expect(res.status).toBe(200)
  })

  test('404 quando nao existe (o lerAntes nao acha a linha)', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce(null)
    const res = await request(app)
      .put('/dominio/natureza_despesa/000000')
      .send({ nome: 'X', gnd: 3 })
    expect(res.status).toBe(404)
    // Sem linha, nao ha evento: a auditoria nao inventa uma alteracao que nao
    // aconteceu.
    expect(eventosDeAuditoria(mockDb)).toHaveLength(0)
  })

  // O caso que motiva auditar dominio: mudar o GND de uma ND RECLASSIFICA toda
  // NC e toda NE ja lancadas com aquele codigo, e sem evento isso nao deixa
  // rastro nenhum.
  test('o evento guarda o valor ANTERIOR do GND', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce({
      code: '339030',
      nome: 'Material de consumo',
      gnd: 3,
      grupo: 'custeio'
    })
    mockDb.conn.one.mockResolvedValueOnce({
      code: '339030',
      nome: 'Material de consumo',
      gnd: 4,
      grupo: 'capital'
    })
    await request(app)
      .put('/dominio/natureza_despesa/339030')
      .send({ nome: 'Material de consumo', gnd: 4 })

    const [evento] = eventosDeAuditoria(mockDb)
    expect(evento.operacao).toBe('U')
    expect(evento.camposAlterados).toEqual(['gnd', 'grupo'])
    expect(JSON.parse(evento.dadosAntes).gnd).toBe(3)
    expect(JSON.parse(evento.dadosDepois).gnd).toBe(4)
  })
})

describe('DELETE /dominio/natureza_despesa/:code', () => {
  test('exclui com 200', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce({
      code: '339030',
      nome: 'Material de consumo',
      gnd: 3,
      grupo: 'custeio'
    })
    const res = await request(app).delete('/dominio/natureza_despesa/339030')
    expect(res.status).toBe(200)

    const [evento] = eventosDeAuditoria(mockDb)
    expect(evento).toMatchObject({ operacao: 'D', usuarioUuid: AUTOR })
    // dados_antes PREENCHIDO: sem ele a exclusao nao diz o que se perdeu.
    expect(JSON.parse(evento.dadosAntes).nome).toBe('Material de consumo')
    expect(evento.dadosDepois).toBeNull()
  })

  test('404 quando nao existe', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce(null)
    const res = await request(app).delete('/dominio/natureza_despesa/000000')
    expect(res.status).toBe(404)
  })

  test('em uso (FK 23503) vira 409', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce({ code: '339030', nome: 'X', gnd: 3 })
    mockDb.conn.none.mockRejectedValueOnce({ code: '23503' })
    const res = await request(app).delete('/dominio/natureza_despesa/339030')
    expect(res.status).toBe(409)
  })
})

describe('POST /dominio/plano_interno', () => {
  test('cria com 201 e normaliza alinea vazia para null', async () => {
    mockDb.conn.one.mockResolvedValueOnce({
      code: 'PTRES123',
      nome: 'Plano X',
      alinea: null
    })
    const res = await request(app)
      .post('/dominio/plano_interno')
      .send({ code: 'PTRES123', nome: 'Plano X', alinea: '' })
    expect(res.status).toBe(201)
    expect(mockDb.conn.one).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO dominio.plano_interno'),
      expect.objectContaining({ code: 'PTRES123', alinea: null })
    )
  })

  test('alinea com mais de 1 caractere -> 400', async () => {
    const res = await request(app)
      .post('/dominio/plano_interno')
      .send({ code: 'PTRES123', nome: 'Plano X', alinea: 'AB' })
    expect(res.status).toBe(400)
  })
})

describe('CRUD /dominio/ug', () => {
  test('cria com 201', async () => {
    mockDb.conn.one.mockResolvedValueOnce({ code: '160382', nome: '1 CGEO' })
    const res = await request(app)
      .post('/dominio/ug')
      .send({ code: '160382', nome: '1 CGEO' })
    expect(res.status).toBe(201)
    expect(mockDb.conn.one).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO dominio.ug'),
      expect.objectContaining({ code: '160382', nome: '1 CGEO' })
    )
    expect(eventosDeAuditoria(mockDb)[0]).toMatchObject({
      tabela: 'dominio.ug',
      entidadeId: '160382',
      operacao: 'I'
    })
  })

  test('sem nome -> 400', async () => {
    const res = await request(app).post('/dominio/ug').send({ code: '160382' })
    expect(res.status).toBe(400)
  })

  test('exclui em uso (23503) vira 409', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce({ code: '160382', nome: '1 CGEO' })
    mockDb.conn.none.mockRejectedValueOnce({ code: '23503' })
    const res = await request(app).delete('/dominio/ug/160382')
    expect(res.status).toBe(409)
  })
})
