// Path: acervo\acervo_ctrl.js
"use strict";
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { db, refreshViews } = require("../database");
const { AppError, httpCode } = require("../utils");
const { v4: uuidv4 } = require('uuid');
const { version } = require('os');

const {
  DB_USER,
  DB_PASSWORD,
  DB_SERVER,
  DB_PORT,
  DB_NAME
} = require('../config')

const controller = {};

controller.getProdutosLayer = async () => {
  return db.conn.task(async t => {
    const query = `
      SELECT 
          mv.matviewname,
          tp.nome AS tipo_produto,
          te.nome AS tipo_escala
      FROM pg_matviews mv
      JOIN dominio.tipo_produto tp 
          ON SUBSTRING(mv.matviewname FROM 'mv_produto_(\\d+)_') = tp.code::text
      JOIN dominio.tipo_escala te 
          ON SUBSTRING(mv.matviewname FROM '_([^_]+)$') = te.code::text
      WHERE mv.schemaname = 'acervo' 
        AND mv.matviewname LIKE 'mv_produto_%'
      ORDER BY tp.code, te.code;
    `;
    
    const views = await t.any(query);
    
    const banco_dados = {
      nome_db: DB_NAME,
      servidor: DB_SERVER,
      porta: DB_PORT,
      login: DB_USER,
      senha: DB_PASSWORD
    };

    const resultWithCounts = await Promise.all(views.map(async view => {
      const countQuery = `
        SELECT COUNT(*) AS quantidade_produtos
        FROM acervo.${view.matviewname};
      `;
      const countResult = await t.one(countQuery);
      
      return {
        matviewname: view.matviewname,
        tipo_produto: view.tipo_produto,
        tipo_escala: view.tipo_escala,
        quantidade_produtos: parseInt(countResult.quantidade_produtos),
        banco_dados: banco_dados
      };
    }));

    return resultWithCounts;
  });
};

controller.getProdutoById = async produtoId => {
  return db.conn.task(async t => {
    const result = await t.one(`
      WITH newest_version AS (
        SELECT v.id AS versao_id, v.versao, v.nome AS nome_versao, tv.nome AS tipo_versao, sp.nome AS subtipo_produto, v.metadado, v.descricao AS descricao_versao, v.data_criacao, v.data_edicao
        FROM acervo.versao v
        INNER JOIN dominio.tipo_versao AS tv ON tv.code = v.tipo_versao_id
        INNER JOIN dominio.subtipo_produto AS sp ON sp.code = v.subtipo_produto_id
        WHERE v.produto_id = $1
        ORDER BY v.data_edicao DESC
        LIMIT 1
      ),
      all_versions AS (
        SELECT COUNT(*) as num_versoes
        FROM acervo.versao
        WHERE produto_id = $1
      ),
      all_files AS (
        SELECT 
          COUNT(*) as total_num_files,
          COALESCE(SUM(a.tamanho_mb) / 1024, 0) AS total_size_gb
        FROM acervo.arquivo a
        JOIN acervo.versao v ON a.versao_id = v.id
        WHERE v.produto_id = $1
      ),
      newest_version_files AS (
        SELECT 
          COUNT(*) as newest_num_files,
          COALESCE(SUM(a.tamanho_mb) / 1024, 0) AS newest_size_gb
        FROM acervo.arquivo a
        JOIN newest_version nv ON a.versao_id = nv.id
      ),
      relacionamentos AS (
        SELECT 
          ARRAY_AGG(DISTINCT 
            jsonb_build_object(
              'versao_relacionada_id', CASE WHEN vr.versao_id_1 = nv.id THEN vr.versao_id_2 ELSE vr.versao_id_1 END,
              'tipo_relacionamento', tr.nome
            )
          ) as relacionamentos
        FROM newest_version nv
        LEFT JOIN acervo.versao_relacionamento vr ON nv.id = vr.versao_id_1 OR nv.id = vr.versao_id_2
        LEFT JOIN dominio.tipo_relacionamento tr ON vr.tipo_relacionamento_id = tr.code
      )
      SELECT 
        p.id AS produto_id, p.nome AS nome_produto, p.mi, p.inom, te.nome AS escala, p.denominador_escala_especial, p.descricao AS descricao_produto,
        p.geom, tp.nome AS tipo_produto,
        p.data_cadastramento, u1.nome AS usuario_cadastramento,
        p.data_modificacao, u2.nome AS usuario_modificacao,
        nv.versao_id, nv.versao, nv.nome_versao, nv.tipo_versao, nv.metadado, nv.descricao_versao, nv.data_criacao, nv.data_edicao,
        l.nome AS lote_nome,
        l.pit AS lote_pit,
        pr.nome AS projeto_nome,
        av.num_versoes,
        af.total_num_files,
        af.total_size_gb,
        nvf.newest_num_files,
        nvf.newest_size_gb,
        r.relacionamentos,
        ARRAY(
          SELECT jsonb_build_object(
            'id', a.id,
            'nome', a.nome,
            'tamanho_mb', a.tamanho_mb,
            'tipo_arquivo', ta.nome
          )
          FROM acervo.arquivo a
          JOIN dominio.tipo_arquivo ta ON a.tipo_arquivo_id = ta.code
          WHERE a.versao_id = nv.id
        ) AS arquivos
      FROM acervo.produto p
      INNER JOIN dominio.tipo_escala AS te ON te.code = p.tipo_escala_id
      INNER JOIN dgeo.usuario AS u1 ON u1.uuid = p.usuario_cadastramento_uuid
      INNER JOIN dgeo.usuario AS u2 ON u2.uuid = p.usuario_modificacao_uuid
      INNER JOIN dominio.tipo_produto AS tp ON tp.code = p.tipo_produto_id
      INNER JOIN newest_version nv ON p.id = nv.produto_id
      LEFT JOIN acervo.lote l ON nv.lote_id = l.id
      LEFT JOIN acervo.projeto pr ON l.projeto_id = pr.id
      CROSS JOIN all_versions av
      CROSS JOIN all_files af
      CROSS JOIN newest_version_files nvf
      CROSS JOIN relacionamentos r
      WHERE p.id = $1
    `, [produtoId]);

    return result;
  });
};

