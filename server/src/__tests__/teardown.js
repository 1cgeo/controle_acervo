'use strict'

const { Client } = require('pg')

module.exports = async () => {
  const dbName = process.env.DB_NAME || 'sca_test'
  const connConfig = {
    host: process.env.DB_SERVER || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: 'postgres'
  }

  const client = new Client(connConfig)
  await client.connect()

  try {
    await client.query(
      `SELECT pg_terminate_backend(pg_stat_activity.pid)
       FROM pg_stat_activity
       WHERE pg_stat_activity.datname = $1 AND pid <> pg_backend_pid()`,
      [dbName]
    )
    await client.query(`DROP DATABASE IF EXISTS ${dbName}`)
  } catch (e) {
    console.warn('Warning: Could not drop test database:', e.message)
  }

  await client.end()
}
