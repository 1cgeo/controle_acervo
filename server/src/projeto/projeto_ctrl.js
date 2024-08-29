"use strict";

const { db } = require("../database");

const { AppError, httpCode } = require("../utils");

const controller = {};

controller.getProjetos = async () => {
  return db.conn.any(
    `SELECT p.id, p.nome, p.descricao, p.data_inicio,
    p.data_fim, p.status_execucao_id, p.data_cadastramento,
    p.usuario_cadastramento_uuid, p.data_modificacao,
    p.usuario_modificacao_uuid, tse.nome AS status_execucao
    FROM acervo.projeto AS p
    INNER JOIN dominio.tipo_status_execucao AS tse On tse.code = p.status_execucao_id
    `
  );
};

controller.criaProjeto = async (projeto, usuarioUuid) => {
  projeto.data_cadastramento = new Date();
  projeto.usuario_cadastramento_uuid = usuarioUuid;

  return db.conn.tx(async t => {
    const cs = new db.pgp.helpers.ColumnSet([
      'nome', 'descricao', 
      {name: 'data_inicio', cast: 'date'},
      {name: 'data_fim', cast: 'date'},
      'status_execucao_id', 
      {name: 'data_cadastramento', cast: 'date'},
      'usuario_cadastramento_uuid'
    ]);

    const query = db.pgp.helpers.insert(projeto, cs, {
      table: 'projeto',
      schema: 'acervo'
    });

    await t.none(query);
  });
};

controller.atualizaProjeto = async (projeto, usuarioUuid) => {
  projeto.data_modificacao = new Date();
  projeto.usuario_modificacao_uuid = usuarioUuid;
  return db.conn.tx(async t => {
    const cs = new db.pgp.helpers.ColumnSet([
      'id', 'nome', 'descricao', 
      {name: 'data_inicio', cast: 'date'},
      {name: 'data_fim', cast: 'date'},
      'status_execucao_id', 
      {name: 'data_modificacao', cast: 'date'},
      {name: 'usuario_modificacao_uuid', cast: 'uuid'}
    ]);

    const query = 
      db.pgp.helpers.update(
        [projeto],
        cs,
        { table: 'projeto', schema: 'acervo' },
        {
          tableAlias: 'X',
          valueAlias: 'Y'
        }
      ) + ' WHERE Y.id = X.id';
    await t.none(query);
  });
};

controller.deleteProjetos = async projetoIds => {
  return db.conn.task(async t => {
    const exists = await t.any(
      `SELECT id FROM acervo.projeto
      WHERE id in ($<projetoIds:csv>)`,
      { projetoIds }
    );

    if (exists && exists.length < projetoIds.length) {
      throw new AppError(
        'O id informado não corresponde a uma entrada do projeto',
        httpCode.BadRequest
      );
    }

    // Check if any project has associated lotes
    const associatedLotes = await t.any(
      `SELECT DISTINCT projeto_id FROM acervo.lote
      WHERE projeto_id IN ($<projetoIds:csv>)`,
      { projetoIds }
    );

    if (associatedLotes.length > 0) {
      throw new AppError(
        'Não é possível deletar o projeto pois há lotes associados',
        httpCode.BadRequest
      );
    }

    // If no dependencies, proceed with deletion
    return t.any(
      `DELETE FROM acervo.projeto
      WHERE id in ($<projetoIds:csv>)`,
      { projetoIds }
    );
  });
};

controller.getLotes = async () => {
  return db.conn.any(
    `SELECT l.id, l.projeto_id, l.pit, l.nome, l.descricao, l.data_inicio,
    l.data_fim, l.status_execucao_id, l.data_cadastramento,
    l.usuario_cadastramento_uuid, l.data_modificacao,
    l.usuario_modificacao_uuid, tse.nome AS status_execucao,
    p.nome AS projeto
    FROM acervo.lote AS l
    INNER JOIN dominio.tipo_status_execucao AS tse On tse.code = l.status_execucao_id
    INNER JOIN acervo.projeto AS p ON p.id = l.projeto_id
    `
  );
};

controller.criaLote = async (lote, usuarioUuid) => {
  lote.data_cadastramento = new Date();
  lote.usuario_cadastramento_uuid = usuarioUuid;
  return db.conn.tx(async t => {
    const cs = new db.pgp.helpers.ColumnSet([
      'projeto_id', 'pit', 'nome', 'descricao', 
      {name: 'data_inicio', cast: 'date'},
      {name: 'data_fim', cast: 'date'},
      'status_execucao_id', 
      {name: 'data_cadastramento', cast: 'date'},
      'usuario_cadastramento_uuid'
    ]);

    const query = db.pgp.helpers.insert(lote, cs, {
      table: 'lote',
      schema: 'acervo'
    });

    await t.none(query);
  });
};

controller.atualizaLote = async (lote, usuarioUuid) => {
  lote.data_modificacao = new Date();
  lote.usuario_modificacao_uuid = usuarioUuid;

  return db.conn.tx(async t => {
    const cs = new db.pgp.helpers.ColumnSet([
      'id', 'projeto_id', 'pit', 'nome', 'descricao', 
      {name: 'data_inicio', cast: 'date'},
      {name: 'data_fim', cast: 'date'},
      'status_execucao_id',
      {name: 'data_modificacao', cast: 'date'},
      {name: 'usuario_modificacao_uuid', cast: 'uuid'}
    ]);

    const query = 
      db.pgp.helpers.update(
        [lote],
        cs,
        { table: 'lote', schema: 'acervo' },
        {
          tableAlias: 'X',
          valueAlias: 'Y'
        }
      ) + ' WHERE Y.id = X.id';

    await t.none(query);
  });
};

controller.deleteLotes = async loteIds => {
  return db.conn.task(async t => {
    const exists = await t.any(
      `SELECT id FROM acervo.lote
      WHERE id in ($<loteIds:csv>)`,
      { loteIds }
    );

    if (exists && exists.length < loteIds.length) {
      throw new AppError(
        'O id informado não corresponde a uma entrada do lote',
        httpCode.BadRequest
      );
    }

    // Check if any lote has associated versoes
    const associatedVersoes = await t.any(
      `SELECT DISTINCT lote_id FROM acervo.versao
      WHERE lote_id IN ($<loteIds:csv>)`,
      { loteIds }
    );

    if (associatedVersoes.length > 0) {
      throw new AppError(
        'Não é possível deletar o lote pois há versões associadas',
        httpCode.BadRequest
      );
    }

    // If no dependencies, proceed with deletion
    return t.any(
      `DELETE FROM acervo.lote
      WHERE id in ($<loteIds:csv>)`,
      { loteIds }
    );
  });
};

module.exports = controller;
