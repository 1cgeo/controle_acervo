"use strict";

const { db } = require("../database");
const { AppError, httpCode } = require("../utils");

const controller = {};

controller.getEstilo = async () => {
  return db.conn.any("SELECT * FROM public.layer_styles");
};

controller.getDownload = async () => {
  return db.conn.any(
    `
    SELECT 
      d.id,
      d.arquivo_id,
      d.usuario_id,
      d.data_download,
      false AS apagado
    FROM acervo.download d
    UNION ALL
    SELECT 
      dd.id,
      dd.arquivo_deletado_id AS arquivo_id,
      dd.usuario_id,
      dd.data_download,
      true AS apagado
    FROM acervo.download_deletado dd
    `
  );
}

controller.downloadInfo = async (arquivosIds, usuarioUuid) => {
  const cs = new db.pgp.helpers.ColumnSet([
    "arquivo_id",
    "usuario_id",
    { name: "data_download", mod: ":raw", init: () => "NOW()" }
  ]);

  const usuario = db.oneOrNone(
    "SELECT id FROM dgeo.usuario WHERE uuid = $<uuid>",
    { usuarioUuid }
  );

  if (!usuario) {
    throw new AppError("Usuário não encontrado", httpCode.NotFound);
  }

  const downloads = [];
  arquivosIds.forEach(id => {
    downloads.push({
      arquivo_id: id,
      usuario_id: usuario.id
    });
  });

  const query = db.pgp.helpers.insert(downloads, cs, {
    table: "download",
    schema: "acervo"
  });

  return db.conn.none(query);
};


module.exports = controller;
