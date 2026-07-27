// Path: database\db.js
'use strict'

const { errorHandler } = require('../utils')

const { DB_USER, DB_PASSWORD, DB_SERVER, DB_PORT, DB_NAME } = require('../config')

const db = {}

db.pgp = require('pg-promise')()

// Coluna DATE volta como TEXTO 'AAAA-MM-DD', nunca como objeto Date.
//
// O driver converte DATE para um Date na MEIA-NOITE LOCAL DO SERVIDOR, e o
// JSON.stringify da resposta serializa esse Date em UTC. Com o servidor em UTC
// e o navegador em UTC-3, a data 2026-01-14 sai como '2026-01-14T00:00:00.000Z'
// e a tela mostra 13/01: um dia a menos, sem ninguem ter errado a digitacao.
// Rodando o servidor em UTC-3 o defeito some, e foi por isso que ele passou
// despercebido em desenvolvimento.
//
// DATE nao tem hora nem fuso, entao converter para instante e o erro de origem.
// Devolvendo a string crua, nenhum fuso a alcanca. Vale para toda coluna DATE
// do sistema (prazo, data_entrega, ...). Medido e corrigido em 2026-07-27.
//
// 1082 e o OID do tipo DATE no PostgreSQL.
db.pgp.pg.types.setTypeParser(1082, valor => valor)

db.createConn = async () => {
  const cn = {
    host: DB_SERVER,
    port: DB_PORT,
    database: DB_NAME,
    user: DB_USER,
    password: DB_PASSWORD
  }
  const conn = db.pgp(cn)

  await conn
    .connect()
    .then(obj => {
      obj.done() // success, release connection;
    })
    .catch(errorHandler.critical)

  db.conn = conn
}

module.exports = db
