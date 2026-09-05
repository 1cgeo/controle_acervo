'use strict'

// A GRADE DIZ O QUE A CELULA NAO PODE RECEBER, e o ano encerrado e o terceiro
// motivo.
//
// `controller.salvar` e `controller.deletar` recusam lancamento em exercicio
// Encerrado (code 3 de `dominio.situacao_exercicio`), e ate 2026-09-05 a leitura
// nao contava isso para ninguem: a grade de 2025 aberta em 2027 oferecia o campo
// de digitacao, a pessoa escrevia o numero, tirava o foco e so entao levava o
// 400. E o mesmo defeito que as flags `planejada_calculada` e
// `realizada_calculada` existem para nao deixar acontecer, e o comentario delas
// no proprio controlador ja diz por que: "Pedir e recusar depois e pior do que
// nao pedir".
//
// O TESTE PRENDE O SQL, e nao o resultado. Com o banco dublado, um
// `ano_encerrado` inventado passaria em qualquer assercao sobre a linha
// devolvida; o que se quer provar e que a coluna sai da situacao do exercicio,
// pelo ano da propria meta.

const { createMockDb } = require('../helpers/orcamento/mockDb')

const mockDb = createMockDb()
jest.mock('../../database', () => ({
  db: mockDb,
  databaseVersion: { nome: '1.0.0', load: jest.fn() }
}))

const ctrl = require('../../pit/pit_execucao_ctrl')

/** O SQL e os parâmetros da consulta que a grade disparou. */
const consultaDaGrade = () => {
  const [sql, params] = mockDb.conn.any.mock.calls[0]
  return { sql, params }
}

describe('a grade do PIT devolve a situação do exercício', () => {
  beforeEach(() => mockDb.reset())

  test('o ano da meta encontra `pit.pit` por LEFT JOIN', async () => {
    await ctrl.grade(2025)

    const { sql, params } = consultaDaGrade()
    expect(sql).toContain('LEFT JOIN pit.pit AS ex ON ex.ano = m.ano')
    expect(params).toEqual({ ano: 2025 })
  })

  // O JOIN e EXTERNO de proposito: ano sem linha em `pit.pit` continua na grade.
  // Sem o COALESCE ele devolveria NULO, e a tela teria tres estados para uma
  // pergunta de dois -- que e como "nao sei" vira "pode digitar" no cliente.
  test('`ano_encerrado` é booleano mesmo quando o ano não tem exercício', async () => {
    await ctrl.grade(2025)

    expect(consultaDaGrade().sql).toContain(
      'COALESCE(ex.situacao_id = 3, FALSE) AS ano_encerrado'
    )
  })

  // O CONTROLE. Sem ele, trocar o SELECT inteiro por outra coisa faria os dois
  // casos acima passarem enquanto a grade deixava de dizer o que ja dizia.
  test('as duas flags de coluna calculada continuam na mesma linha', async () => {
    await ctrl.grade(2025)

    const { sql } = consultaDaGrade()
    expect(sql).toContain('AS planejada_calculada')
    expect(sql).toContain('AS realizada_calculada')
  })
})
