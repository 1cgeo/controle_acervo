"use strict";

const { db } = require("../database");

const { AppError, httpCode } = require("../utils");

const controller = {};

controller.getVolumeArmazenamento = async () => {
  return db.conn.any(
    `SELECT id, volume, nome, capacidade_mb FROM acervo.volume_armazenamento`
  )
}

controller.criaVolumeArmazenamento = async volumeArmazenamento => {
  return db.conn.tx(async t => {
    const cs = new db.pgp.helpers.ColumnSet([
      'nome', 'volume', 'capacidade_mb'
    ])

    const query = db.pgp.helpers.insert(volumeArmazenamento, cs, {
      table: 'volume_armazenamento',
      schema: 'acervo'
    })

    await t.none(query)
  })
}

controller.atualizaVolumeArmazenamento = async volumeArmazenamento => {
  return db.conn.tx(async t => {
    const cs = new db.pgp.helpers.ColumnSet([
      'id', 'nome', 'volume', 'capacidade_mb'
    ])

    const query = 
      db.pgp.helpers.update(
        volumeArmazenamento,
        cs,
        { table: 'volume_armazenamento', schema: 'acervo' },
        {
          tableAlias: 'X',
          valueAlias: 'Y'
        }
      ) + 'WHERE Y.id = X.id'

    await t.none(query)
  })
}

controller.deleteVolumeArmazenamento = async volumeArmazenamentoIds => {
  return db.conn.task(async t => {
    const associated = await t.any(
      `SELECT volume_armazenamento_id FROM acervo.volume_tipo_produto
      WHERE volume_armazenamento_id in ($<volumeArmazenamentoIds:csv>)`,
      { volumeArmazenamentoIds }
    )

    if (associated.length > 0) {
      throw new AppError(
        'Não é possível deletar pois há Volume Tipo Produto associados',
        httpCode.BadRequest
      )
    }

    const exists = await t.any(
      `SELECT id FROM acervo.volume_armazenamento
      WHERE id in ($<volumeArmazenamentoIds:csv>)`,
      { volumeArmazenamentoIds }
    )

    if (exists && exists.length < volumeArmazenamentoIds.length) {
      throw new AppError(
        'O id informado não corresponde a uma entrada do volume de armazenamento',
        httpCode.BadRequest
      )
    }

    return t.any(
      `DELETE FROM acervo.volume_armazenamento
      WHERE id in ($<volumeArmazenamentoIds:csv>)`,
      { volumeArmazenamentoIds }
    )
  })
}

controller.getVolumeTipoProduto = async () => {
  return db.conn.any(
    `SELECT id, tipo_produto_id, volume_armazenamento_id, primario FROM acervo.volume_tipo_produto`
  )
}

controller.criaVolumeTipoProduto = async volumeTipoProduto => {
  return db.conn.tx(async t => {
    const cs = new db.pgp.helpers.ColumnSet([
      'tipo_produto_id', 'volume_armazenamento_id', 'primario'
    ])

    const query = db.pgp.helpers.insert(volumeTipoProduto, cs, {
      table: 'volume_tipo_produto',
      schema: 'acervo'
    })

    await t.none(query)
  })
}

controller.atualizaVolumeTipoProduto = async volumeTipoProduto => {
  return db.conn.tx(async t => {
    const cs = new db.pgp.helpers.ColumnSet([
      'id', 'tipo_produto_id', 'volume_armazenamento_id', 'primario'
    ])

    const query = 
      db.pgp.helpers.update(
        volumeTipoProduto,
        cs,
        { table: 'volume_tipo_produto', schema: 'acervo' },
        {
          tableAlias: 'X',
          valueAlias: 'Y'
        }
      ) + 'WHERE Y.id = X.id'

    await t.none(query)
  })
}

controller.deleteVolumeTipoProduto = async volumeTipoProdutoIds => {
  return db.conn.task(async t => {
    const exists = await t.any(
      `SELECT id FROM acervo.volume_tipo_produto
      WHERE id in ($<volumeTipoProdutoIds:csv>)`,
      { volumeTipoProdutoIds }
    )

    if (exists && exists.length < volumeTipoProdutoIds.length) {
      throw new AppError(
        'O id informado não corresponde a uma entrada do Volume Tipo Produto',
        httpCode.BadRequest
      )
    }

    return t.any(
      `DELETE FROM acervo.volume_tipo_produto
      WHERE id in ($<volumeTipoProdutoIds:csv>)`,
      { volumeTipoProdutoIds }
    )
  })
}


module.exports = controller;
