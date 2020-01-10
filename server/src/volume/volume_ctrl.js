'use strict'

const { db } = require('../database')

const { AppError, httpCode } = require('../utils')

const controller = {}

controller.getVolumes = async () => {
  return db.conn.any(
    `SELECT id, tipo_produto_id, volume, primario
    FROM acervo.volume_armazenamento`
  )
}

controller.deletaVolume = async id => {
  return db.conn.tx(async t => {
    const usedVolume = await t.oneOrNone(
      `SELECT volume_armazenamento_id FROM acervo.arquivo
      WHERE volume_armazenamento_id = $<id>`,
      { id }
    )

    if (usedVolume) {
      throw new AppError('Não pode deletar volumes com arquivos associados', httpCode.BadRequest)
    }

    const result = await t.result(
      'DELETE FROM acervo.volume_armazenamento WHERE id = $<id>',
      { id }
    )
    if (!result.rowCount || result.rowCount < 1) {
      throw new AppError('Volume não encontrado', httpCode.NotFound)
    }
  })
}

controller.criaVolume = async (
  tipoProdutoId,
  volume,
  primario
) => {
  return db.conn.tx(async t => {
    primario = !!primario

    if (primario) {
      t.none(
        `UPDATE acervo.volume_armazenamento
        SET primario = FALSE
        WHERE tipo_produto_id = $<tipoProdutoId>`,
        { tipoProdutoId }
      )
    }

    t.none(
      `INSERT INTO acervo.volume_armazenamento(tipo_produto_id, volume, primario)
    VALUES ($<tipoProdutoId>, $<volume>, $<primario>)`,
      { tipoProdutoId, volume, primario }
    )
  })
}

controller.updateVolume = async (
  id,
  tipoProdutoId,
  volume,
  primario
) => {
  return db.conn.tx(async t => {
    primario = !!primario

    if (primario) {
      t.none(
        `UPDATE acervo.volume_armazenamento
        SET primario = FALSE
        WHERE tipo_produto_id = $<tipoProdutoId>`,
        { tipoProdutoId }
      )
    }

    t.none(
      `UPDATE acervo.volume_armazenamento
      SET tipo_produto_id = $<tipoProdutoId>, volume = $<volume>, primario = $<primario>
      WHERE id = $<id>`,
      { id, tipoProdutoId, volume, primario }
    )
  })
}

module.exports = controller
