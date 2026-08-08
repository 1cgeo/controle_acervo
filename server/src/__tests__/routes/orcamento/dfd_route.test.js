'use strict'

// Teste de rota (supertest) do DFD. Mocka banco + autenticacao (admin).
// A licitacao nao referencia mais o DFD, entao excluir DFD nao bloqueia por
// licitacao (remove primeiro os itens e depois o proprio DFD).

const { createMockDb, eventosDeAuditoria } = require('../../helpers/orcamento/mockDb')

const mockDb = createMockDb()
jest.mock('../../../database', () => ({
  db: mockDb,
  databaseVersion: { nome: '1.0.0', load: jest.fn() }
}))
jest.mock('../../../login', () => require('../../helpers/orcamento/mockLogin'))

const request = require('supertest')
const { buildTestApp } = require('../../helpers/orcamento/testApp')
const { dfdRoute } = require('../../../orcamento/dfd')

const app = buildTestApp([{ path: '/dfd', router: dfdRoute }])

beforeEach(() => mockDb.reset())

describe('GET /dfd/:id', () => {
  test('traz o DFD com o array de itens', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce({ id: 42, numero: 'DFD-001' })
    mockDb.conn.any.mockResolvedValueOnce([{ id: 1, descricao: 'Item A' }])
    const res = await request(app).get('/dfd/42')
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.dados.itens).toHaveLength(1)
  })

  test('404 quando o DFD nao existe', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce(null)
    const res = await request(app).get('/dfd/99')
    expect(res.status).toBe(404)
  })
})

