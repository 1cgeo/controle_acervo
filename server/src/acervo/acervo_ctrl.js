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
        (SELECT COUNT(*) FROM acervo.produto WHERE tipo_produto_id = tp.code) AS quantidade_produtos
      FROM pg_matviews mv
      JOIN dominio.tipo_produto tp ON mv.matviewname = 'mv_produtos_tipo_' || tp.code
      WHERE mv.schemaname = 'acervo' AND mv.matviewname LIKE 'mv_produtos_tipo_%'
      ORDER BY tp.code
    `;
    
    const result = await t.any(query);
    
    const banco_dados = {
      nome_db: DB_NAME,
      servidor: DB_SERVER,
      porta: DB_PORT,
      login: DB_USER,
      senha: DB_PASSWORD
    }

    return result.map(row => ({
      matviewname: row.matviewname,
      tipo_produto: row.tipo_produto,
      quantidade_produtos: parseInt(row.quantidade_produtos),
      banco_dados: banco_dados
    }));
  });
};

controller.getProdutoById = async produtoId => {
  return db.conn.task(async t => {
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
  return db.conn.task(async t => {
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
      'data_criacao', 'data_edicao', 'tipo_versao', 'data_cadastramento', 'usuario_cadastramento_uuid'
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
        INSERT INTO acervo.produto(nome, mi, inom, denominador_escala, tipo_produto_id, descricao, geom, data_cadastramento, usuario_cadastramento_uuid)
        VALUES($1, $2, $3, $4, $5, $6, ST_GeomFromGeoJSON($7), $8, $9)
        RETURNING id
      `, [produto.nome, produto.mi, produto.inom, produto.denominador_escala, produto.tipo_produto_id, produto.descricao, produto.geom, data_cadastramento, usuarioUuid]);

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
        'data_criacao', 'data_edicao', 'tipo_versao_id', 'data_cadastramento', 'usuario_cadastramento_uuid'
      ], { table: 'versao', schema: 'acervo' });

      const query = db.pgp.helpers.insert(versoesPreparadas, cs);
      await t.none(query);
    }

    await refreshViews.atualizarViewsPorProdutos(t, produtosIds);
  });
};

controller.bulkCreateProductsWithVersionAndMultipleFiles = async (produtos, usuarioUuid) => {
  return db.conn.tx(async t => {
    const produtosId = []
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

      produtosId.push(productId)

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
      const volumeTipoProduto = await t.oneOrNone(
        `SELECT volume_armazenamento_id 
         FROM acervo.volume_tipo_produto 
         WHERE tipo_produto_id = $1 AND primario = TRUE`,
        [produto.tipo_produto_id]
      );

      if (!volumeTipoProduto) {
        throw new AppError(`Não existe volume_tipo_produto primário cadastrado para o tipo de produto ${produto.tipo_produto_id}`, httpCode.NotFound);
      }

      const volume_armazenamento_id = volumeTipoProduto.volume_armazenamento_id;

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

    await refreshViews.atualizarViewsPorProdutos(t, produtosId);

  });
}

controller.bulkCreateVersionWithFiles = async (versoes, usuarioUuid) => {
  return db.conn.tx(async t => {
    const versoesId = [];

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
      versoesId.push(versionId)

      // Check if volume_tipo_produto exists
      const volumeTipoProduto = await t.oneOrNone(
        `SELECT volume_armazenamento_id 
         FROM acervo.volume_tipo_produto 
         WHERE tipo_produto_id = $1 AND primario = TRUE`,
        [product.tipo_produto_id]
      );

      if (!volumeTipoProduto) {
        throw new AppError(`Não existe volume_tipo_produto primário cadastrado para o tipo de produto do produto ${produto_id}`, httpCode.NotFound);
      }

      const volume_armazenamento_id = volumeTipoProduto.volume_armazenamento_id;

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

    await refreshViews.atualizarViewsPorVersoes(t, versoesId);
  });
}

controller.bulkAddFilesToVersion = async (arquivos_por_versao, usuarioUuid) => {
  return db.conn.tx(async t => {
    const versoesIds = [];

    for (const item of arquivos_por_versao) {
      const { versao_id, arquivos } = item;
      versoesIds.push(versao_id)

      // Check if the version exists and get the associated product_id
      const version = await t.oneOrNone('SELECT id, produto_id FROM acervo.versao WHERE id = $1', [versao_id]);
      if (!version) {
        throw new AppError(`Versão com id ${versao_id} não encontrada`, httpCode.NotFound);
      }

      // Check if volume_tipo_produto exists
      const volumeTipoProduto = await t.oneOrNone(
        `SELECT volume_armazenamento_id 
         FROM acervo.volume_tipo_produto 
         WHERE tipo_produto_id = $1 AND primario = TRUE`,
        [version.tipo_produto_id]
      );

      if (!volumeTipoProduto) {
        throw new AppError(`Não existe volume_tipo_produto primário cadastrado para o tipo de produto da versão ${versao_id}`, httpCode.NotFound);
      }

      const volume_armazenamento_id = volumeTipoProduto.volume_armazenamento_id;

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
    }
    await refreshViews.atualizarViewsPorArquivos(t, versoesIds);

  });
}

