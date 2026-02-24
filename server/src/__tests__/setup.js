'use strict'

const path = require('path')
const fs = require('fs')
const { Client } = require('pg')

const SCHEMAS_DIR = path.resolve(__dirname, '..', '..', '..', 'er')
const SCHEMA_ORDER = [
  'versao.sql',
  'dominio.sql',
  'dgeo.sql',
  'acervo.sql',
  'acompanhamento.sql',
  'mapoteca.sql'
]

module.exports = async () => {
  const dbName = process.env.DB_NAME || 'sca_test'
  const connConfig = {
    host: process.env.DB_SERVER || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres'
  }

  // Connect to master DB to create test database
  const masterClient = new Client({ ...connConfig, database: 'postgres' })
  await masterClient.connect()

  try {
    await masterClient.query(
      `SELECT pg_terminate_backend(pg_stat_activity.pid)
       FROM pg_stat_activity
       WHERE pg_stat_activity.datname = $1 AND pid <> pg_backend_pid()`,
      [dbName]
    )
    await masterClient.query(`DROP DATABASE IF EXISTS ${dbName}`)
  } catch (e) {
    // Ignore if database doesn't exist
  }

  await masterClient.query(`CREATE DATABASE ${dbName}`)
  await masterClient.end()

  // Connect to the newly created test database
  const testClient = new Client({ ...connConfig, database: dbName })
  await testClient.connect()

  await testClient.query('CREATE EXTENSION IF NOT EXISTS postgis')
  await testClient.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"')

  // Run schema SQL files (raw pg client handles $$ delimiters correctly)
  for (const schemaFile of SCHEMA_ORDER) {
    const filePath = path.join(SCHEMAS_DIR, schemaFile)
    if (fs.existsSync(filePath)) {
      const sql = fs.readFileSync(filePath, 'utf8')
      try {
        await testClient.query(sql)
      } catch (e) {
        console.error(`Error executing ${schemaFile}:`, e.message)
        throw e
      }
    }
  }

  // Seed test data
  await testClient.query(`
    INSERT INTO dgeo.usuario (login, nome, nome_guerra, tipo_posto_grad_id, administrador, ativo, uuid)
    VALUES ('test_admin', 'Test Admin', 'Admin', 1, TRUE, TRUE, 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11')
  `)
  await testClient.query(`
    INSERT INTO dgeo.usuario (login, nome, nome_guerra, tipo_posto_grad_id, administrador, ativo, uuid)
    VALUES ('test_user', 'Test User', 'User', 1, FALSE, TRUE, 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22')
  `)

  await testClient.query(`
    INSERT INTO acervo.volume_armazenamento (nome, volume, capacidade_gb)
    VALUES ('Volume Teste', '/data/test', 1000)
  `)

  await testClient.end()
}
