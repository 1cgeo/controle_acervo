'use strict'

const path = require('path')
const fs = require('fs')
const dotenv = require('dotenv')
const { Client } = require('pg')

const CONFIG_TESTE = path.join(__dirname, '..', '..', 'config_testing.env')
const AMBIENTE = dotenv.parse(fs.readFileSync(CONFIG_TESTE))
const BASE = AMBIENTE.DB_NAME || 'sca_test'

// Apaga TUDO que o setup criou: o template e os bancos por worker.
//
// A lista sai do catalogo do proprio PostgreSQL, e nao do maxWorkers desta
// rodada: uma rodada anterior com mais workers, ou interrompida no meio, deixa
// banco orfao para tras, e ele nao apareceria contando de 1 ate o N de agora.
module.exports = async () => {
  const client = new Client({
    host: AMBIENTE.DB_SERVER || 'localhost',
    port: parseInt(AMBIENTE.DB_PORT || '5432'),
    user: AMBIENTE.DB_USER || 'postgres',
    password: AMBIENTE.DB_PASSWORD || 'postgres',
    database: 'postgres'
  })
  await client.connect()

  try {
    const { rows } = await client.query(
      "SELECT datname FROM pg_database WHERE datname = $1 OR datname ~ ('^' || $2 || '_[0-9]+$')",
      [`${BASE}_template`, BASE]
    )

    for (const { datname } of rows) {
      try {
        await client.query(
          `SELECT pg_terminate_backend(pg_stat_activity.pid)
             FROM pg_stat_activity
            WHERE pg_stat_activity.datname = $1 AND pid <> pg_backend_pid()`,
          [datname]
        )
        await client.query(`DROP DATABASE IF EXISTS ${datname}`)
      } catch (e) {
        console.warn(`Aviso: nao consegui apagar o banco de teste ${datname}:`, e.message)
      }
    }
  } finally {
    await client.end()
  }
}