describe('POST /dfd', () => {
  test('rejeita body sem numero/ano com 400 (validacao Joi)', async () => {
    const res = await request(app).post('/dfd').send({ objeto: 'x' })
    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
  })

  test('cria DFD com itens e responde com sucesso', async () => {
    mockDb.conn.one.mockResolvedValueOnce({ id: 42, numero: 'DFD-001', ano: 2026 })
    mockDb.conn.none.mockResolvedValueOnce(undefined) // insert dos itens
    mockDb.conn.any.mockResolvedValueOnce([
      { tipo_item_id: 1, descricao: 'Item A', valor_total: '100.00' }
    ]) // releitura dos itens, para o rastro
    const res = await request(app)
      .post('/dfd')
      .send({
        numero: 'DFD-001',
        ano: 2026,
        objeto: 'Aquisicao',
        itens: [{ tipo_item_id: 1, descricao: 'Item A', quantidade: 2, valor_unitario: 50 }]
      })
    expect([200, 201]).toContain(res.status)
    expect(res.body.success).toBe(true)
    // A rota continua devolvendo SO o id: o `RETURNING *` e do rastro.
    expect(res.body.dados).toEqual({ id: 42 })
  })

  // SAO DOIS EVENTOS, e o segundo descreve a LISTA INTEIRA.
  //
  // `dfd_item` e "apaga tudo e reinsere": auditar linha a linha faria o
  // historico do DFD dizer "removeu 4 itens, acrescentou 4 itens" toda vez que
  // alguem abrisse e salvasse, porque os ids mudam sempre. Por isso o evento dos
  // itens e do PAI, com o antes e o depois da lista descrita em texto.
  test('registra o DFD e a LISTA de itens, os dois na ficha do DFD', async () => {
    mockDb.conn.one.mockResolvedValueOnce({ id: 42, numero: 'DFD-001', ano: 2026 })
    mockDb.conn.none.mockResolvedValueOnce(undefined)
    mockDb.conn.any.mockResolvedValueOnce([
      { tipo_item_id: 1, descricao: 'Item A', quantidade: '2', valor_total: '100.00' }
    ])
    await request(app)
      .post('/dfd')
      .send({
        numero: 'DFD-001',
        ano: 2026,
        itens: [{ tipo_item_id: 1, descricao: 'Item A', quantidade: 2, valor_unitario: 50 }]
      })

    const eventos = eventosDeAuditoria(mockDb)
    expect(eventos).toHaveLength(2)

    expect(eventos[0]).toMatchObject({
      modulo: 'orcamento',
      entidade: 'dfd',
      entidadeId: '42',
      tabela: 'orcamento.dfd',
      registroId: '42',
      operacao: 'I',
      usuarioUuid: '11111111-1111-1111-1111-111111111111'
    })

    expect(eventos[1]).toMatchObject({
      entidade: 'dfd',
      entidadeId: '42',
      tabela: 'orcamento.dfd_item',
      operacao: 'I',
      // Sem `registro_id`: o evento descreve a lista, e nao uma linha.
      registroId: null
    })
    expect(JSON.parse(eventos[1].dadosDepois).itens).toEqual([
      'tipo 1 | Item A | qtd 2 | total 100.00'
    ])
  })

  // Salvar sem mexer nos itens NAO pode produzir uma linha de historico dizendo
  // que os itens mudaram. E o defeito que o evento por lista existe para evitar.
  test('salvar o cabecalho sem mexer nos itens nao gera evento de itens', async () => {
    const itensNoBanco = [
      { tipo_item_id: 1, descricao: 'Item A', quantidade: '2', valor_total: '100.00' }
    ]
    mockDb.conn.oneOrNone.mockResolvedValueOnce({
      id: 42,
      numero: 'DFD-001',
      ano: 2026,
      objeto: 'Antigo'
    }) // lerAntes do DFD
    mockDb.conn.any
      .mockResolvedValueOnce(itensNoBanco) // itens ANTES
      .mockResolvedValueOnce(itensNoBanco) // itens DEPOIS, iguais
    mockDb.conn.one.mockResolvedValueOnce({
      id: 42,
      numero: 'DFD-001',
      ano: 2026,
      objeto: 'Novo'
    })

    const res = await request(app)
      .put('/dfd/42')
      .send({
        numero: 'DFD-001',
        ano: 2026,
        objeto: 'Novo',
        itens: [{ tipo_item_id: 1, descricao: 'Item A', quantidade: 2, valor_unitario: 50 }]
      })
    expect(res.status).toBe(200)

    const eventos = eventosDeAuditoria(mockDb)
    expect(eventos).toHaveLength(1)
    expect(eventos[0].tabela).toBe('orcamento.dfd')
    expect(eventos[0].camposAlterados).toEqual(['objeto'])
  })
})

describe('DELETE /dfd/:id', () => {
  test('exclui o DFD e seus itens', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce({
      id: 10,
      numero: 'DFD-010',
      ano: 2026
    }) // lerAntes
    mockDb.conn.any
      .mockResolvedValueOnce([
        { tipo_item_id: 1, descricao: 'Item A', valor_total: '100.00' }
      ]) // itens antes
      .mockResolvedValueOnce([]) // anexos do DFD (cascata)
    mockDb.conn.none
      .mockResolvedValueOnce(undefined) // DELETE itens
      .mockResolvedValueOnce(undefined) // DELETE dfd
    const res = await request(app).delete('/dfd/10')
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)

    const eventos = eventosDeAuditoria(mockDb)
    const tabelas = eventos.map(e => e.tabela)
    expect(tabelas).toContain('orcamento.dfd_item')
    expect(tabelas).toContain('orcamento.dfd')
    // Nas duas, `dados_antes` PREENCHIDO e `dados_depois` nulo: sem isso a
    // exclusao nao diz o que se perdeu.
    for (const evento of eventos) {
      expect(evento.operacao).toBe('D')
      expect(evento.dadosAntes).not.toBeNull()
      expect(evento.dadosDepois).toBeNull()
    }
  })

  test('404 quando o DFD nao existe', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce(null)
    const res = await request(app).delete('/dfd/99')
    expect(res.status).toBe(404)
    expect(eventosDeAuditoria(mockDb)).toHaveLength(0)
  })
})
