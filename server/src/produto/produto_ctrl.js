"use strict";

const { db } = require("../database");
const { AppError, httpCode } = require("../utils");

const controller = {};

controller.getEstilo = async () => {
  return db.conn.oneOrNone("SELECT * FROM public.layer_styles LIMIT 1");
};

controller.downloadInfo = async (produtosIds, usuarioUuid) => {
  const cs = new db.pgp.helpers.ColumnSet([
    "produto_id",
    "usuario_id",
    { name: "data", mod: ":raw", init: () => "NOW()" }
  ]);

  const usuario = db.oneOrNone(
    "SELECT id FROM dgeo.usuario WHERE uuid = $<uuid>",
    { usuarioUuid }
  );

  if (!usuario) {
    throw new AppError("Usuário não encontrado", httpCode.NotFound);
  }

  const downloads = [];
  produtosIds.forEach(id => {
    downloads.push({
      produto_id: id,
      usuario_id: usuario.id
    });
  });

  const query = db.pgp.helpers.insert(downloads, cs, {
    table: "download",
    schema: "acervo"
  });

  return db.conn.none(query);
};

controller.getArquivosPagination = async (
  pagina,
  totalPagina,
  colunaOrdem,
  direcaoOrdem,
  filtro
) => {
  let where = "";

  if (filtro) {
    where = ` WHERE lower(concat_ws('|',p.uuid,p.nome,a.nome, a.extensao, a.tamanho_mb, tp.nome, p.data_produto)) LIKE '%${filtro.toLowerCase()}%'`;
  }

  let sort = "";
  if (colunaOrdem) {
    if (direcaoOrdem) {
      sort = ` ORDER BY e.${colunaOrdem} ${direcaoOrdem}`;
    } else {
      sort = ` ORDER BY e.${colunaOrdem} ASC`;
    }
  }

  let paginacao = "";

  if (pagina && totalPagina) {
    paginacao = ` LIMIT ${totalPagina} OFFSET (${pagina} - 1)*${totalPagina}`;
  }

  const sql = `SELECT p.uuid, p.nome AS produto, a.nome AS arquivo, a.extensao, 
  a.tamanho_mb, p.data_produto, tp.nome AS tipo_produto
  FROM acervo.produto AS p
  INNER JOIN acervo.arquivo AS a ON a.produto_id = p.id
  INNER JOIN acervo.tipo_produto AS tp ON tp.id = p.tipo_produto_id
  ${where} ${sort} ${paginacao}`;

  const arquivos = await db.conn.any(sql);

  const result = { arquivos };

  result.total = arquivos.length;

  return result;
};

controller.getPathDownload = async arquivosId => {
  return db.conn.any(
    `SELECT a.id, va.volume || '/' || a.nome || '.' || a.extensao AS path, a.tamanho_mb
    FROM acervo.arquivo AS a
    INNER JOIN acervo.volume_armazenamento AS va ON va.id = a.volume_armazenamento_id
    WHERE a.id IN ($<arquivosId:csv>)`,
    { arquivosId }
  );
};

controller.getMvtProduto = async (tipoProduto, x, y, z) => {
  return db.conn.one(
    `
  SELECT ST_AsMVT(q, 'produto_mvt', 4096, 'geom')
    FROM (
      SELECT
          p.id, p.uuid, p.nome, p.mi, p.inom, p.data_produto, p.denominador_escala,
          p.orgao_produtor, p.observacao, sb.nome AS situacao_bdgex,
          ST_AsMVTGeom(
              p.geom
              BBox($<x>, $<y>, $<z>),
              4096,
              0,
              false
          ) AS geom
      FROM acervo.produto AS p
      INNER JOIN dominio.situacao_bdgex AS sb ON sb.code = p.situacao_bdgex_id
      WHERE p.tipo_produto_id = $<tipoProduto>
      AND p.geom && BBox($<x>, $<y>, $<z>)
      AND ST_Intersects(p.geom, BBox($<x>, $<y>, $<z>))
    ) q
  `,
    { tipoProduto, x, y, z }
  );
};

module.exports = controller;
