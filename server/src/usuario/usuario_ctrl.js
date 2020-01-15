'use strict'

const { db } = require('../database')

const { AppError, httpCode } = require('../utils')

const { getUsuariosAuth } = require('../authentication')

const controller = {}

controller.getUsuarios = async () => {
  return db.conn.any(`
  SELECT u.uuid, u.login, u.nome, u.tipo_posto_grad_id, tpg.nome_abrev AS tipo_posto_grad, u.nome_guerra, u.administrador, u.ativo 
  FROM dgeo.usuario AS u
  INNER JOIN dominio.tipo_posto_grad AS tpg ON tpg.code = u.tipo_posto_grad_id
  `)
}

controller.atualizaUsuario = async (uuid, administrador, ativo) => {
  const result = await db.conn.result(
    'UPDATE dgeo.usuario SET administrador = $<administrador>, ativo = $<ativo> WHERE uuid = $<uuid>',
    {
      uuid,
      administrador,
      ativo
    }
  )

  if (!result.rowCount || result.rowCount !== 1) {
    throw new AppError('Usuário não encontrado', httpCode.BadRequest)
  }
}

controller.deletaUsuario = async uuid => {
  return db.conn.tx(async t => {
    const adm = await t.oneOrNone(
      `SELECT uuid FROM dgeo.usuario 
      WHERE uuid = $<uuid> AND administrador IS TRUE `,
      { uuid }
    )

    if (adm) {
      throw new AppError('Usuário com privilégio de administrador não pode ser deletado', httpCode.BadRequest)
    }

    await t.none(
      `UPDATE acervo.produto
      SET usuario_cadastramento_id = NULL
      WHERE usuario_cadastramento_id IN
      (SELECT id FROM dgeo.usuario WHERE uuid = $<uuid> AND administrador IS FALSE)`,
      { uuid }
    )

    await t.none(
      `UPDATE acervo.produto
      SET usuario_modificacao_id = NULL
      WHERE usuario_modificacao_id IN
      (SELECT id FROM dgeo.usuario WHERE uuid = $<uuid> AND administrador IS FALSE)`,
      { uuid }
    )

    await t.none(
      `UPDATE acervo.download
      SET usuario_id = NULL
      WHERE usuario_id IN
      (SELECT id FROM dgeo.usuario WHERE uuid = $<uuid> AND administrador IS FALSE)`,
      { uuid }
    )

    const result = await t.result(
      'DELETE FROM dgeo.usuario WHERE uuid = $<uuid> AND administrador IS FALSE',
      { uuid }
    )
    if (!result.rowCount || result.rowCount < 1) {
      throw new AppError('Usuário não encontrado', httpCode.NotFound)
    }
  })
}

controller.getUsuariosAuthServer = async cadastrados => {
  const usuariosAuth = await getUsuariosAuth()

  const usuarios = await db.conn.any('SELECT u.uuid FROM dgeo.usuario AS u')

  return usuariosAuth.filter(u => {
    return usuarios.map(r => r.uuid).indexOf(u.uuid) === -1
  })
}

controller.atualizaListaUsuarios = async () => {
  const usuariosAuth = await getUsuariosAuth()

  const table = new db.pgp.helpers.TableName({
    table: 'usuario',
    schema: 'dgeo'
  })

  const cs = new db.pgp.helpers.ColumnSet(['?uuid', 'login', 'nome', 'nome_guerra', 'tipo_posto_grad_id'], { table })

  const query =
    db.pgp.helpers.update(usuariosAuth, cs, null, {
      tableAlias: 'X',
      valueAlias: 'Y'
    }) + 'WHERE Y.uuid::uuid = X.uuid'

  return db.conn.none(query)
}

controller.criaListaUsuarios = async usuarios => {
  const usuariosAuth = await getUsuariosAuth()

  const usuariosFiltrados = usuariosAuth.filter(f => {
    return usuarios.indexOf(f.uuid) !== -1
  })
  const table = new db.pgp.helpers.TableName({
    table: 'usuario',
    schema: 'dgeo'
  })

  const cs = new db.pgp.helpers.ColumnSet(
    [
      'uuid',
      'login',
      'nome',
      'nome_guerra',
      'tipo_posto_grad_id',
      'ativo',
      'administrador'
    ],
    { table }
  )

  usuariosFiltrados.forEach(d => {
    d.ativo = true
    d.administrador = false
  })

  const query = db.pgp.helpers.insert(usuariosFiltrados, cs)

  return db.conn.none(query)
}

module.exports = controller