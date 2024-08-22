"use strict";

const { db } = require("../database");
const { AppError, httpCode } = require("../utils");
const { v4: uuidv4 } = require('uuid');

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
      d.usuario_uuid,
      d.data_download,
      false AS apagado
    FROM acervo.download d
    UNION ALL
    SELECT 
      dd.id,
      dd.arquivo_deletado_id AS arquivo_id,
      dd.usuario_uuid,
      dd.data_download,
      true AS apagado
    FROM acervo.download_deletado dd
    `
  );
}

controller.getTipoProduto = async () => {
  return db.conn.any(`
    SELECT tp.code, tp.nome, COUNT(p.id) AS num_produtos
    FROM dominio.tipo_produto AS tp
    LEFT JOIN acervo.produto p ON tp.code = p.tipo_produto_id
    GROUP BY tp.code, tp.nome
    ORDER BY num_produtos DESC;
    `);
};

controller.getProdutosByTipo = async (tipoId, projetoId = null, loteId = null) => {
  return db.sapConn.task(async t => {
    let query = `
      SELECT p.id, p.nome, p.mi, p.inom, p.denominador_escala, p.descricao,
             p.geom, tp.nome AS tipo_produto
             p.data_cadastramento, u1.nome AS usuario_cadastramento
             p.data_modificacao, u2.nome AS usuario_modificacao
             COUNT(DISTINCT v.id) AS num_versoes,
             MAX(v.data_criacao) AS data_criacao_recente,
             MAX(v.data_edicao) AS data_edicao_recente,
             ARRAY(
               SELECT DISTINCT EXTRACT(YEAR FROM v2.data_criacao)::integer
               FROM acervo.versao v2
               WHERE v2.produto_id = p.id
               ORDER BY EXTRACT(YEAR FROM v2.data_criacao) DESC
             ) AS anos_criacao,
             ARRAY(
               SELECT DISTINCT EXTRACT(YEAR FROM v2.data_edicao)::integer
               FROM acervo.versao v2
               WHERE v2.produto_id = p.id
               ORDER BY EXTRACT(YEAR FROM v2.data_edicao) DESC
             ) AS anos_edicao,
             COUNT(DISTINCT a.id) AS num_arquivos,
             COALESCE(SUM(a.tamanho_mb) / 1024, 0) AS tamanho_total_gb
      FROM acervo.produto p
      INNER JOIN dgeo.usuario AS u1 ON u1.uuid = p.usuario_cadastramento_uuid
      INNER JOIN dgeo.usuario AS u2 ON u2.uuid = p.usuario_modificacao_uuid
      INNER JOIN dominio.tipo_produto AS tp ON tp.code = p.tipo_produto_id
      LEFT JOIN acervo.versao v ON p.id = v.produto_id
      LEFT JOIN acervo.arquivo a ON v.id = a.versao_id
      WHERE p.tipo_produto_id = $1
    `;

    const queryParams = [tipoId];
    let paramCount = 1;

    if (projetoId !== null) {
      paramCount++;
      query += ` AND v.projeto_id = $${paramCount}`;
      queryParams.push(projetoId);
    }

    if (loteId !== null) {
      paramCount++;
      query += ` AND v.lote_id = $${paramCount}`;
      queryParams.push(loteId);
    }

    query += ` GROUP BY p.id`;

    const produtos = await t.any(query, queryParams);

    return produtos;
  });
};

controller.getProdutoById = async produtoId => {
  return db.sapConn.task(async t => {
    const result = await t.one(`
      WITH newest_version AS (
        SELECT v.id AS versao_id, tv.nome AS tipo_versao, v.metadado, v.descricao AS descricao_versao, v.data_criacao, v.data_edicao
        FROM acervo.versao v
        INNER JOIN dominio.tipo_versao AS tv ON tv.code = v.tipo_versao_id
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
        p.id AS produto_id, p.nome AS produto, p.mi, p.inom, p.denominador_escala, p.descricao AS descricao_produto,
        p.geom, tp.nome AS tipo_produto
        p.data_cadastramento, u1.nome AS usuario_cadastramento,
        p.data_modificacao, u2.nome AS usuario_modificacao,
        nv.*,
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
  return db.sapConn.task(async t => {
    const result = await t.one(`
      WITH versoes AS (
        SELECT 
          v.id AS versao_id,
          v.uuid_versao,
          v.versao,
          v.tipo_versao_id,
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
          pr.nome AS projeto_nome,
          ARRAY_AGG(DISTINCT 
            jsonb_build_object(
              'versao_relacionada_id', CASE WHEN vr.versao_id_1 = v.id THEN vr.versao_id_2 ELSE vr.versao_id_1 END,
              'tipo_relacionamento', tr.nome
            )
          ) as relacionamentos,
          ARRAY_AGG(DISTINCT 
            jsonb_build_object(
              'id', a.id,
              'uuid_arquivo', a.uuid_arquivo,
              'nome', a.nome,
              'nome_arquivo', a.nome_arquivo,
              'tipo_arquivo_id', a.tipo_arquivo_id,
              'volume_armazenamento_id', a.volume_armazenamento_id,
              'extensao', a.extensao,
              'tamanho_mb', a.tamanho_mb,
              'checksum', a.checksum,
              'metadado', a.metadado,
              'tipo_status_id', a.tipo_status_id,
              'situacao_bdgex_id', a.situacao_bdgex_id,
              'orgao_produtor', a.orgao_produtor,
              'descricao', a.descricao,
              'data_cadastramento', a.data_cadastramento,
              'usuario_cadastramento_uuid', a.usuario_cadastramento_uuid,
              'data_modificacao', a.data_modificacao,
              'usuario_modificacao_uuid', a.usuario_modificacao_uuid,
              'tipo_arquivo', ta.nome
            )
          ) AS arquivos
        FROM acervo.versao v
        LEFT JOIN acervo.lote l ON v.lote_id = l.id
        LEFT JOIN acervo.projeto pr ON l.projeto_id = pr.id
        LEFT JOIN acervo.versao_relacionamento vr ON v.id = vr.versao_id_1 OR v.id = vr.versao_id_2
        LEFT JOIN dominio.tipo_relacionamento tr ON vr.tipo_relacionamento_id = tr.code
        LEFT JOIN acervo.arquivo a ON v.id = a.versao_id
        LEFT JOIN dominio.tipo_arquivo ta ON a.tipo_arquivo_id = ta.code
        WHERE v.produto_id = $1
        GROUP BY v.id, l.id, pr.id
      )
      SELECT 
        p.id,
        p.nome,
        p.mi,
        p.inom,
        p.denominador_escala,
        p.tipo_produto_id,
        p.descricao,
        p.data_cadastramento, u1.nome AS usuario_cadastramento
        p.data_modificacao, u2.nome AS usuario_modificacao,
        p.geom,
        (SELECT json_agg(v.*) FROM versoes v) as versoes
      FROM acervo.produto p
      INNER JOIN dgeo.usuario AS u1 ON u1.uuid = p.usuario_cadastramento_uuid
      INNER JOIN dgeo.usuario AS u2 ON u2.uuid = p.usuario_modificacao_uuid
      INNER JOIN dominio.tipo_produto AS tp ON tp.code = p.tipo_produto_id
      WHERE p.id = $1
    `, [produtoId]);

    return result;
  });
}

