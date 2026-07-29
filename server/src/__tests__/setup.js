'use strict'

const path = require('path')
const fs = require('fs')
const { Client } = require('pg')

const RAIZ = path.resolve(__dirname, '..', '..', '..')
const SCHEMAS_DIR = path.join(RAIZ, 'er')

/**
 * A ordem dos `er/` como o create_config.js a executa.
 *
 * LIDA do arquivo, e nao copiada. Esta lista ja foi copia, e a copia apodreceu:
 * ao entrar o `er/limites.sql` em 2026-07-29, a instalacao nova o criava e o
 * banco de TESTE nao, entao tres testes de faceta morriam com 500 e a mensagem
 * falava de uma relacao que nao existe, sem dizer que a lista daqui e que estava
 * velha. Mesmo remedio que o ensaiar_migracao.cjs ja usava.
 */
const lerOrdemDoCreateConfig = () => {
  const fonte = fs.readFileSync(path.join(RAIZ, 'create_config.js'), 'utf8')
  const achados = [...fonte.matchAll(/readSqlFile\('\.\/er\/([\w.]+\.sql)'\)/g)]
    .map(m => m[1])
    // permissao*.sql recebe o nome do role por parametro e nao roda aqui.
    .filter(a => !a.startsWith('permissao'))
  if (achados.length === 0) {
    throw new Error(
      'setup de teste: nao achei nenhum er/*.sql em create_config.js. O formato mudou?'
    )
  }
  return [...new Set(achados)]
}

const SCHEMA_ORDER = lerOrdemDoCreateConfig()

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

  // Perfil do usuario comum, reproduzindo o que ele podia ANTES do controle por
  // perfil: lia o acervo (consulta) e, na mapoteca, tambem imprimia (operador).
  // O admin nao ganha linha: a flag global ja o autoriza em qualquer modulo.
  await testClient.query(`
    INSERT INTO dgeo.usuario_perfil (usuario_id, modulo_id, perfil_id)
    SELECT id, 1, 1 FROM dgeo.usuario WHERE uuid = 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22'
  `)
  await testClient.query(`
    INSERT INTO dgeo.usuario_perfil (usuario_id, modulo_id, perfil_id)
    SELECT id, 2, 2 FROM dgeo.usuario WHERE uuid = 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22'
  `)

  await testClient.query(`
    INSERT INTO acervo.volume_armazenamento (nome, volume, capacidade_gb)
    VALUES ('Volume Teste', '/data/test', 1000)
  `)

  await testClient.end()
}
