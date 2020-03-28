"use strict";

const { db } = require("../database");

const { AppError, httpCode } = require("../utils");

const controller = {};

controller.getVolumes = async () => {
  return db.conn.any(
    `SELECT va.id, va.volume
    FROM acervo.volume_armazenamento AS va`
  );
};

controller.getVolumesAssociados = async () => {
  return db.conn.any(
    `SELECT vta.id, vta.volume_armazenamento_id, vta.primario, vta.tipo_produto_id, va.volume, tp.nome AS tipo_produto
    FROM acervo.volume_tipo_produto AS vta
    INNER JOIN acervo.volume_armazenamento AS va ON vta.volume_armazenamento_id = va.id
    INNER JOIN acervo.tipo_produto AS tp ON tp.id = vta.tipo_produto_id`
  );
};

controller.deletaVolume = async id => {
  return db.conn.tx(async t => {
    const usedVolume = await t.oneOrNone(
      `SELECT volume_armazenamento_id FROM acervo.arquivo
      WHERE volume_armazenamento_id = $<id> LIMIT 1`,
      { id }
    );

    if (usedVolume) {
      throw new AppError(
        "Não pode deletar volumes com arquivos associados",
        httpCode.BadRequest
      );
    }

    const associatedVolume = await t.oneOrNone(
      `SELECT volume_armazenamento_id FROM acervo.volume_tipo_produto
      WHERE volume_armazenamento_id = $<id> LIMIT 1`,
      { id }
    );

    if (associatedVolume) {
      throw new AppError(
        "Não pode deletar volumes associados a tipo de produto",
        httpCode.BadRequest
      );
    }

    const result = await t.result(
      "DELETE FROM acervo.volume_armazenamento WHERE id = $<id>",
      { id }
    );
    if (!result.rowCount || result.rowCount < 1) {
      throw new AppError("Volume não encontrado", httpCode.NotFound);
    }
  });
};

controller.criaVolume = async volume => {
  return db.conn.tx(async t => {
    const duplicated = await t.oneOrNone(
      `SELECT volume FROM acervo.volume_armazenamento
      WHERE volume = $<volume> LIMIT 1`,
      { volume }
    );

    if (duplicated) {
      throw new AppError(
        "Já existe um volume com esse nome",
        httpCode.BadRequest
      );
    }

    t.none(
      `INSERT INTO acervo.volume_armazenamento(volume)
       VALUES ($<volume>)
      `,
      { volume }
    );
  });
};

controller.updateVolume = async (id, volume) => {
  return db.conn.tx(async t => {
    const duplicated = await t.oneOrNone(
      `SELECT volume FROM acervo.volume_armazenamento
      WHERE volume = $<volume> AND id != $<id> LIMIT 1`,
      { id, volume }
    );

    if (duplicated) {
      throw new AppError(
        "Já existe um volume com esse nome",
        httpCode.BadRequest
      );
    }

    t.none(
      `UPDATE acervo.volume_armazenamento
      SET volume = $<volume>
      WHERE id = $<id>`,
      { id, volume }
    );
  });
};

controller.associaVolume = async (tipoProdutoId, volumeId, primario) => {
  return db.conn.tx(async t => {
    primario = !!primario;

    if (primario) {
      t.none(
        `UPDATE acervo.volume_tipo_produto
        SET primario = FALSE
        WHERE tipo_produto_id = $<tipoProdutoId>`,
        { tipoProdutoId }
      );
    }

    t.none(
      `INSERT INTO acervo.volume_tipo_produto(tipo_produto_id, volume_armazenamento_id, primario)
    VALUES ($<tipoProdutoId>, $<volumeId>, $<primario>)`,
      { tipoProdutoId, volumeId, primario }
    );
  });
};

controller.updateAssociacao = async (id, tipoProdutoId, volumeId, primario) => {
  return db.conn.tx(async t => {
    primario = !!primario;

    if (primario) {
      t.none(
        `UPDATE acervo.volume_tipo_produto
        SET primario = FALSE
        WHERE tipo_produto_id = $<tipoProdutoId>`,
        { tipoProdutoId }
      );
    }

    t.none(
      `UPDATE acervo.volume_tipo_produto
      SET tipo_produto_id = $<tipoProdutoId>, volume_armazenamento_id = $<volumeId>, primario = $<primario>
      WHERE id = $<id>`,
      { id, tipoProdutoId, volumeId, primario }
    );
  });
};

controller.deletaAssociacao = async id => {
  return db.conn.tx(async t => {
    const primaryVolume = await t.oneOrNone(
      `SELECT id FROM acervo.volume_tipo_produto
      WHERE id = $<id> AND primario IS TRUE LIMIT 1`,
      { id }
    );

    if (primaryVolume) {
      throw new AppError(
        "Não pode deletar volumes primários. Atualize um outro volume a primário para este tipo de produto.",
        httpCode.BadRequest
      );
    }

    const result = await t.result(
      "DELETE FROM acervo.volume_tipo_produto WHERE id = $<id>",
      { id }
    );
    if (!result.rowCount || result.rowCount < 1) {
      throw new AppError(
        "Associação de volume não encontrada",
        httpCode.NotFound
      );
    }
  });
};

module.exports = controller;
