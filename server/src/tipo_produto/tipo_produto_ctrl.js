"use strict";

const { db } = require("../database");

const { AppError, httpCode } = require("../utils");

const controller = {};

controller.getTiposProduto = async () => {
  return db.conn.any(
    `SELECT id, nome
    FROM acervo.tipo_produto`
  );
};

controller.deletaTipoProduto = async id => {
  return db.conn.tx(async t => {
    const defaultTipoProduto = id < 13;

    if (defaultTipoProduto) {
      throw new AppError(
        "Não pode deletar os tipos de produto padrão",
        httpCode.BadRequest
      );
    }

    const usedTipoProduto1 = await t.oneOrNone(
      `SELECT id FROM acervo.produto
      WHERE tipo_produto_id = $<id> LIMIT 1`,
      { id }
    );

    const usedTipoProduto2 = await t.oneOrNone(
      `SELECT id FROM acervo.volume_tipo_produto
      WHERE tipo_produto_id = $<id> LIMIT 1`,
      { id }
    );

    if (usedTipoProduto1 || usedTipoProduto2) {
      throw new AppError(
        "Não pode deletar tipos de produto que associados a produtos",
        httpCode.BadRequest
      );
    }

    await t.none(
      `UPDATE acervo.produto_deletado
      SET tipo_produto_id = NULL
      WHERE tipo_produto_id = $<id>`,
      { id }
    );

    const result = await t.result(
      "DELETE FROM acervo.tipo_produto WHERE id = $<id>",
      { id }
    );
    if (!result.rowCount || result.rowCount < 1) {
      throw new AppError("Tipo de produto não encontrado", httpCode.NotFound);
    }
  });
};

controller.criaTipoProduto = async nome => {
  return db.conn.tx(async t => {
    const existe = await t.oneOrNone(
      "SELECT id FROM acervo.tipo_produto WHERE nome = $<nome> LIMIT 1",
      { nome }
    );

    if (existe) {
      throw new AppError(
        "Tipo de produto com esse nome já existe",
        httpCode.BadRequest
      );
    }

    t.none(
      `INSERT INTO acervo.tipo_produto(nome)
    VALUES ($<nome>)`,
      { nome }
    );
  });
};

controller.updateTipoProduto = async (id, nome) => {
  return db.conn.tx(async t => {
    const existe = await t.oneOrNone(
      "SELECT id FROM acervo.tipo_produto WHERE nome = $<nome> AND id != $<id> LIMIT 1",
      { id, nome }
    );

    if (existe) {
      throw new AppError(
        "Tipo de produto com esse nome já existe",
        httpCode.BadRequest
      );
    }

    const defaultTipoProduto = id < 13;

    if (defaultTipoProduto) {
      throw new AppError(
        "Não pode atualizar os tipos de produto padrão",
        httpCode.BadRequest
      );
    }

    t.none(
      `UPDATE acervo.tipo_produto
      SET nome = $<nome>
      WHERE id = $<id>`,
      { id, nome }
    );
  });
};

module.exports = controller;
