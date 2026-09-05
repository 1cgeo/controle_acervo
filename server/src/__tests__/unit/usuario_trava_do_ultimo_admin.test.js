'use strict'

// A TRAVA DO ULTIMO ADMINISTRADOR, E O DESFECHO QUE ELA ACEITOU PAGAR.
//
// `verificaUltimoAdmin` conta os administradores ativos que NAO estao na
// alteracao, com `FOR UPDATE`. O lock e a trava inteira: sem ele, "rebaixar A" e
// "rebaixar B" disparados juntos leem cada um o OUTRO ainda administrador, os
// dois contam 1, os dois gravam, e o sistema termina sem administrador nenhum --
// lockout que so `psql` desfaz.
//
// O PRECO DECLARADO do lock e o impasse (40P01): duas requisicoes que travem os
// administradores em ordens opostas fazem o Postgres abortar UMA. Aceitar o
// preco e a decisao certa; entrega-lo como 500 nao era. O `deadlock detected`
// sobe cru do driver, o `errorHandler` o trata como erro interno, e
// `sendJsonAndLog` mascara a mensagem para "Erro no servidor" e zera o campo
// `error` -- correto para 500, e exatamente o que esconde a UNICA falha desta
// funcao em que tentar de novo e a resposta.
//
// Banco mockado: a corrida de verdade precisa de duas conexoes e e do pacote de
// banco. O que se prova aqui e a TRADUCAO do codigo, e que ela nao engoliu nem o
// caminho normal nem os outros erros.

const { createMockDb } = require('../helpers/orcamento/mockDb')

const mockDb = createMockDb()
jest.mock('../../database', () => ({
  db: mockDb,
  databaseVersion: { nome: '1.0.0', load: jest.fn() }
}))

const ctrl = require('../../usuario/usuario_ctrl')

const UUID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301'
const AUTOR = 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22'
const CONTEXTO = { origem: 'web', ip: null, loteId: null }

/** A linha que o `lerAntes` devolve: o alvo E administrador ativo. */
const ALVO_ADMIN = {
  id: 7,
  uuid: UUID,
  login: 'silva',
  nome: 'Fulano da Silva',
  nome_guerra: 'Silva',
  tipo_posto_grad_id: 3,
  administrador: true,
  ativo: true,
  senha: 'hash' // path-ok
}

/** Prende o erro rejeitado: a mensagem, o status e a classe. */
const erroDe = async promessa => {
  try {
    await promessa
  } catch (err) {
    return err
  }
  throw new Error('a chamada resolveu, e o caso exige recusa')
}

describe('impasse (40P01) na trava do último administrador', () => {
  beforeEach(() => {
    mockDb.reset()
    mockDb.conn.oneOrNone.mockResolvedValue(ALVO_ADMIN)
  })

  test('vira 409 com a frase que manda tentar de novo, e não 500 mudo', async () => {
    const impasse = Object.assign(new Error('deadlock detected'), { code: '40P01' })
    mockDb.conn.any.mockRejectedValueOnce(impasse)

    const err = await erroDe(ctrl.deletaUsuario(UUID, AUTOR, CONTEXTO))

    expect(err.statusCode).toBe(409)
    expect(err.message).toBe(
      'Outra alteração de administrador está em andamento. Tente novamente.'
    )
    // O 500 mascara a mensagem no `sendJsonAndLog`; o 409 a entrega. Se o
    // status voltar a ser 500, a frase acima some da tela e o caso fica vermelho
    // na linha de cima.
    expect(err.statusCode).not.toBe(500)
  })

  test('outro erro do driver continua subindo cru, para virar 500 de verdade', async () => {
    const outro = Object.assign(new Error('connection terminated'), { code: '57P01' })
    mockDb.conn.any.mockRejectedValueOnce(outro)

    const err = await erroDe(ctrl.deletaUsuario(UUID, AUTOR, CONTEXTO))

    expect(err).toBe(outro)
    expect(err.statusCode).toBeUndefined()
  })

  test('a recusa normal da trava não mudou: sem outro admin, 400 com a frase antiga', async () => {
    mockDb.conn.any.mockResolvedValueOnce([])

    const err = await erroDe(ctrl.deletaUsuario(UUID, AUTOR, CONTEXTO))

    expect(err.statusCode).toBe(400)
    expect(err.message).toBe(
      'Operação bloqueada: este é o último administrador ativo do sistema'
    )
  })

  test('o `FOR UPDATE` continua na consulta que a trava dispara', async () => {
    mockDb.conn.any.mockResolvedValueOnce([])

    await erroDe(ctrl.deletaUsuario(UUID, AUTOR, CONTEXTO))

    const [sql] = mockDb.conn.any.mock.calls[0]
    expect(sql).toContain('FOR UPDATE')
    expect(sql).toContain('administrador IS TRUE AND ativo IS TRUE')
  })
})
