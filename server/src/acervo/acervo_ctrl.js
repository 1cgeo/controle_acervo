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
            'nome_arquivo', a.nome_arquivo,
            'extensao', a.extensao,
            'volume_armazenamento_id', a.volume_armazenamento_id,
            'tamanho_mb', a.tamanho_mb,
            'checksum', a.checksum,
            'situacao_carregamento_id', a.situacao_carregamento_id,
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
          a.situacao_carregamento_id,
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

controller.prepareDownload = async (arquivosIds, usuarioUuid) => {
  const cs = new db.pgp.helpers.ColumnSet([
    "arquivo_id",
    "usuario_uuid",
    { name: "data_download", mod: ":raw", init: () => "NOW()" },
    { name: "status", init: () => "pending" },
    { name: "download_token", mod: ":raw", init: () => "uuid_generate_v4()" },
    { name: "expiration_time", mod: ":raw", init: () => "NOW() + INTERVAL '24 hours'" }
  ]);

  const usuario = await db.oneOrNone(
    "SELECT uuid FROM dgeo.usuario WHERE uuid = $<uuid>",
    { uuid: usuarioUuid }
  );

  if (!usuario) {
    throw new AppError("Usuário não encontrado", httpCode.NotFound);
  }

  // Check if all arquivoIds exist in the database
  const existingArquivos = await db.conn.any(
    `SELECT id, nome, nome_arquivo, extensao, checksum FROM acervo.arquivo WHERE id IN ($<arquivosIds:csv>)`,
    { arquivosIds }
  );

  if (existingArquivos.length !== arquivosIds.length) {
    throw new AppError("Um ou mais IDs de arquivo não existem", httpCode.NotFound);
  }

  // Create download records with pending status
  const downloads = arquivosIds.map(id => ({
    arquivo_id: id,
    usuario_uuid: usuario.uuid
  }));

  const query = db.pgp.helpers.insert(downloads, cs, {
    table: "download",
    schema: "acervo"
  });

  const result = await db.conn.query(query + " RETURNING download_token");
  
  // Get the download tokens from the result
  const downloadTokens = result.map(row => row.download_token);

  const filePaths = await db.conn.any(
    `
    SELECT
      a.id AS arquivo_id,
      a.nome,
      a.nome_arquivo,
      a.extensao,
      a.checksum,
      CONCAT(v.volume, '/', a.nome_arquivo, '.', a.extensao) AS file_path,
      d.download_token
    FROM
      acervo.arquivo AS a
      INNER JOIN acervo.volume_armazenamento AS v ON a.volume_armazenamento_id = v.id
      INNER JOIN acervo.download AS d ON a.id = d.arquivo_id
    WHERE
      a.id IN ($<arquivosIds:csv>)
      AND d.download_token IN ($<downloadTokens:csv>)
    `,
    { arquivosIds, downloadTokens }
  );

  return filePaths.map(file => ({
    arquivo_id: file.arquivo_id,
    nome: file.nome,
    download_path: file.file_path,
    checksum: file.checksum,
    download_token: file.download_token
  }));
};

controller.confirmDownload = async (downloadConfirmations) => {
  return db.conn.tx(async t => {
    const results = [];

    for (const confirmation of downloadConfirmations) {
      const { download_token, success, error_message } = confirmation;
      
      // Find the download record
      const download = await t.oneOrNone(
        `SELECT d.id, d.arquivo_id, a.nome 
         FROM acervo.download d 
         JOIN acervo.arquivo a ON d.arquivo_id = a.id
         WHERE d.download_token = $1 AND d.status = 'pending'`,
        [download_token]
      );
      
      if (!download) {
        results.push({
          download_token,
          status: 'error',
          message: 'Download record not found or already processed'
        });
        continue;
      }
      
      // Update the download status
      await t.none(
        `UPDATE acervo.download 
         SET status = $1, 
             error_message = $2
         WHERE download_token = $3`,
        [success ? 'completed' : 'failed', error_message || null, download_token]
      );
      
      results.push({
        download_token,
        arquivo_id: download.arquivo_id,
        nome: download.nome,
        status: success ? 'completed' : 'failed'
      });
    }
    
    return results;
  });
};

controller.prepareDownloadByProdutos = async (produtosIds, usuarioUuid) => {
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
    SELECT a.id AS arquivo_id, a.nome, a.nome_arquivo, a.extensao, a.checksum, va.volume
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
    { name: "data_download", mod: ":raw", init: () => "NOW()" },
    { name: "status", init: () => "pending" },
    { name: "download_token", mod: ":raw", init: () => "uuid_generate_v4()" },
    { name: "expiration_time", mod: ":raw", init: () => "NOW() + INTERVAL '24 hours'" }
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

  const result = await db.conn.query(query + " RETURNING arquivo_id, download_token");
  
  // Map the download tokens to files
  const tokenMap = {};
  result.forEach(row => {
    tokenMap[row.arquivo_id] = row.download_token;
  });

  // Prepare file paths for response
  const filePaths = newestVersionsWithFiles.map(file => ({
    arquivo_id: file.arquivo_id,
    nome: file.nome,
    download_path: `${file.volume}/${file.nome_arquivo}.${file.extensao}`,
    checksum: file.checksum,
    download_token: tokenMap[file.arquivo_id]
  }));

  return filePaths;
};

// Cleanup function that can be called by a scheduled job
controller.cleanupExpiredDownloads = async () => {
  return db.conn.none(`SELECT acervo.cleanup_expired_downloads()`);
};

module.exports = controller;