controller.getProdutoDetailedById = async produtoId => {
  return db.conn.task(async t => {
    // Primeiro, obter informações básicas do produto
    const produto = await t.one(`
      SELECT 
        p.id,
        p.nome,
        p.mi,
        p.inom,
        te.nome AS escala,
        p.denominador_escala_especial,
        p.tipo_produto_id,
        p.descricao,
        p.data_cadastramento, 
        u1.nome AS usuario_cadastramento,
        p.data_modificacao, 
        u2.nome AS usuario_modificacao,
        p.geom
      FROM acervo.produto p
      INNER JOIN dominio.tipo_escala AS te ON te.code = p.tipo_escala_id
      INNER JOIN dgeo.usuario AS u1 ON u1.uuid = p.usuario_cadastramento_uuid
      INNER JOIN dgeo.usuario AS u2 ON u2.uuid = p.usuario_modificacao_uuid
      WHERE p.id = $1
    `, [produtoId]);

    // Obter todas as versões do produto com seus relacionamentos e arquivos
    const versoes = await t.any(`
      SELECT 
        v.id AS versao_id,
        v.uuid_versao,
        v.versao,
        v.nome as nome_versao,
        v.tipo_versao_id,
        v.subtipo_produto_id,
        v.lote_id,
        v.metadado AS versao_metadado,
        v.descricao AS versao_descricao,
        v.data_criacao AS versao_data_criacao,
        v.data_edicao AS versao_data_edicao,
        v.data_cadastramento AS versao_data_cadastramento,
        v.usuario_cadastramento_uuid AS versao_usuario_cadastramento_uuid,
        v.data_modificacao AS versao_data_modificacao,
        v.usuario_modificacao_uuid AS versao_usuario_modificacao_uuid,
        l.nome AS lote_nome,
        l.pit AS lote_pit,
        pr.nome AS projeto_nome
      FROM acervo.versao v
      LEFT JOIN acervo.lote l ON v.lote_id = l.id
      LEFT JOIN acervo.projeto pr ON l.projeto_id = pr.id
      WHERE v.produto_id = $1
    `, [produtoId]);

    // Para cada versão, obter seus relacionamentos e arquivos
    for (const versao of versoes) {
      // Obter relacionamentos
      versao.relacionamentos = await t.any(`
        SELECT 
          CASE WHEN vr.versao_id_1 = $1 THEN vr.versao_id_2 ELSE vr.versao_id_1 END AS versao_relacionada_id,
          tr.nome AS tipo_relacionamento
        FROM acervo.versao_relacionamento vr
        LEFT JOIN dominio.tipo_relacionamento tr ON vr.tipo_relacionamento_id = tr.code
        WHERE vr.versao_id_1 = $1 OR vr.versao_id_2 = $1
      `, [versao.versao_id]);

      // Obter arquivos
      versao.arquivos = await t.any(`
        SELECT 
          a.id,
          a.uuid_arquivo,
          a.nome,
          a.nome_arquivo,
          a.tipo_arquivo_id,
          a.volume_armazenamento_id,
          a.extensao,
          a.tamanho_mb,
          a.checksum,
          a.metadado,
          a.tipo_status_id,
          a.situacao_bdgex_id,
          a.orgao_produtor,
          a.descricao,
          a.data_cadastramento,
          a.usuario_cadastramento_uuid,
          a.data_modificacao,
          a.usuario_modificacao_uuid,
          ta.nome AS tipo_arquivo
        FROM acervo.arquivo a
        LEFT JOIN dominio.tipo_arquivo ta ON a.tipo_arquivo_id = ta.code
        WHERE a.versao_id = $1
      `, [versao.versao_id]);
    }

    // Combinar os resultados
    produto.versoes = versoes;

    return produto;
  });
};

