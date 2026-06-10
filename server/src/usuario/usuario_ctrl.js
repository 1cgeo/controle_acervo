// Path: usuario\usuario_ctrl.js
"use strict";

const { db } = require("../database");

const { AppError, httpCode } = require("../utils");

const { getUsuariosAuth } = require("../authentication");

const controller = {};

controller.getUsuarios = async () => {
  return db.conn.any(`
  SELECT u.uuid, u.login, u.nome, u.tipo_posto_grad_id, tpg.nome_abrev AS tipo_posto_grad, u.nome_guerra, u.administrador, u.ativo 
  FROM dgeo.usuario AS u
  INNER JOIN dominio.tipo_posto_grad AS tpg ON tpg.code = u.tipo_posto_grad_id
  `);
};

// Garante que a alteração não deixa o sistema sem nenhum administrador ativo
// (lockout operacional — só recuperável via SQL direto no banco)
const verificaUltimoAdmin = async (t, uuidsAlterados) => {
  const adminsRestantes = await t.one(
    `SELECT COUNT(*) AS n FROM dgeo.usuario
     WHERE administrador IS TRUE AND ativo IS TRUE
       AND uuid NOT IN ($<uuidsAlterados:csv>)`,
    { uuidsAlterados }
  );
  return parseInt(adminsRestantes.n, 10);
};

controller.atualizaUsuario = async (uuid, administrador, ativo) => {
  return db.conn.tx(async t => {
    if (!administrador || !ativo) {
      const outrosAdmins = await verificaUltimoAdmin(t, [uuid]);
      const alvo = await t.oneOrNone(
        `SELECT administrador, ativo FROM dgeo.usuario WHERE uuid = $<uuid>`,
        { uuid }
      );
      if (alvo && alvo.administrador && alvo.ativo && outrosAdmins === 0) {
        throw new AppError(
          "Operação bloqueada: este é o último administrador ativo do sistema",
          httpCode.BadRequest
        );
      }
    }

    const result = await t.result(
      "UPDATE dgeo.usuario SET administrador = $<administrador>, ativo = $<ativo> WHERE uuid = $<uuid>",
      {
        uuid,
        administrador,
        ativo
      }
    );

    if (!result.rowCount || result.rowCount !== 1) {
      throw new AppError("Usuário não encontrado", httpCode.BadRequest);
    }
  });
};

controller.atualizaUsuarioLista = async usuarios => {
  return db.conn.tx(async t => {
    // Verificar se todos os uuids existem (antes: inexistentes eram ignorados em silêncio)
    const existentes = await t.any(
      `SELECT uuid FROM dgeo.usuario WHERE uuid IN ($<uuids:csv>)`,
      { uuids: usuarios.map(u => u.uuid) }
    );

    if (existentes.length !== usuarios.length) {
      const achados = existentes.map(e => e.uuid);
      const faltantes = usuarios.map(u => u.uuid).filter(u => !achados.includes(u));
      throw new AppError(
        `Usuários não encontrados: ${faltantes.join(", ")}`,
        httpCode.BadRequest
      );
    }

    // Bloquear se a lista desativar/rebaixar todos os admins ativos restantes
    const manteraAdmin = usuarios.some(u => u.administrador && u.ativo);
    if (!manteraAdmin) {
      const outrosAdmins = await verificaUltimoAdmin(t, usuarios.map(u => u.uuid));
      if (outrosAdmins === 0) {
        throw new AppError(
          "Operação bloqueada: a alteração deixaria o sistema sem administradores ativos",
          httpCode.BadRequest
        );
      }
    }

    const cs = new db.pgp.helpers.ColumnSet(["?uuid", "ativo", "administrador"]);

    const query =
      db.pgp.helpers.update(
        usuarios,
        cs,
        { table: "usuario", schema: "dgeo" },
        {
          tableAlias: "X",
          valueAlias: "Y"
        }
      ) + " WHERE Y.uuid::uuid = X.uuid";

    return t.none(query);
  });
};

controller.getUsuariosAuthServer = async () => {
  const usuariosAuth = await getUsuariosAuth();

  const usuarios = await db.conn.any("SELECT u.uuid FROM dgeo.usuario AS u");

  return usuariosAuth.filter(u => {
    return usuarios.map(r => r.uuid).indexOf(u.uuid) === -1;
  });
};

controller.atualizaListaUsuarios = async () => {
  const usuariosAuth = await getUsuariosAuth();

  const cs = new db.pgp.helpers.ColumnSet([
    "?uuid",
    "login",
    "nome",
    "nome_guerra",
    "tipo_posto_grad_id"
  ]);

  const query =
    db.pgp.helpers.update(
      usuariosAuth,
      cs,
      { table: "usuario", schema: "dgeo" },
      {
        tableAlias: "X",
        valueAlias: "Y"
      }
    ) + " WHERE Y.uuid::uuid = X.uuid";

  return db.conn.none(query);
};

controller.criaListaUsuarios = async usuarios => {
  const usuariosAuth = await getUsuariosAuth();

  const usuariosFiltrados = usuariosAuth.filter(f => {
    return usuarios.indexOf(f.uuid) !== -1;
  });

  if (usuariosFiltrados.length === 0) {
    throw new AppError(
      "Nenhum dos usuários informados foi encontrado no servidor de autenticação",
      httpCode.BadRequest
    );
  }

  const jaImportados = await db.conn.any(
    `SELECT uuid FROM dgeo.usuario WHERE uuid IN ($<uuids:csv>)`,
    { uuids: usuariosFiltrados.map(u => u.uuid) }
  );

  if (jaImportados.length > 0) {
    throw new AppError(
      `Os seguintes usuários já estão importados: ${jaImportados.map(u => u.uuid).join(", ")}`,
      httpCode.BadRequest
    );
  }

  const cs = new db.pgp.helpers.ColumnSet([
    "uuid",
    "login",
    "nome",
    "nome_guerra",
    "tipo_posto_grad_id",
    { name: "ativo", init: () => true },
    { name: "administrador", init: () => false }
  ]);

  const query = db.pgp.helpers.insert(usuariosFiltrados, cs, {
    table: "usuario",
    schema: "dgeo"
  });

  return db.conn.none(query);
};

module.exports = controller;