controller.downloadInfo = async (arquivosIds, usuarioUuid) => {
  const cs = new db.pgp.helpers.ColumnSet([
    "arquivo_id",
    "usuario_uuid",
    { name: "data_download", mod: ":raw", init: () => "NOW()" }
  ]);

  const usuario = db.oneOrNone(
    "SELECT uuid FROM dgeo.usuario WHERE uuid = $<uuid>",
    { usuarioUuid }
  );

  if (!usuario) {
    throw new AppError("Usuário não encontrado", httpCode.NotFound);
  }

  // Check if all arquivoIds exist in the database
  const existingArquivos = await db.sapConn.any(
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

  const filePaths = await db.sapConn.any(
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
    arquivo_id: arquivo.arquivo_id,
    download_path: arquivo.file_path
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
  const newestVersionsWithFiles = await db.sapConn.any(
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

  await db.sapConn.none(query);

  // Prepare file paths for response
  const filePaths = newestVersionsWithFiles.map(file => ({
    arquivo_id: file.arquivo_id,
    download_path: `${file.volume}/${file.nome_arquivo}.${file.extensao}`
  }));

  return filePaths;
};

controller.getArquivosDeletados = async () => {
  return db.sapConn.any(
    `
    SELECT 
      ad.id, 
      ad.uuid_arquivo, 
      ad.nome, 
      ad.nome_arquivo, 
      ad.motivo_exclusao, 
      ad.versao_id, 
      v.versao AS versao, 
      p.nome AS produto,
      p.mi,
      p.inom,
      p.denominador_escala,
      l.nome AS lote,
      l.pit,
      proj.nome AS projeto,
      ad.tipo_arquivo_id, 
      ta.nome AS tipo_arquivo_nome, 
      ad.volume_armazenamento_id, 
      va.nome AS volume_armazenamento_nome, 
      va.volume AS volume_armazenamento, 
      ad.extensao, 
      ad.tamanho_mb, 
      ad.checksum, 
      ad.metadata, 
      ad.tipo_status_id, 
      ts.nome AS tipo_status_nome, 
      ad.situacao_bdgex_id, 
      sb.nome AS situacao_bdgex_nome, 
      ad.orgao_produtor, 
      ad.descricao, 
      ad.data_cadastramento, 
      ad.usuario_cadastramento_uuid, 
      u.nome AS usuario_cadastramento_nome, 
      ad.data_modificacao, 
      ad.usuario_modificacao_uuid, 
      um.nome AS usuario_modificacao_nome, 
      ad.data_delete, 
      ad.usuario_delete_uuid, 
      ud.nome AS usuario_delete_nome 
    FROM 
      acervo.arquivo_deletado ad
    LEFT JOIN 
      acervo.versao v ON ad.versao_id = v.id
    LEFT JOIN 
      acervo.produto p ON v.produto_id = p.id
    LEFT JOIN 
      acervo.lote l ON v.lote_id = l.id
    LEFT JOIN 
      acervo.projeto proj ON l.projeto_id = proj.id
    LEFT JOIN 
      dominio.tipo_arquivo ta ON ad.tipo_arquivo_id = ta.code
    LEFT JOIN 
      acervo.volume_armazenamento va ON ad.volume_armazenamento_id = va.id
    LEFT JOIN 
      dominio.tipo_status_arquivo ts ON ad.tipo_status_id = ts.code
    LEFT JOIN 
      dominio.situacao_bdgex sb ON ad.situacao_bdgex_id = sb.code
    LEFT JOIN 
      dgeo.usuario u ON ad.usuario_cadastramento_uuid = u.uuid
    LEFT JOIN 
      dgeo.usuario um ON ad.usuario_modificacao_uuid = um.uuid
    LEFT JOIN 
      dgeo.usuario ud ON ad.usuario_delete_uuid = ud.uuid
    ORDER BY 
      ad.data_delete DESC
    LIMIT 50;
    `
  );
};

controller.criaVersaoHistorico = async (versao, usuarioUuid) => {
  versao.data_cadastramento = new Date();
  versao.usuario_cadastramento_uuid = usuarioUuid;
  versao.tipo_versao = 2; //Registro Histórico

  if (!versao.uuid_versao) {
    versao.uuid_versao = uuidv4();
  }

  return db.sapConn.tx(async t => {
    const cs = new db.pgp.helpers.ColumnSet([
      'uuid_versao', 'versao', 'produto_id', 'lote_id', 'metadado', 'descricao',
      'data_criacao', 'data_edicao', 'tipo_versao', 'data_cadastramento', 'usuario_cadastramento_uuid'
    ]);

    const query = db.pgp.helpers.insert(lote, cs, {
      table: 'versao',
      schema: 'acervo'
    });

    await t.none(query);
  });
};

controller.bulkCreateProductsWithVersionAndMultipleFiles = async (produtos, usuarioUuid) => {
  return db.sapConn.tx(async t => {
    for (const item of produtos) {
      const { produto, versao, arquivos } = item;

      // Insert product
      const { id: productId } = await t.one(
        `INSERT INTO acervo.produto(
          nome, mi, inom, denominador_escala, tipo_produto_id, descricao, 
          usuario_cadastramento_uuid, data_cadastramento, geom
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP, ST_GeomFromEWKT($8))
         RETURNING id`,
        [produto.nome, produto.mi, produto.inom, produto.denominador_escala,
         produto.tipo_produto_id, produto.descricao, usuarioUuid, produto.geom]
      );

      if (!versao.uuid_versao) {
        versao.uuid_versao = uuidv4();
      }

      const { id: versionId } = await t.one(
        `INSERT INTO acervo.versao(
          uuid_versao, versao, tipo_versao_id, produto_id, lote_id, metadado, descricao,
          data_criacao, data_edicao, usuario_cadastramento_uuid, data_cadastramento
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP)
         RETURNING id`,
        [versao.uuid_versao, versao.versao, versao.tipo_versao_id, productId,
         versao.lote_id, versao.metadado, versao.descricao, versao.data_criacao,
         versao.data_edicao, usuarioUuid]
      );

      // Get the appropriate volume_armazenamento_id
      const { volume_armazenamento_id } = await t.one(
        `SELECT volume_armazenamento_id 
         FROM acervo.volume_tipo_produto 
         WHERE tipo_produto_id = $1 AND primario = TRUE`,
        [produto.tipo_produto_id]
      );

      // Insert files
      for (const arquivo of arquivos) {
        await t.none(
          `INSERT INTO acervo.arquivo(
            uuid_arquivo, nome, nome_arquivo, versao_id, tipo_arquivo_id,
            volume_armazenamento_id, extensao, tamanho_mb, checksum, metadado,
            tipo_status_id, situacao_bdgex_id, orgao_produtor, descricao,
            usuario_cadastramento_uuid, data_cadastramento
          ) VALUES (uuid_generate_v4(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, CURRENT_TIMESTAMP)`,
          [arquivo.nome, arquivo.nome_arquivo, versionId, arquivo.tipo_arquivo_id,
           volume_armazenamento_id, arquivo.extensao, arquivo.tamanho_mb,
           arquivo.checksum, arquivo.metadado, 1, // tipo_status_id is always 1
           arquivo.situacao_bdgex_id, arquivo.orgao_produtor, arquivo.descricao, usuarioUuid]
        );
      }
    }
  });
}

controller.bulkCreateVersionWithFiles = async (versoes, usuarioUuid) => {
  return db.sapConn.tx(async t => {
    const results = [];

    for (const item of versoes) {
      const { produto_id, versao, arquivos } = item;

      // Check if the product exists
      const productExists = await t.oneOrNone('SELECT id FROM acervo.produto WHERE id = $1', [produto_id]);
      if (!productExists) {
        throw new AppError(`Produto com id ${produto_id} não encontrado`, httpCode.NotFound);
      }

      if (!versao.uuid_versao) {
        versao.uuid_versao = uuidv4();
      }

      const { id: versionId } = await t.one(
        `INSERT INTO acervo.versao(
          uuid_versao, versao, tipo_versao_id, produto_id, lote_id, metadado, descricao,
          data_criacao, data_edicao, usuario_cadastramento_uuid, data_cadastramento
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP)
         RETURNING id`,
        [versao.uuid_versao, versao.versao, versao.tipo_versao_id, produto_id,
         versao.lote_id, versao.metadado, versao.descricao, versao.data_criacao,
         versao.data_edicao, usuarioUuid]
      );

      // Get the appropriate volume_armazenamento_id
      const { volume_armazenamento_id } = await t.one(
        `SELECT vtp.volume_armazenamento_id 
         FROM acervo.volume_tipo_produto vtp
         JOIN acervo.produto p ON p.tipo_produto_id = vtp.tipo_produto_id
         WHERE p.id = $1 AND vtp.primario = TRUE`,
        [produto_id]
      );

      // Insert files
      for (const arquivo of arquivos) {
        await t.none(
          `INSERT INTO acervo.arquivo(
            uuid_arquivo, nome, nome_arquivo, versao_id, tipo_arquivo_id,
            volume_armazenamento_id, extensao, tamanho_mb, checksum, metadado,
            tipo_status_id, situacao_bdgex_id, orgao_produtor, descricao,
            usuario_cadastramento_uuid, data_cadastramento
          ) VALUES (uuid_generate_v4(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, CURRENT_TIMESTAMP)`,
          [arquivo.nome, arquivo.nome_arquivo, versionId, arquivo.tipo_arquivo_id,
           volume_armazenamento_id, arquivo.extensao, arquivo.tamanho_mb,
           arquivo.checksum, arquivo.metadado, 1, // tipo_status_id is always 1
           arquivo.situacao_bdgex_id, arquivo.orgao_produtor, arquivo.descricao, usuarioUuid]
        );
      }

      results.push({ produto_id, versao_id: versionId, versao_uuid: versao.uuid_versao });
    }

    return results;
  });
}

controller.bulkAddFilesToVersion = async (arquivos_por_versao, usuarioUuid) => {
  return db.sapConn.tx(async t => {
    const results = [];

    for (const item of arquivos_por_versao) {
      const { versao_id, arquivos } = item;

      // Check if the version exists and get the associated product_id
      const version = await t.oneOrNone('SELECT id, produto_id FROM acervo.versao WHERE id = $1', [versao_id]);
      if (!version) {
        throw new AppError(`Versão com id ${versao_id} não encontrada`, httpCode.NotFound);
      }

      // Get the appropriate volume_armazenamento_id
      const { volume_armazenamento_id } = await t.one(
        `SELECT vtp.volume_armazenamento_id 
         FROM acervo.volume_tipo_produto vtp
         JOIN acervo.produto p ON p.tipo_produto_id = vtp.tipo_produto_id
         WHERE p.id = $1 AND vtp.primario = TRUE`,
        [version.produto_id]
      );

      // Insert files
      for (const arquivo of arquivos) {
        await t.none(
          `INSERT INTO acervo.arquivo(
            uuid_arquivo, nome, nome_arquivo, versao_id, tipo_arquivo_id,
            volume_armazenamento_id, extensao, tamanho_mb, checksum, metadado,
            tipo_status_id, situacao_bdgex_id, orgao_produtor, descricao,
            usuario_cadastramento_uuid, data_cadastramento
          ) VALUES (uuid_generate_v4(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, CURRENT_TIMESTAMP)`,
          [arquivo.nome, arquivo.nome_arquivo, versao_id, arquivo.tipo_arquivo_id,
           volume_armazenamento_id, arquivo.extensao, arquivo.tamanho_mb,
           arquivo.checksum, arquivo.metadado, 1, // tipo_status_id is always 1
           arquivo.situacao_bdgex_id, arquivo.orgao_produtor, arquivo.descricao, usuarioUuid]
        );
      }

      results.push({ versao_id, arquivos_adicionados: arquivos.length });
    }

    return results;
  });
}

module.exports = controller;
