'use strict'

const pgp = require('pg-promise')()

const {
  DB_SERVER, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD
} = require('../../config')

const conn = pgp({
  host: DB_SERVER,
  port: DB_PORT,
  database: DB_NAME,
  user: DB_USER,
  password: DB_PASSWORD
})

/**
 * Cleans all test data from the database while preserving
 * domain/lookup tables and the seed users + volume.
 * Tables are truncated in reverse-dependency order.
 */
const cleanTestData = async () => {
  await conn.tx(async t => {
    // Mapoteca tables
    await t.none('TRUNCATE mapoteca.consumo_material CASCADE')
    await t.none('TRUNCATE mapoteca.estoque_material CASCADE')
    await t.none('TRUNCATE mapoteca.manutencao_plotter CASCADE')
    await t.none('TRUNCATE mapoteca.produto_pedido CASCADE')
    await t.none('TRUNCATE mapoteca.pedido CASCADE')
    await t.none('TRUNCATE mapoteca.plotter CASCADE')
    await t.none('TRUNCATE mapoteca.cliente CASCADE')
    await t.none('TRUNCATE mapoteca.tipo_material CASCADE')

    // Acervo upload temp tables
    await t.none('TRUNCATE acervo.upload_arquivo_temp CASCADE')
    await t.none('TRUNCATE acervo.upload_versao_temp CASCADE')
    await t.none('TRUNCATE acervo.upload_produto_temp CASCADE')
    await t.none('TRUNCATE acervo.upload_session CASCADE')

    // Acervo main tables
    await t.none('TRUNCATE acervo.download_deletado CASCADE')
    await t.none('TRUNCATE acervo.download CASCADE')
    await t.none('TRUNCATE acervo.arquivo_deletado CASCADE')
    await t.none('TRUNCATE acervo.arquivo CASCADE')
    await t.none('TRUNCATE acervo.versao_relacionamento CASCADE')
    await t.none('TRUNCATE acervo.versao CASCADE')
    await t.none('TRUNCATE acervo.lote CASCADE')
    await t.none('TRUNCATE acervo.projeto CASCADE')
    await t.none('TRUNCATE acervo.produto CASCADE')
    await t.none('TRUNCATE acervo.volume_tipo_produto CASCADE')

    // Reset volume_armazenamento to only seed row
    await t.none('DELETE FROM acervo.volume_armazenamento WHERE id > 1')

    // Reset users to only seed rows
    await t.none(`DELETE FROM dgeo.usuario WHERE uuid NOT IN (
      'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22'
    )`)
  })
}

const closeConnection = async () => {
  await pgp.end()
}

module.exports = {
  conn,
  pgp,
  cleanTestData,
  closeConnection
}