controller.verificarConsistencia = async () => {
  return db.conn.tx(async t => {
    const arquivos = await t.any(`
      SELECT a.id, a.nome_arquivo, a.checksum, a.extensao, v.volume
      FROM acervo.arquivo a
      JOIN acervo.volume_armazenamento v ON a.volume_armazenamento_id = v.id
      WHERE a.tipo_arquivo_id != 9
    `);

    const arquivosDeletados = await t.any(`
      SELECT ad.id, ad.nome_arquivo, ad.extensao, v.volume
      FROM acervo.arquivo_deletado ad
      JOIN acervo.volume_armazenamento v ON ad.volume_armazenamento_id = v.id
    `);

    const arquivosParaAtualizar = [];
    const arquivosDeletadosParaAtualizar = [];

    // Check existing files
    for (const arquivo of arquivos) {
      const filePath = path.join(arquivo.volume, arquivo.nome_arquivo + arquivo.extensao);

      try {
        await fs.access(filePath);
        const fileBuffer = await fs.readFile(filePath);
        const calculatedChecksum = crypto
          .createHash('sha256')
          .update(fileBuffer)
          .digest('hex');

        if (calculatedChecksum !== arquivo.checksum) {
          arquivosParaAtualizar.push(arquivo.id);
        }
      } catch (error) {
        arquivosParaAtualizar.push(arquivo.id);
      }
    }

    // Check deleted files
    for (const arquivoDeletado of arquivosDeletados) {
      const deletedFilePath = path.join(arquivoDeletado.volume, arquivoDeletado.nome_arquivo + arquivoDeletado.extensao);

      try {
        await fs.access(deletedFilePath);
        // File exists, check if it's associated with an existing arquivo
        const existingArquivo = await t.oneOrNone(`
          SELECT a.id 
          FROM acervo.arquivo a
          JOIN acervo.volume_armazenamento v ON a.volume_armazenamento_id = v.id
          WHERE concat(v.volume, a.nome_arquivo, a.extensao) = $1
        `, [deletedFilePath]);

        if (!existingArquivo) {
          arquivosDeletadosParaAtualizar.push(arquivoDeletado.id);
        }
      } catch (error) {
        // File doesn't exist, which is expected for deleted files
      }
    }

    if (arquivosParaAtualizar.length > 0) {
      await t.none(`
        UPDATE acervo.arquivo
        SET tipo_status_id = 2
        WHERE id = ANY($1)
        AND tipo_status_id = 1
      `, [arquivosParaAtualizar]);
    }

    if (arquivosDeletadosParaAtualizar.length > 0) {
      await t.none(`
        UPDATE acervo.arquivo_deletado
        SET tipo_status_id = 4
        WHERE id = ANY($1)
        AND tipo_status_id = 3
      `, [arquivosDeletadosParaAtualizar]);
    }

    // Verificar e atualizar arquivos classificados incorretamente como incorretos
    await t.none(`
      UPDATE acervo.arquivo
      SET tipo_status_id = 1
      WHERE tipo_status_id = 2
      AND id NOT IN (SELECT unnest($1::bigint[]))
    `, [arquivosParaAtualizar]);

    // Verificar e atualizar arquivos deletados classificados incorretamente como incorretos
    await t.none(`
      UPDATE acervo.arquivo_deletado
      SET tipo_status_id = 3
      WHERE tipo_status_id = 4
      AND id NOT IN (SELECT unnest($1::bigint[]))
    `, [arquivosDeletadosParaAtualizar]);

    return {
      arquivos_atualizados: arquivosParaAtualizar.length,
      arquivos_deletados_atualizados: arquivosDeletadosParaAtualizar.length
    };
  });
};

controller.getArquivosIncorretos = async () => {
  return db.conn.task(async t => {
    const arquivosIncorretos = await t.any(`
      SELECT a.id, a.nome, a.nome_arquivo, a.extensao, v.volume, 'Arquivo com erro' as tipo
      FROM acervo.arquivo AS a
      INNER JOIN acervo.volume_armazenamento AS v ON a.volume_armazenamento_id = v.id
      WHERE a.tipo_status_id = 2
    `);

    const arquivosDeletadosIncorretos = await t.any(`
      SELECT ad.id, ad.nome, ad.nome_arquivo, ad.extensao, v.volume, 'Arquivo deletado com erro' as tipo
      FROM acervo.arquivo_deletado AS ad
      INNER JOIN acervo.volume_armazenamento AS v ON ad.volume_armazenamento_id = v.id
      WHERE ad.tipo_status_id = 4
    `);

    return [...arquivosIncorretos, ...arquivosDeletadosIncorretos];
  });
};

module.exports = controller;