controller.downloadInfo = async (arquivosIds, usuarioUuid) => {
  const cs = new db.pgp.helpers.ColumnSet([
    "arquivo_id",
    "usuario_uuid",
    { name: "data_download", mod: ":raw", init: () => "NOW()" }
  ]);

  const usuario = await db.oneOrNone(
    "SELECT uuid FROM dgeo.usuario WHERE uuid = $<uuid>",
    { usuarioUuid }
  );

  if (!usuario) {
    throw new AppError("Usuário não encontrado", httpCode.NotFound);
  }

  // Check if all arquivoIds exist in the database
  const existingArquivos = await db.conn.any(
    `SELECT id FROM acervo.arquivo WHERE id IN ($<arquivoIds:csv>)`,
    { arquivoIds }
  );

  if (existingArquivos.length !== arquivoIds.length) {
    throw new AppError("Um ou mais IDs de arquivo não existem", httpCode.NotFound);
  }

  const downloads = arquivosIds.map(id => ({
    arquivo_id: id,
    usuario_uuid: usuario.uuid
  }));

  const query = db.pgp.helpers.insert(downloads, cs, {
    table: "download",
    schema: "acervo"
  });

  await db.conn.none(query);

  const filePaths = await db.conn.any(
    `
    SELECT
      a.id AS arquivo_id,
      CONCAT(v.volume, '/', a.nome_arquivo, '.', a.extensao) AS file_path
    FROM
      acervo.arquivo AS a
      INNER JOIN acervo.volume_armazenamento AS v ON a.volume_armazenamento_id = v.id
    WHERE
      a.id IN ($<arquivosIds:csv>)
    `,
    { arquivosIds }
  );

  return filePaths.map(file => ({
    arquivo_id: file.arquivo_id,
    download_path: file.file_path
  }));
};

controller.downloadInfoByProdutos = async (produtosIds, usuarioUuid) => {
  const usuario = await db.oneOrNone(
    "SELECT uuid FROM dgeo.usuario WHERE uuid = $<usuarioUuid>",
    { usuarioUuid }
  );

  if (!usuario) {
    throw new AppError("Usuário não encontrado", httpCode.NotFound);
  }

  // Get the newest versao for each produto and its associated arquivos
  const newestVersionsWithFiles = await db.conn.any(
    `
    WITH newest_versions AS (
      SELECT v.produto_id, v.id AS versao_id
      FROM acervo.versao v
      INNER JOIN (
        SELECT produto_id, MAX(data_edicao) AS max_data_edicao
        FROM acervo.versao
        WHERE produto_id IN ($<produtosIds:csv>)
        GROUP BY produto_id
      ) latest ON v.produto_id = latest.produto_id AND v.data_edicao = latest.max_data_edicao
    )
    SELECT a.id AS arquivo_id, a.nome_arquivo, a.extensao, va.volume
    FROM newest_versions nv
    JOIN acervo.arquivo a ON a.versao_id = nv.versao_id
    JOIN acervo.volume_armazenamento va ON a.volume_armazenamento_id = va.id
    WHERE a.tipo_arquivo_id = 1
    `,
    { produtosIds }
  );

  if (newestVersionsWithFiles.length === 0) {
    throw new AppError("Nenhum arquivo encontrado para os produtos especificados", httpCode.NotFound);
  }

  // Prepare download entries
  const cs = new db.pgp.helpers.ColumnSet([
    "arquivo_id",
    "usuario_uuid",
    { name: "data_download", mod: ":raw", init: () => "NOW()" }
  ]);

  const downloads = newestVersionsWithFiles.map(file => ({
    arquivo_id: file.arquivo_id,
    usuario_uuid: usuario.uuid
  }));

  // Insert download entries
  const query = db.pgp.helpers.insert(downloads, cs, {
    table: "download",
    schema: "acervo"
  });

  await db.conn.none(query);

  // Prepare file paths for response
  const filePaths = newestVersionsWithFiles.map(file => ({
    arquivo_id: file.arquivo_id,
    download_path: `${file.volume}/${file.nome_arquivo}.${file.extensao}`
  }));

  return filePaths;
};

