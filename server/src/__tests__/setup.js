'use strict'

const path = require('path')
const fs = require('fs')
const dotenv = require('dotenv')
const { Client } = require('pg')

const RAIZ = path.resolve(__dirname, '..', '..', '..')
const SCHEMAS_DIR = path.join(RAIZ, 'er')
const CONFIG_TESTE = path.join(__dirname, '..', '..', 'config_testing.env')

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

// Lido do proprio arquivo de configuracao, e nao do ambiente: o globalSetup roda
// ANTES de qualquer dotenv do servidor, entao process.env.DB_NAME ainda esta
// vazio aqui. Antes isto funcionava por coincidencia, porque o default no
// codigo era igual ao valor do arquivo.
const AMBIENTE = dotenv.parse(fs.readFileSync(CONFIG_TESTE))
const BASE = AMBIENTE.DB_NAME || 'sca_test'
const TEMPLATE = `${BASE}_template`

const conexao = () => ({
  host: AMBIENTE.DB_SERVER || 'localhost',
  port: parseInt(AMBIENTE.DB_PORT || '5432'),
  user: AMBIENTE.DB_USER || 'postgres',
  password: AMBIENTE.DB_PASSWORD || 'postgres'
})

const derrubarEApagar = async (client, nome) => {
  await client.query(
    `SELECT pg_terminate_backend(pg_stat_activity.pid)
       FROM pg_stat_activity
      WHERE pg_stat_activity.datname = $1 AND pid <> pg_backend_pid()`,
    [nome]
  )
  await client.query(`DROP DATABASE IF EXISTS ${nome}`)
}

/** Cria o TEMPLATE: schema completo mais a semente que todo teste assume. */
const montarTemplate = async (master) => {
  await derrubarEApagar(master, TEMPLATE)
  await master.query(`CREATE DATABASE ${TEMPLATE}`)

  const client = new Client({ ...conexao(), database: TEMPLATE })
  await client.connect()

  await client.query('CREATE EXTENSION IF NOT EXISTS postgis')
  await client.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"')

  for (const arquivo of SCHEMA_ORDER) {
    const caminho = path.join(SCHEMAS_DIR, arquivo)
    if (!fs.existsSync(caminho)) continue
    try {
      await client.query(fs.readFileSync(caminho, 'utf8'))
    } catch (e) {
      console.error(`Erro ao executar ${arquivo}:`, e.message)
      throw e
    }
  }

  await client.query(`
    INSERT INTO dgeo.usuario (login, nome, nome_guerra, tipo_posto_grad_id, administrador, ativo, uuid)
    VALUES ('test_admin', 'Test Admin', 'Admin', 1, TRUE, TRUE, 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11')
  `)
  await client.query(`
    INSERT INTO dgeo.usuario (login, nome, nome_guerra, tipo_posto_grad_id, administrador, ativo, uuid)
    VALUES ('test_user', 'Test User', 'User', 1, FALSE, TRUE, 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22')
  `)

  // Perfil do usuario comum, reproduzindo o que ele podia ANTES do controle por
  // perfil: lia o acervo (consulta) e, na mapoteca, tambem imprimia (operador).
  // O admin nao ganha linha: a flag global ja o autoriza em qualquer modulo.
  await client.query(`
    INSERT INTO dgeo.usuario_perfil (usuario_id, modulo_id, perfil_id)
    SELECT id, 1, 1 FROM dgeo.usuario WHERE uuid = 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22'
  `)
  await client.query(`
    INSERT INTO dgeo.usuario_perfil (usuario_id, modulo_id, perfil_id)
    SELECT id, 2, 2 FROM dgeo.usuario WHERE uuid = 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22'
  `)

  await client.query(`
    INSERT INTO acervo.volume_armazenamento (nome, volume, capacidade_gb)
    VALUES ('Volume Teste', '/data/test', 1000)
  `)

  await client.end()
}

/**
 * UM BANCO POR WORKER, clonado do template.
 *
 * O clone e `CREATE DATABASE x TEMPLATE y`, que no PostgreSQL e copia de
 * arquivo: custa uma fracao de rodar os ~13 arquivos de `er/` de novo. Sem isso,
 * paralelizar sairia mais caro do que serializar.
 *
 * Por que N bancos e nao um: `cleanTestData()` faz TRUNCATE nas tabelas
 * inteiras, entao dois workers no mesmo banco apagariam os dados um do outro.
 * Cada worker do Jest escolhe o seu em `worker_db.js`, pelo JEST_WORKER_ID.
 */
module.exports = async (globalConfig) => {
  const workers = Math.max(1, globalConfig?.maxWorkers || 1)

  const master = new Client({ ...conexao(), database: 'postgres' })
  await master.connect()

  try {
    await montarTemplate(master)

    for (let i = 1; i <= workers; i++) {
      const nome = `${BASE}_${i}`
      await derrubarEApagar(master, nome)
      await master.query(`CREATE DATABASE ${nome} TEMPLATE ${TEMPLATE}`)
    }
  } finally {
    await master.end()
  }
}
