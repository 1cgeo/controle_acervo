// Path: usuario\usuario_ctrl.js
"use strict";

const { db } = require("../database");

const { AppError, httpCode } = require("../utils");

const { getUsuariosAuth } = require("../authentication");

const controller = {};

controller.getUsuarios = async () => {
  // `perfis` vem como mapa modulo -> nivel ({ acervo: 1, mapoteca: 2 }), e nao
  // como coluna por modulo, para a tela nao mudar quando surgir outro modulo.
  return db.conn.any(`
  SELECT u.uuid, u.login, u.nome, u.tipo_posto_grad_id, tpg.nome_abrev AS tipo_posto_grad, u.nome_guerra, u.administrador, u.ativo,
    COALESCE((
      SELECT json_object_agg(m.nome_abrev, up.perfil_id)
      FROM dgeo.usuario_perfil AS up
      INNER JOIN dominio.modulo AS m ON m.code = up.modulo_id
      WHERE up.usuario_id = u.id
    ), '{}'::json) AS perfis
  FROM dgeo.usuario AS u
  INNER JOIN dominio.tipo_posto_grad AS tpg ON tpg.code = u.tipo_posto_grad_id
  `);
};

controller.getModulos = async () => {
  return db.conn.any(
    "SELECT code, nome, nome_abrev FROM dominio.modulo ORDER BY code"
  );
};

controller.getPerfis = async () => {
  return db.conn.any(
    "SELECT code, nome FROM dominio.tipo_perfil ORDER BY code"
  );
};

// Grava o perfil do usuario em cada modulo informado. Nivel nulo REMOVE a linha,
// que e como se tira o acesso da pessoa aquele modulo (sem linha, sem acesso).
const gravaPerfis = async (t, usuarioId, perfis) => {
  if (!perfis) return;

  const modulos = await t.any("SELECT code, nome_abrev FROM dominio.modulo");
  const porNome = {};
  modulos.forEach(m => { porNome[m.nome_abrev] = m.code; });

  for (const [nomeModulo, nivel] of Object.entries(perfis)) {
    const moduloId = porNome[nomeModulo];
    if (!moduloId) {
      throw new AppError(`Módulo desconhecido: ${nomeModulo}`, httpCode.BadRequest);
    }
    if (nivel === null) {
      await t.none(
        "DELETE FROM dgeo.usuario_perfil WHERE usuario_id = $<usuarioId> AND modulo_id = $<moduloId>",
        { usuarioId, moduloId }
      );
    } else {
      await t.none(
        `INSERT INTO dgeo.usuario_perfil (usuario_id, modulo_id, perfil_id)
         VALUES ($<usuarioId>, $<moduloId>, $<nivel>)
         ON CONFLICT (usuario_id, modulo_id) DO UPDATE SET perfil_id = EXCLUDED.perfil_id`,
        { usuarioId, moduloId, nivel }
      );
    }
  }
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

controller.atualizaUsuario = async (uuid, administrador, ativo, perfis) => {
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

    if (perfis) {
      const { id } = await t.one("SELECT id FROM dgeo.usuario WHERE uuid = $<uuid>", { uuid });
      await gravaPerfis(t, id, perfis);
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
        usuarios.map(u => ({ uuid: u.uuid, ativo: u.ativo, administrador: u.administrador })),
        cs,
        { table: "usuario", schema: "dgeo" },
        {
          tableAlias: "X",
          valueAlias: "Y"
        }
      ) + " WHERE Y.uuid::uuid = X.uuid";

    await t.none(query);

    // Perfil por modulo de quem veio com ele no corpo (o resto fica como esta)
    for (const u of usuarios.filter(x => x.perfis)) {
      const { id } = await t.one("SELECT id FROM dgeo.usuario WHERE uuid = $<uuid>", { uuid: u.uuid });
      await gravaPerfis(t, id, u.perfis);
    }
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
