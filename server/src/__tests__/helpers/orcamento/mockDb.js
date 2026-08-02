'use strict'

// Fabrica do banco mockado. Os controllers usam:
//   db.conn.{any,one,oneOrNone,none,result}  -> jest.fn() resolvendo valores
//   db.conn.tx(cb) / db.conn.task(cb)         -> executam o callback com o
//                                                proprio conn (t === conn), de
//                                                modo que t.any/t.none usam os
//                                                mesmos mocks da transacao.
//   db.pgp.helpers (ColumnSet/insert/update)  -> REAIS (pg-promise puro, sem
//                                                conexao), pois so montam string.
//
// Uso num teste (o prefixo "mock" no nome permite referenciar na factory do
// jest.mock, que e hoisteada para o topo). Chame mockDb.reset() em beforeEach
// para isolar cada teste (fns frescas, sem vazamento de mockResolvedValueOnce):
//
//   const { createMockDb } = require('../../helpers/orcamento/mockDb')
//   const mockDb = createMockDb()
//   jest.mock('../../../database', () => ({ db: mockDb, databaseVersion: { nome: '1.0.0', load: jest.fn() } }))
//   beforeEach(() => mockDb.reset())
//   ...
//   mockDb.conn.any.mockResolvedValueOnce([{ ano: 2026 }])

const pgp = require('pg-promise')()

function novaConn () {
  // Cada chamada resolve um valor NOVO (mockImplementation, nao mockResolvedValue):
  // o pg-promise real devolve um array/objeto novo por query. Se o default
  // compartilhasse a mesma instancia, um controller que muta o resultado (ex.:
  // relatorio.gerarTabela31 faz push da linha TOTAL) contaminaria as demais
  // consultas que caem no mesmo default.
  const conn = {
    any: jest.fn(async () => []),
    one: jest.fn(async () => ({})),
    oneOrNone: jest.fn(async () => null),
    none: jest.fn(async () => null),
    result: jest.fn(async () => ({ rowCount: 1 }))
  }
  // tx/task rodam o callback com o proprio conn (transacao = mesmos mocks)
  conn.tx = jest.fn(async cb => cb(conn))
  conn.task = jest.fn(async cb => cb(conn))
  return conn
}

function createMockDb () {
  const db = {
    pgp,
    createConn: jest.fn().mockResolvedValue(undefined)
  }
  // Troca db.conn por uma instancia nova (defaults limpos, sem onces pendentes).
  // Os controllers acessam db.conn no momento da chamada, entao a troca vale.
  db.reset = () => {
    db.conn = novaConn()
  }
  db.reset()
  return db
}

/**
 * Os eventos de rastreabilidade que passaram pelo mock, na ordem em que foram
 * gravados.
 *
 * O `auditoriaCtrl.registrar` insere por `t.none`, e no mock `t === conn`: a
 * chamada fica misturada com os DELETEs do proprio controller. Filtrar pelo SQL
 * e o que separa uma coisa da outra.
 *
 * O QUE ESTE HELPER NAO PROVA, e vale repetir: `conn.tx = cb => cb(conn)` faz a
 * "transacao" ser o proprio objeto de conexao, entao um `registrar` colocado
 * FORA da transacao passaria aqui igual. Atomicidade so a suite de integracao
 * prova (`__tests__/integration/orcamento.test.js`).
 *
 * @param {object} db - o mockDb
 * @returns {Array<object>} os parametros nomeados de cada INSERT de evento
 */
function eventosDeAuditoria (db) {
  return db.conn.none.mock.calls
    .filter(
      ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO auditoria.evento')
    )
    .map(([, params]) => params)
}

module.exports = { createMockDb, eventosDeAuditoria }
