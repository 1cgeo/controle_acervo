"use strict";

const { db } = require("../database");

const { AppError, httpCode, preserveOmitted } = require("../utils");
const { auditoriaCtrl } = require("../auditoria");

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

controller.criaProjeto = async (projeto, usuarioUuid, contexto) => {
  projeto.data_cadastramento = new Date();
  projeto.usuario_cadastramento_uuid = usuarioUuid;

  return db.conn.tx(async t => {
    const cs = new db.pgp.helpers.ColumnSet([
      'nome', { name: 'descricao', def: null }, 
      {name: 'data_inicio', cast: 'date'},
      {name: 'data_fim', cast: 'date'},
      'status_execucao_id', 
      'data_cadastramento',
      'usuario_cadastramento_uuid'
    ]);

    // `RETURNING *` no lugar de `RETURNING id, nome`: o rastro grava a linha que
    // o BANCO produziu, e nao o corpo da requisicao. A RESPOSTA da rota nao
    // muda, porque quem a decide e o objeto montado abaixo.
    const query = db.pgp.helpers.insert(projeto, cs, {
      table: 'projeto',
      schema: 'acervo'
    }) + ' RETURNING *';

    const result = await t.one(query);

    await auditoriaCtrl.registrar(t, {
      tabela: 'acervo.projeto',
      registroId: result.id,
      operacao: 'I',
      depois: result,
      usuarioUuid,
      contexto
    });

    return {
      id: result.id,
      nome: result.nome,
      message: `Projeto "${result.nome}" criado com sucesso`
    };
  });
};

