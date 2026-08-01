'use strict'

const { db } = require('../database')

const { AppError, httpCode } = require('../utils')

const controller = {}

const colunas = `id, ano, numero_meta, item, descricao,
  data_cadastramento, usuario_cadastramento_uuid, data_modificacao, usuario_modificacao_uuid`

controller.listar = async ano => {
  if (ano !== undefined && ano !== null) {
    return db.conn.any(
      `SELECT ${colunas}
       FROM pit.meta
       WHERE ano = $<ano>
       ORDER BY numero_meta, item`,
      { ano }
    )
  }

  return db.conn.any(
    `SELECT ${colunas}
     FROM pit.meta
     ORDER BY ano DESC, numero_meta, item`
  )
}

// Os anos que TEM meta cadastrada. A tela de metas e de plataforma e nao tem o
// seletor de ano da navbar do orcamento, entao monta o proprio filtro a partir
// desta lista, em vez de adivinhar um intervalo.
controller.anos = async () => {
  const linhas = await db.conn.any(
    'SELECT DISTINCT ano FROM pit.meta ORDER BY ano DESC'
  )
  return linhas.map(l => l.ano)
}

controller.getPorId = async id => {
  return db.conn.oneOrNone(
    `SELECT ${colunas}
     FROM pit.meta
     WHERE id = $<id>`,
    { id }
  )
}

controller.criar = async (dados, usuarioUuid) => {
  return db.conn.tx(async t => {
    return t.one(
      `INSERT INTO pit.meta
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
      'SELECT id FROM pit.meta WHERE id = $<id>',
      { id }
    )
    if (!existente) {
      throw new AppError('Meta do PIT não encontrada', httpCode.NotFound)
    }

    return t.one(
      `UPDATE pit.meta
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
    'SELECT id FROM pit.meta WHERE id = $<id>',
    { id }
  )
  if (!existente) {
    throw new AppError('Meta do PIT não encontrada', httpCode.NotFound)
  }

  // Bloqueia a exclusao quando algum consumidor aponta para esta meta. Os tres
  // vivem em schemas diferentes, e a lista cresce quando um modulo novo passar a
  // amarrar trabalho ao PIT. Sem isto o erro chegaria como 500 do banco (FK).
  const dependentes = await db.conn.one(
    `SELECT
       (SELECT COUNT(*) FROM orcamento.pdr_item WHERE meta_pit_id = $<id>) +
       (SELECT COUNT(*) FROM orcamento.nota_credito WHERE meta_pit_id = $<id>) +
       (SELECT COUNT(*) FROM mapoteca.pedido WHERE meta_pit_id = $<id>) AS n`,
    { id }
  )
  if (parseInt(dependentes.n, 10) > 0) {
    throw new AppError(
      'Meta do PIT possui registros vinculados e não pode ser excluída',
      httpCode.Conflict
    )
  }

  return db.conn.none('DELETE FROM pit.meta WHERE id = $<id>', { id })
}

module.exports = controller
