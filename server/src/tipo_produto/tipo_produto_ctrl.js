"use strict";

const { db } = require("../database");

const { AppError, httpCode } = require("../utils");

const controller = {};

controller.getTipoProduto = async () => {
  return db.sapConn.any(
    `SELECT id, nome FROM acervo.tipo_produto`
  )
}

controller.criaTipoProduto = async tipoProduto => {
  return db.sapConn.tx(async t => {
    const cs = new db.pgp.helpers.ColumnSet([
      'nome'
    ])

    const query = db.pgp.helpers.insert(tipoProduto, cs, {
      table: 'tipo_produto',
      schema: 'acervo'
    })

    await t.none(query)
  })
}

controller.atualizaTipoProduto = async tipoProduto => {
  return db.sapConn.tx(async t => {
    for (const item of tipoProduto) {
      if (item.id <= 23) {
        throw new AppError(
          'Não é permitido alterar entradas do Tipo Produto com id <= 23',
          httpCode.BadRequest
        )
      }
    }

    const cs = new db.pgp.helpers.ColumnSet([
      'id', 'nome'
    ])

    const query = 
      db.pgp.helpers.update(
        tipoProduto,
        cs,
        { table: 'tipo_produto', schema: 'acervo' },
        {
          tableAlias: 'X',
          valueAlias: 'Y'
        }
      ) + 'WHERE Y.id = X.id'

    await t.none(query)
  })
}

controller.deleteTipoProduto = async tipoProdutoIds => {
  for (const id of tipoProdutoIds) {
    if (id <= 23) {
      throw new AppError(
        'Não é permitido deletar entradas do Tipo Produto com id <= 23',
        httpCode.BadRequest
      )
    }
  }

  return db.sapConn.task(async t => {
    const exists = await t.any(
      `SELECT id FROM acervo.tipo_produto
      WHERE id in ($<tipoProdutoIds:csv>)`,
      { tipoProdutoIds }
    )

    if (exists && exists.length < tipoProdutoIds.length) {
      throw new AppError(
        'O id informado não corresponde a uma entrada do Tipo Produto',
        httpCode.BadRequest
      )
    }

    return t.any(
      `DELETE FROM acervo.tipo_produto
      WHERE id in ($<tipoProdutoIds:csv>)`,
      { tipoProdutoIds }
    )
  })
}

module.exports = controller;
