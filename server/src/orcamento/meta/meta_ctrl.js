// Path: orcamento\meta\meta_ctrl.js
'use strict'

const { db } = require('../../database')

const { AppError, httpCode } = require('../utils')

const controller = {}

const colunas = `id, ano, numero_meta, item, descricao,
  data_cadastramento, usuario_cadastramento_uuid, data_modificacao, usuario_modificacao_uuid`

controller.listar = async ano => {
  if (ano !== undefined && ano !== null) {
    return db.conn.any(
      `SELECT ${colunas}
       FROM orcamento.meta_pit
       WHERE ano = $<ano>
       ORDER BY numero_meta, item`,
      { ano }
    )
  }

  return db.conn.any(
    `SELECT ${colunas}
     FROM orcamento.meta_pit
     ORDER BY ano DESC, numero_meta, item`
  )
}

controller.getPorId = async id => {
  return db.conn.oneOrNone(
    `SELECT ${colunas}
     FROM orcamento.meta_pit
     WHERE id = $<id>`,
    { id }
  )
}

controller.criar = async (dados, usuarioUuid) => {
  return db.conn.tx(async t => {
    return t.one(
      `INSERT INTO orcamento.meta_pit
         (ano, numero_meta, item, descricao, usuario_cadastramento_uuid)
       VALUES ($<ano>, $<numero_meta>, $<item>, $<descricao>, $<usuarioUuid>)
       RETURNING id`,
      {
        ano: dados.ano,
        numero_meta: dados.numero_meta,
        item: dados.item,
        descricao: dados.descricao,
        usuarioUuid
      }
    )
  })
}

controller.atualizar = async (id, dados, usuarioUuid) => {
  return db.conn.tx(async t => {
    const existente = await t.oneOrNone(
      'SELECT id FROM orcamento.meta_pit WHERE id = $<id>',
      { id }
    )
    if (!existente) {
      throw new AppError('Meta do PIT não encontrada', httpCode.NotFound)
    }

    return t.one(
      `UPDATE orcamento.meta_pit
       SET ano = $<ano>, numero_meta = $<numero_meta>, item = $<item>,
           descricao = $<descricao>,
           data_modificacao = $<dataModificacao>, usuario_modificacao_uuid = $<usuarioUuid>
       WHERE id = $<id>
       RETURNING id`,
      {
        id,
        ano: dados.ano,
        numero_meta: dados.numero_meta,
        item: dados.item,
        descricao: dados.descricao,
        dataModificacao: new Date(),
        usuarioUuid
      }
    )
  })
}

controller.deletar = async id => {
  const existente = await db.conn.oneOrNone(
    'SELECT id FROM orcamento.meta_pit WHERE id = $<id>',
    { id }
  )
  if (!existente) {
    throw new AppError('Meta do PIT não encontrada', httpCode.NotFound)
  }

  // Bloqueia exclusao se houver itens do PDR ou notas de credito vinculados a esta meta (FK).
  const dependentes = await db.conn.one(
    `SELECT
       (SELECT COUNT(*) FROM orcamento.pdr_item WHERE meta_pit_id = $<id>) +
       (SELECT COUNT(*) FROM orcamento.nota_credito WHERE meta_pit_id = $<id>) AS n`,
    { id }
  )
  if (parseInt(dependentes.n, 10) > 0) {
    throw new AppError(
      'Meta do PIT possui registros vinculados e não pode ser excluída',
      httpCode.Conflict
    )
  }

  return db.conn.none('DELETE FROM orcamento.meta_pit WHERE id = $<id>', { id })
}

module.exports = controller