controller.criaVersaoHistorica = async (versoes, usuarioUuid) => {
  const data_cadastramento = new Date();

  const versoesPreparadas = versoes.map(versao => {
    return {
      ...versao,
      uuid_versao: versao.uuid_versao || uuidv4(),
      data_cadastramento: data_cadastramento,
      usuario_cadastramento_uuid: usuarioUuid,
      tipo_versao: 2, // Registro Histórico
    };
  });

  const versoesId = versoes.map(versao => versao.id)

  return db.conn.tx(async t => {
    const cs = new db.pgp.helpers.ColumnSet([
      'uuid_versao', 'versao', 'produto_id', 'lote_id', 'metadado', 'descricao',
      'data_criacao', 'data_edicao', 'tipo_versao', 'subtipo_produto_id', 'data_cadastramento', 'usuario_cadastramento_uuid'
    ], { table: 'versao', schema: 'acervo' });

    const query = db.pgp.helpers.insert(versoesPreparadas, cs);

    await t.none(query);

    await refreshViews.atualizarViewsPorVersoes(t, versoesId);
  });
};

controller.criaProdutoVersoesHistoricas = async (produtos, usuarioUuid) => {
  const data_cadastramento = new Date();

  return db.conn.tx(async t => {
    const produtosIds = []

    for (const produto of produtos) {
      // Inserir o produto
      const [novoProduto] = await t.any(`
        INSERT INTO acervo.produto(nome, mi, inom, tipo_escala_id, denominador_escala_especial, tipo_produto_id, descricao, geom, data_cadastramento, usuario_cadastramento_uuid)
        VALUES($1, $2, $3, $4, $5, $6, ST_GeomFromGeoJSON($7), $8, $9)
        RETURNING id
      `, [produto.nome, produto.mi, produto.inom, produto.tipo_escala_id, produto.denominador_escala_especial, produto.tipo_produto_id, produto.descricao, produto.geom, data_cadastramento, usuarioUuid]);

      produtosIds.push(novoProduto.id)

      // Preparar e inserir as versões
      const versoesPreparadas = produto.versoes.map(versao => ({
        ...versao,
        uuid_versao: versao.uuid_versao || uuidv4(),
        produto_id: novoProduto.id,
        data_cadastramento: data_cadastramento,
        usuario_cadastramento_uuid: usuarioUuid,
        tipo_versao_id: 2 // Registro Histórico
      }));

      const cs = new db.pgp.helpers.ColumnSet([
        'uuid_versao', 'versao', 'produto_id', 'lote_id', 'metadado', 'descricao',
        'data_criacao', 'data_edicao', 'tipo_versao_id', 'subtipo_produto_id', 'data_cadastramento', 'usuario_cadastramento_uuid'
      ], { table: 'versao', schema: 'acervo' });

      const query = db.pgp.helpers.insert(versoesPreparadas, cs);
      await t.none(query);
    }

    await refreshViews.atualizarViewsPorProdutos(t, produtosIds);
  });
};

controller.bulkCreateProducts = async (produtos, usuarioUuid) => {
  produtos.forEach(produto => {
    produto.data_cadastramento = new Date();
    produto.usuario_cadastramento_uuid = usuarioUuid;
    produto.geom = `ST_GeomFromEWKT('${produto.geom}')`;
  });

  return db.conn.tx(async t => {
    const cs = new db.pgp.helpers.ColumnSet([
      'nome', 'mi', 'inom', 'tipo_escala_id', 'denominador_escala_especial', 'tipo_produto_id', 'descricao',
      'usuario_cadastramento_uuid',
      {name: 'data_cadastramento', cast: 'date'},
      {name: 'geom', mod: ':raw'}
    ]);

    const query = db.pgp.helpers.insert(produtos, cs, {
      table: 'produto',
      schema: 'acervo'
    });

    await t.none(query);
  });
};

module.exports = controller;
