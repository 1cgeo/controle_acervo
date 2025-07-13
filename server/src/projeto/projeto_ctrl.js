// Path: projeto\projeto_ctrl.js
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
    }) + ' RETURNING id, nome';

    const result = await t.one(query);
    
    return {
      id: result.id,
      nome: result.nome,
      message: `Projeto "${result.nome}" criado com sucesso`
    };
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
      ) + ' WHERE Y.id = X.id RETURNING X.nome';
      
    const result = await t.one(query);
    
    return {
      id: projeto.id,
      nome: result.nome,
      message: `Projeto "${result.nome}" atualizado com sucesso`
    };
  });
};

controller.deleteProjetos = async (projetoIds) => {
  return db.conn.tx(async t => {
    const exists = await t.any(
      `SELECT id, nome FROM acervo.projeto
      WHERE id in ($<projetoIds:csv>)`,
      { projetoIds }
    );

    if (exists && exists.length < projetoIds.length) {
      throw new AppError(
        'Um ou mais IDs informados não correspondem a entradas de projeto',
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
      const projetosComLotes = associatedLotes.map(l => l.projeto_id);
      throw new AppError(
        `Não é possível deletar os projetos com IDs: ${projetosComLotes.join(', ')} pois há lotes associados`,
        httpCode.BadRequest
      );
    }

    // If no dependencies, proceed with deletion
    await t.any(
      `DELETE FROM acervo.projeto
      WHERE id in ($<projetoIds:csv>)`,
      { projetoIds }
    );
    
    const deletedNames = exists.map(p => p.nome);
    
    return {
      count: exists.length,
      projetos: deletedNames,
      message: `${exists.length} projeto(s) deletado(s) com sucesso`
    };
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
    }) + ' RETURNING id, nome, pit';

    const result = await t.one(query);
    
    return {
      id: result.id,
      nome: result.nome,
      pit: result.pit,
      message: `Lote "${result.nome}" (PIT: ${result.pit}) criado com sucesso`
    };
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
      ) + ' WHERE Y.id = X.id RETURNING X.nome, X.pit';

    const result = await t.one(query);
    
    return {
      id: lote.id,
      nome: result.nome,
      pit: result.pit,
      message: `Lote "${result.nome}" (PIT: ${result.pit}) atualizado com sucesso`
    };
  });
};

controller.deleteLotes = async (loteIds, usuarioUuid) => {
  return db.conn.tx(async t => {
    const exists = await t.any(
      `SELECT id, nome, pit FROM acervo.lote
      WHERE id in ($<loteIds:csv>)`,
      { loteIds }
    );

    if (exists && exists.length < loteIds.length) {
      throw new AppError(
        'Um ou mais IDs informados não correspondem a entradas de lote',
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
      const lotesComVersoes = associatedVersoes.map(v => v.lote_id);
      throw new AppError(
        `Não é possível deletar os lotes com IDs: ${lotesComVersoes.join(', ')} pois há versões associadas`,
        httpCode.BadRequest
      );
    }
    
    // If no dependencies, proceed with deletion
    await t.any(
      `DELETE FROM acervo.lote
      WHERE id in ($<loteIds:csv>)`,
      { loteIds }
    );
    
    const deletedInfo = exists.map(l => `${l.nome} (PIT: ${l.pit})`);
    
    return {
      count: exists.length,
      lotes: deletedInfo,
      message: `${exists.length} lote(s) deletado(s) com sucesso`
    };
  });
};

module.exports = controller;