// Path: acervo\acervo_ctrl.js
"use strict";
const archiver = require('archiver');
const { Readable } = require('stream');
const { db } = require("../database");
const { AppError, httpCode } = require("../utils");

const {
  DB_USER,
  DB_PASSWORD,
  DB_SERVER,
  DB_PORT,
  DB_NAME,
  DB_USER_READONLY,
  DB_PASSWORD_READONLY
} = require('../config')

const controller = {};

controller.getProdutosLayer = async () => {
  return db.conn.task(async t => {
    const query = `
      SELECT 
          mv.matviewname,
          tp.nome AS tipo_produto,
          tp.code AS tipo_produto_id,
          te.nome AS tipo_escala,
          te.code AS tipo_escala_id
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
      login: DB_USER_READONLY || DB_USER,
      senha: DB_PASSWORD_READONLY || DB_PASSWORD,
      schema: 'acervo'
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
        tipo_produto_id: view.tipo_produto_id,
        tipo_escala: view.tipo_escala,
        tipo_escala_id: view.tipo_escala_id,
        quantidade_produtos: parseInt(countResult.quantidade_produtos),
        banco_dados: banco_dados
      };
    }));

    return resultWithCounts;
  });
};

controller.getVersaoById = async (versaoId) => {
  return db.conn.one(`
    SELECT
      v.id,
      v.uuid_versao,
      v.versao,
      v.nome AS nome_versao,
      v.tipo_versao_id,
      v.subtipo_produto_id,
      v.produto_id,
      v.lote_id,
      v.metadado,
      v.descricao,
      v.orgao_produtor,
      v.palavras_chave,
      v.data_criacao,
      v.data_edicao
    FROM acervo.versao v
    WHERE v.id = $1
  `, [versaoId]);
};

controller.getProdutoById = async (produtoId) => {
  return db.conn.one(`
    SELECT
      p.id,
      p.nome,
      p.mi,
      p.inom,
      p.tipo_escala_id,
      p.denominador_escala_especial,
      p.tipo_produto_id,
      p.descricao,
      p.geom
    FROM acervo.produto p
    WHERE p.id = $1
  `, [produtoId]);
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
      LEFT JOIN dgeo.usuario AS u1 ON u1.uuid = p.usuario_cadastramento_uuid
      LEFT JOIN dgeo.usuario AS u2 ON u2.uuid = p.usuario_modificacao_uuid
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
        v.orgao_produtor,
        v.palavras_chave,
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
          a.descricao,
          a.crs_original,
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

  const usuario = await db.conn.oneOrNone(
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

controller.prepareDownloadByProdutos = async (produtosIds, tiposArquivo, usuarioUuid) => {
  const usuario = await db.conn.oneOrNone(
    "SELECT uuid FROM dgeo.usuario WHERE uuid = $<usuarioUuid>",
    { usuarioUuid }
  );

  if (!usuario) {
    throw new AppError("Usuário não encontrado", httpCode.NotFound);
  }

  const newestVersionsWithFiles = await db.conn.any(
    `
    WITH newest_versions AS (
      SELECT DISTINCT ON (v.produto_id) v.produto_id, v.id AS versao_id
      FROM acervo.versao v
      WHERE v.produto_id IN ($<produtosIds:csv>)
      ORDER BY v.produto_id, v.data_edicao DESC, v.id DESC
    )
    SELECT a.id AS arquivo_id, a.nome, a.nome_arquivo, a.extensao, a.checksum, va.volume
    FROM newest_versions nv
    JOIN acervo.arquivo a ON a.versao_id = nv.versao_id
    JOIN acervo.volume_armazenamento va ON a.volume_armazenamento_id = va.id
    WHERE a.tipo_arquivo_id IN ($<tiposArquivo:csv>)
    `,
    { produtosIds, tiposArquivo }
  );

  if (newestVersionsWithFiles.length === 0) {
    throw new AppError("Nenhum arquivo encontrado para os produtos e tipos especificados", httpCode.NotFound);
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

controller.refreshAllMaterializedViews = async () => {
  return db.conn.task(async t => {
    try {
      await t.none(`SELECT acervo.refresh_all_materialized_views()`);
      return { 
        success: true, 
        message: 'Todas as views materializadas foram atualizadas com sucesso'
      };
    } catch (error) {
      throw new AppError(`Erro ao atualizar views materializadas: ${error.message}`, httpCode.InternalError, error);
    }
  });
};

controller.createMaterializedViews = async () => {
  return db.conn.task(async t => {
    try {
      await t.none(`SELECT acervo.criar_views_materializadas()`);
    } catch (error) {
      throw new AppError(`Erro ao criar views materializadas: ${error.message}`, httpCode.InternalError, error);
    }
  });
};

controller.getSituacaoGeralJSON = async (scaleOptions = {}) => {
  return new Promise(async (resolve, reject) => {
    try {
      // Create a zip archive in memory
      const archive = archiver('zip', { zlib: { level: 9 } });
      const chunks = [];
      
      // Collect data in memory chunks
      archive.on('data', (chunk) => chunks.push(chunk));
      archive.on('end', () => resolve(Buffer.concat(chunks)));
      archive.on('error', (err) => reject(err));
      
      // Define all available scales
      const allScales = [
        { id: 1, name: '25k', description: '1:25.000' },
        { id: 2, name: '50k', description: '1:50.000' },
        { id: 3, name: '100k', description: '1:100.000' },
        { id: 4, name: '250k', description: '1:250.000' }
      ];
      
      // Filter scales based on user selection
      const selectedScales = allScales.filter(scale => 
        scaleOptions[scale.name] === true
      );
      
      // If no scales selected, use all scales
      const scalesToUse = selectedScales.length > 0 ? selectedScales : allScales;
      
      for (const scale of scalesToUse) {
        const data = await generateGeoJSONForScale(scale.id);
        const jsonString = JSON.stringify(data, null, 2);
        
        // Create a readable stream from the JSON string
        const jsonStream = Readable.from(jsonString);
        
        // Add the stream to the archive
        archive.append(jsonStream, { name: `situacao-geral-ct-${scale.name}.geojson` });
      }
      
      // Finalize the archive
      archive.finalize();
      
    } catch (error) {
      reject(error);
    }
  });
};

// Helper function to generate GeoJSON for a specific scale
async function generateGeoJSONForScale(scaleId) {
  const products = await db.conn.any(`
    WITH versoes_topo AS (
      SELECT 
        p.id AS produto_id,
        p.mi AS identificadorMI,
        p.inom AS identificadorINOM,
        ARRAY_AGG(DISTINCT EXTRACT(YEAR FROM v.data_edicao)::int ORDER BY EXTRACT(YEAR FROM v.data_edicao)::int DESC) AS edicoes_topo
      FROM acervo.produto p
      JOIN acervo.versao v ON p.id = v.produto_id
      WHERE p.tipo_escala_id = $1
      AND v.subtipo_produto_id IN (2, 12, 24) -- Tipos de carta topográfica
      GROUP BY p.id
    ),
    versoes_orto AS (
      SELECT 
        p.id AS produto_id,
        ARRAY_AGG(DISTINCT EXTRACT(YEAR FROM v.data_edicao)::int ORDER BY EXTRACT(YEAR FROM v.data_edicao)::int DESC) AS edicoes_orto
      FROM acervo.produto p
      JOIN acervo.versao v ON p.id = v.produto_id
      WHERE p.tipo_escala_id = $1
      AND v.subtipo_produto_id IN (3, 19) -- Tipos de carta ortoimagem
      GROUP BY p.id
    )
    SELECT 
      p.id,
      p.mi AS "identificadorMI",
      p.inom AS "identificadorINOM",
      p.geom,
      CASE 
        WHEN vt.edicoes_topo IS NULL THEN 'Não mapeado'
        WHEN ARRAY_LENGTH(vt.edicoes_topo, 1) = 1 THEN 'Concluído'
        ELSE 'Múltiplas edições'
      END AS "situacao_topo",
      COALESCE(vt.edicoes_topo, ARRAY[]::int[]) AS "edicoes_topo",
      CASE 
        WHEN vo.edicoes_orto IS NULL THEN 'Não mapeado'
        WHEN ARRAY_LENGTH(vo.edicoes_orto, 1) = 1 THEN 'Concluído'
        ELSE 'Múltiplas edições'
      END AS "situacao_orto",
      COALESCE(vo.edicoes_orto, ARRAY[]::int[]) AS "edicoes_orto"
    FROM acervo.produto p
    LEFT JOIN versoes_topo vt ON p.id = vt.produto_id
    LEFT JOIN versoes_orto vo ON p.id = vo.produto_id
    WHERE p.tipo_escala_id = $1
    ORDER BY p.mi
  `, [scaleId]);
  
  // Convert PostgreSQL geometry to GeoJSON
  const productsWithGeojson = await db.conn.any(`
    SELECT 
      p.id,
      ST_AsGeoJSON(p.geom)::json AS geometry
    FROM acervo.produto p
    WHERE p.tipo_escala_id = $1
  `, [scaleId]);
  
  // Create geometry lookup
  const geometryLookup = {};
  productsWithGeojson.forEach(p => {
    geometryLookup[p.id] = p.geometry;
  });
  
  // Construct GeoJSON features
  const features = products.map((product, index) => {
    // Convert editions from numeric arrays to string arrays for consistency with sample
    const edicoes_topo = product.edicoes_topo.map(year => year.toString());
    const edicoes_orto = product.edicoes_orto.map(year => year.toString());
    
    return {
      type: "Feature",
      properties: {
        id: index.toString(), // Use sequential index as id like in the sample
        identificadorMI: product.identificadorMI,
        situacao_topo: product.situacao_topo,
        edicoes_topo: edicoes_topo,
        situacao_orto: product.situacao_orto,
        edicoes_orto: edicoes_orto,
        identificadorINOM: product.identificadorINOM
      },
      geometry: geometryLookup[product.id]
    };
  });
  
  // Create the GeoJSON structure
  return {
    type: "FeatureCollection",
    name: `situacao-geral-ct-${scaleId === 1 ? '25k' : scaleId === 2 ? '50k' : scaleId === 3 ? '100k' : '250k'}`,
    features: features
  };
}

controller.buscaProdutos = async (termo, tipoProdutoId, tipoEscalaId, projetoId, loteId, page, limit) => {
  return db.conn.task(async t => {
    const conditions = [];
    const params = {};

    if (termo) {
      conditions.push(`(p.nome ILIKE $<termo> OR p.mi ILIKE $<termo> OR p.inom ILIKE $<termo>)`);
      params.termo = `%${termo}%`;
    }
    if (tipoProdutoId) {
      conditions.push(`p.tipo_produto_id = $<tipoProdutoId>`);
      params.tipoProdutoId = tipoProdutoId;
    }
    if (tipoEscalaId) {
      conditions.push(`p.tipo_escala_id = $<tipoEscalaId>`);
      params.tipoEscalaId = tipoEscalaId;
    }
    if (projetoId || loteId) {
      conditions.push(`EXISTS (
        SELECT 1 FROM acervo.versao v2
        LEFT JOIN acervo.lote l2 ON v2.lote_id = l2.id
        WHERE v2.produto_id = p.id
        ${projetoId ? 'AND l2.projeto_id = $<projetoId>' : ''}
        ${loteId ? 'AND v2.lote_id = $<loteId>' : ''}
      )`);
      if (projetoId) params.projetoId = projetoId;
      if (loteId) params.loteId = loteId;
    }

    const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

    const offset = (page - 1) * limit;
    params.limit = limit;
    params.offset = offset;

    const countResult = await t.one(
      `SELECT COUNT(*) FROM acervo.produto p ${whereClause}`,
      params
    );

    const produtos = await t.any(
      `SELECT
        p.id, p.nome, p.mi, p.inom,
        te.nome AS escala, p.tipo_escala_id,
        tp.nome AS tipo_produto, p.tipo_produto_id,
        p.denominador_escala_especial, p.descricao,
        p.data_cadastramento, p.data_modificacao,
        COUNT(DISTINCT v.id) AS num_versoes
      FROM acervo.produto p
      INNER JOIN dominio.tipo_escala te ON te.code = p.tipo_escala_id
      INNER JOIN dominio.tipo_produto tp ON tp.code = p.tipo_produto_id
      LEFT JOIN acervo.versao v ON v.produto_id = p.id
      ${whereClause}
      GROUP BY p.id, te.nome, tp.nome
      ORDER BY p.nome, p.mi
      LIMIT $<limit> OFFSET $<offset>`,
      params
    );

    return {
      total: parseInt(countResult.count),
      page,
      limit,
      dados: produtos
    };
  });
};

module.exports = controller;