controller.atualizaProjeto = async (projeto, usuarioUuid, contexto) => {
  projeto.data_modificacao = new Date();
  projeto.usuario_modificacao_uuid = usuarioUuid;
  return db.conn.tx(async t => {
    // A linha INTEIRA antes da mudanca, na MESMA transacao que vai altera-la.
    // Ela tambem passa a dar o 404 amigavel que este UPDATE nao tinha: sem ela,
    // id inexistente estourava o `t.one` com a mensagem crua do driver.
    const antes = await auditoriaCtrl.lerAntes(t, 'acervo.projeto', projeto.id, 'Projeto');

    const cs = new db.pgp.helpers.ColumnSet([
      'id', 'nome', { name: 'descricao', def: null },
      {name: 'data_inicio', cast: 'date'},
      {name: 'data_fim', cast: 'date'},
      'status_execucao_id',
      {name: 'data_modificacao', cast: 'timestamptz'},
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
      ) + ' WHERE Y.id = X.id RETURNING X.*';

    const result = await t.one(query);

    await auditoriaCtrl.registrar(t, {
      tabela: 'acervo.projeto',
      registroId: projeto.id,
      operacao: 'U',
      antes,
      depois: result,
      usuarioUuid,
      contexto
    });

    return {
      id: projeto.id,
      nome: result.nome,
      message: `Projeto "${result.nome}" atualizado com sucesso`
    };
  });
};

controller.deleteProjetos = async (projetoIds, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    // `SELECT *` no lugar de `SELECT id, nome`: e o `dados_antes` da exclusao,
    // pela mesma ida ao banco que a conferencia de existencia ja custava. Sem
    // ele o evento diria que o projeto foi apagado sem dizer o que se perdeu.
    const exists = await t.any(
      `SELECT * FROM acervo.projeto
      WHERE id in ($<projetoIds:csv>)`,
      { projetoIds }
    );

    if (exists && exists.length < projetoIds.length) {
      throw new AppError(
        'Um ou mais IDs informados não correspondem a entradas de projeto',
        httpCode.BadRequest
      );
    }

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

    // Um evento por PROJETO apagado, e nao um com a contagem: "o projeto X, que
    // ia de tal data a tal data, foi apagado" e a informacao de que se precisa.
    // O `loteId` do contexto amarra os N eventos da mesma requisicao.
    for (const projeto of exists) {
      await auditoriaCtrl.registrar(t, {
        tabela: 'acervo.projeto',
        registroId: projeto.id,
        operacao: 'D',
        antes: projeto,
        usuarioUuid,
        contexto
      });
    }

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

controller.criaLote = async (lote, usuarioUuid, contexto) => {
  lote.data_cadastramento = new Date();
  lote.usuario_cadastramento_uuid = usuarioUuid;
  return db.conn.tx(async t => {
    // Espelha a UNIQUE unique_pit_per_project com erro amigável
    const pitExistente = await t.oneOrNone(
      `SELECT id FROM acervo.lote WHERE projeto_id = $1 AND pit = $2`,
      [lote.projeto_id, lote.pit]
    );
    if (pitExistente) {
      throw new AppError(
        `Já existe lote com o PIT "${lote.pit}" neste projeto`,
        httpCode.Conflict
      );
    }

    const cs = new db.pgp.helpers.ColumnSet([
      'projeto_id', 'pit', 'nome', { name: 'descricao', def: null }, 
      {name: 'data_inicio', cast: 'date'},
      {name: 'data_fim', cast: 'date'},
      'status_execucao_id', 
      'data_cadastramento',
      'usuario_cadastramento_uuid'
    ]);

    const query = db.pgp.helpers.insert(lote, cs, {
      table: 'lote',
      schema: 'acervo'
    }) + ' RETURNING *';

    const result = await t.one(query);

    await auditoriaCtrl.registrar(t, {
      tabela: 'acervo.lote',
      registroId: result.id,
      operacao: 'I',
      depois: result,
      usuarioUuid,
      contexto
    });

    return {
      id: result.id,
      nome: result.nome,
      pit: result.pit,
      message: `Lote "${result.nome}" (PIT: ${result.pit}) criado com sucesso`
    };
  });
};

controller.atualizaLote = async (lote, usuarioUuid, contexto) => {
  lote.data_modificacao = new Date();
  lote.usuario_modificacao_uuid = usuarioUuid;

  return db.conn.tx(async t => {
    // Antes do `preserveOmitted`, que já lê a linha: o `antes` tem de descrever
    // o estado que a requisição encontrou, e não um estado meio preenchido.
    const antes = await auditoriaCtrl.lerAntes(t, 'acervo.lote', lote.id, 'Lote');

    // descricao é o único campo optional deste PUT e o def:null do ColumnSet
    // apagava a descrição gravada de quem omitiu a chave. Ausente agora
    // preserva; null explícito ainda limpa.
    await preserveOmitted(t, {
      table: 'lote',
      id: lote.id,
      fields: ['descricao'],
      body: lote
    });

    // Espelha a UNIQUE unique_pit_per_project com erro amigável
    const pitExistente = await t.oneOrNone(
      `SELECT id FROM acervo.lote WHERE projeto_id = $1 AND pit = $2 AND id != $3`,
      [lote.projeto_id, lote.pit, lote.id]
    );
    if (pitExistente) {
      throw new AppError(
        `Já existe outro lote com o PIT "${lote.pit}" neste projeto`,
        httpCode.Conflict
      );
    }

    const cs = new db.pgp.helpers.ColumnSet([
      'id', 'projeto_id', 'pit', 'nome', { name: 'descricao', def: null }, 
      {name: 'data_inicio', cast: 'date'},
      {name: 'data_fim', cast: 'date'},
      'status_execucao_id',
      {name: 'data_modificacao', cast: 'timestamptz'},
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
      ) + ' WHERE Y.id = X.id RETURNING X.*';

    const result = await t.one(query);

    await auditoriaCtrl.registrar(t, {
      tabela: 'acervo.lote',
      registroId: lote.id,
      operacao: 'U',
      antes,
      depois: result,
      usuarioUuid,
      contexto
    });

    return {
      id: lote.id,
      nome: result.nome,
      pit: result.pit,
      message: `Lote "${result.nome}" (PIT: ${result.pit}) atualizado com sucesso`
    };
  });
};

controller.deleteLotes = async (loteIds, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    // `SELECT *` pelo mesmo motivo de deleteProjetos: e o `dados_antes`, pela
    // ida ao banco que a conferencia de existencia ja custava.
    const exists = await t.any(
      `SELECT * FROM acervo.lote
      WHERE id in ($<loteIds:csv>)`,
      { loteIds }
    );

    if (exists && exists.length < loteIds.length) {
      throw new AppError(
        'Um ou mais IDs informados não correspondem a entradas de lote',
        httpCode.BadRequest
      );
    }

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

    for (const lote of exists) {
      await auditoriaCtrl.registrar(t, {
        tabela: 'acervo.lote',
        registroId: lote.id,
        operacao: 'D',
        antes: lote,
        usuarioUuid,
        contexto
      });
    }

    const deletedInfo = exists.map(l => `${l.nome} (PIT: ${l.pit})`);
    
    return {
      count: exists.length,
      lotes: deletedInfo,
      message: `${exists.length} lote(s) deletado(s) com sucesso`
    };
  });
};

module.exports = controller;