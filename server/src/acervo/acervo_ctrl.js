'use strict'

const { db } = require('../database')

const controller = {}

controller.getTipoProduto = async () => {
  return db.conn.any(
    `SELECT id, nome
    FROM acervo.tipo_produto`
  )
}

controller.getEstilo = async () => {
  return db.conn.oneOrNone(
    'SELECT * FROM public.layer_styles LIMIT 1'
  )
}

controller.getPathDownload = async arquivosId => {
  return db.conn.any(
    `SELECT a.id, va.volume || '/' || a.path_relativo AS path, a.tamanho_mb
    FROM acervo.arquivo AS a
    INNER JOIN acervo.volume_armazenamento AS va ON va.id = a.volume_armazenamento_id
    WHERE a.id IN ($<arquivosId:csv>)`, { arquivosId }
  )
}

controller.getMvtProduto = async (tipoProduto, x, y, z) => {
  return db.conn.one(
    `
  SELECT ST_AsMVT(q, 'produto_mvt', 4096, 'geom')
    FROM (
      SELECT
          p.nome, p.mi, p.inom, p.data_produto, p.denominador_escala,
          p.orgao_produtor, p.observacao, sb.nome AS situacao_bdgex
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
  )
}

module.exports = controller
