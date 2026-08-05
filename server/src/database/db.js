'use strict'

const { errorHandler } = require('../utils')

const { DB_USER, DB_PASSWORD, DB_SERVER, DB_PORT, DB_NAME } = require('../config')

const db = {}

db.pgp = require('pg-promise')()

// 1082 é o OID do DATE. Devolver a string crua ('AAAA-MM-DD') impede o driver de
// converter para Date na meia-noite local e o JSON.stringify de serializar em
// UTC: com servidor em UTC e navegador em UTC-3, a tela mostrava um dia a menos.
db.pgp.pg.types.setTypeParser(1082, valor => valor)

// Teto do pool SÓ sob teste. O Jest roda os arquivos em paralelo e cada um abre
// dois pools (`helpers/db.js` e o `createConn` do `helpers/app.js`); com o
// default de 10 por pool, 14 workers pedem 280 conexões de um PostgreSQL que
// aceita 100, e o sintoma é hook estourando o timeout, não erro de conexão.
// Dentro de um arquivo os testes são sequenciais, então dois bastam.
const POOL_TESTE = process.env.NODE_ENV === 'test' ? { max: 2 } : {}

db.createConn = async () => {
  const cn = {
    host: DB_SERVER,
    port: DB_PORT,
    database: DB_NAME,
    user: DB_USER,
    password: DB_PASSWORD,
    ...POOL_TESTE
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
