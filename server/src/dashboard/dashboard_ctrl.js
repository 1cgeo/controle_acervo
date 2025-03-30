// Path: dashboard\dashboard_ctrl.js
'use strict'

const { db } = require('../database')

const controller = {}

controller.getTotalProdutos = async () => {
  return db.conn.one('SELECT COUNT(*) AS total_produtos FROM acervo.produto');
}

controller.getTotalArquivosGb = async () => {
  return db.conn.one('SELECT SUM(tamanho_mb) / 1024 AS total_gb FROM acervo.arquivo');
}

controller.getProdutosPorTipo = async () => {
  return db.conn.any(`
    SELECT p.tipo_produto_id, tp.nome AS tipo_produto, COUNT(*) AS quantidade 
    FROM acervo.produto AS p
    INNER JOIN dominio.tipo_produto AS tp ON tp.code = p.tipo_produto_id
    GROUP BY p.tipo_produto_id, tp.nome`
  );
}

controller.getGbPorTipoProduto = async () => {
  return db.conn.any(`
    SELECT p.tipo_produto_id, tp.nome AS tipo_produto, SUM(a.tamanho_mb) / 1024 AS total_gb 
    FROM acervo.produto p 
    INNER JOIN dominio.tipo_produto AS tp ON tp.code = p.tipo_produto_id
    INNER JOIN acervo.versao AS v ON v.produto_id = p.id
    INNER JOIN acervo.arquivo a ON v.id = a.versao_id 
    GROUP BY p.tipo_produto_id, tp.nome
  `);
}

controller.getTotalUsuarios = async () => {
  return db.conn.one('SELECT COUNT(*) AS total_usuarios FROM dgeo.usuario');
}

controller.getArquivosPorDia = async () => {
  return db.conn.any(`
    SELECT DATE(data_cadastramento) AS dia, COUNT(*) AS quantidade
    FROM acervo.arquivo 
    GROUP BY dia ORDER BY dia
    LIMIT 30`
  );
}

controller.getDownloadsPorDia = async () => {
  return db.conn.any(`
    SELECT DATE(data_download) AS dia, COUNT(*) AS quantidade 
    FROM acervo.download 
    GROUP BY dia ORDER BY dia
    LIMIT 30`
  );
}

controller.getGbPorVolume = async () => {
  return db.conn.any(`
    SELECT a.volume_armazenamento_id, va.nome AS nome_volume, va.volume, 
    va.capacidade_gb AS capacidade_gb_volume, SUM(a.tamanho_mb) / 1024 AS total_gb 
    FROM acervo.arquivo AS a
    INNER JOIN acervo.volume_armazenamento AS va ON va.id = a.volume_armazenamento_id
    GROUP BY a.volume_armazenamento_id, va.nome, va.volume, va.capacidade_gb`
  );
}

controller.getUltimosCarregamentos = async () => {
  return db.conn.any(`
    SELECT 
      id, uuid_arquivo, nome, nome_arquivo, versao_id, tipo_arquivo_id,
      volume_armazenamento_id, extensao, tamanho_mb, checksum, metadado,
      tipo_status_id, situacao_carregamento_id, orgao_produtor, descricao,
      data_cadastramento, usuario_cadastramento_uuid, data_modificacao, 
      usuario_modificacao_uuid 
    FROM acervo.arquivo 
    ORDER BY data_cadastramento DESC 
    LIMIT 10`);
};

controller.getUltimasModificacoes = async () => {
  return db.conn.any(`
    SELECT 
      id, uuid_arquivo, nome, nome_arquivo, versao_id, tipo_arquivo_id,
      volume_armazenamento_id, extensao, tamanho_mb, checksum, metadado,
      tipo_status_id, situacao_carregamento_id, orgao_produtor, descricao,
      data_cadastramento, usuario_cadastramento_uuid, data_modificacao, 
      usuario_modificacao_uuid
    FROM acervo.arquivo 
    WHERE data_modificacao IS NOT NULL 
    ORDER BY data_modificacao DESC 
    LIMIT 10`
  );
};

controller.getUltimosDeletes = async () => {
  return db.conn.any(`
    SELECT 
      id, uuid_arquivo, nome, nome_arquivo, motivo_exclusao, versao_id, 
      tipo_arquivo_id, volume_armazenamento_id, extensao, tamanho_mb, 
      checksum, metadado, tipo_status_id, situacao_carregamento_id, 
      orgao_produtor, descricao, data_cadastramento, usuario_cadastramento_uuid, 
      data_modificacao, usuario_modificacao_uuid, data_delete, usuario_delete_uuid
    FROM acervo.arquivo_deletado 
    ORDER BY data_delete DESC 
    LIMIT 10`
  );
};

controller.getDownload = async () => {
  return db.conn.any(
    `
    SELECT * FROM
    (SELECT 
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
    FROM acervo.download_deletado dd) AS downloads
    ORDER BY data_download DESC
    LIMIT 50
    `
  );
}

// NEW DASHBOARD FUNCTIONS

// Get product activity by month
controller.getProdutoActivityTimeline = async (months = 12) => {
  return db.conn.any(`
    SELECT 
      TO_CHAR(date_trunc('month', data_cadastramento), 'YYYY-MM') AS month,
      COUNT(*) AS new_products,
      0 AS modified_products
    FROM acervo.produto
    WHERE data_cadastramento > NOW() - INTERVAL '${months} months'
    GROUP BY month
    UNION ALL
    SELECT 
      TO_CHAR(date_trunc('month', data_modificacao), 'YYYY-MM') AS month,
      0 AS new_products,
      COUNT(*) AS modified_products
    FROM acervo.produto
    WHERE 
      data_modificacao IS NOT NULL AND
      data_modificacao > NOW() - INTERVAL '${months} months'
    GROUP BY month
    ORDER BY month DESC
  `);
}

// Get version statistics
controller.getVersionStatistics = async () => {
  return db.conn.task(async t => {
    // Get basic version stats
    const versionStats = await t.one(`
      SELECT 
        COUNT(*) AS total_versions,
        COUNT(DISTINCT produto_id) AS products_with_versions,
        ROUND(AVG(versions_per_product), 2) AS avg_versions_per_product,
        MAX(versions_per_product) AS max_versions_per_product
      FROM (
        SELECT produto_id, COUNT(*) AS versions_per_product
        FROM acervo.versao
        GROUP BY produto_id
      ) subquery
    `);
    
    // Get version count distribution
    const versionDistribution = await t.any(`
      SELECT 
        versions_per_product,
        COUNT(*) AS product_count
      FROM (
        SELECT produto_id, COUNT(*) AS versions_per_product
        FROM acervo.versao
        GROUP BY produto_id
      ) subquery
      GROUP BY versions_per_product
      ORDER BY versions_per_product
    `);
    
    // Get version type distribution
    const versionTypeDistribution = await t.any(`
      SELECT 
        tv.nome AS version_type,
        COUNT(*) AS version_count
      FROM acervo.versao v
      JOIN dominio.tipo_versao tv ON v.tipo_versao_id = tv.code
      GROUP BY tv.nome
    `);
    
    return {
      stats: versionStats,
      distribution: versionDistribution,
      type_distribution: versionTypeDistribution
    };
  });
}

// Get storage growth trends
controller.getStorageGrowthTrends = async (months = 12) => {
  return db.conn.any(`
    WITH monthly_data AS (
      SELECT 
        date_trunc('month', data_cadastramento) AS month,
        SUM(tamanho_mb) / 1024 AS gb_added
      FROM acervo.arquivo
      WHERE data_cadastramento > NOW() - INTERVAL '${months} months'
      GROUP BY month
    ),
    months_series AS (
      SELECT generate_series(
        date_trunc('month', NOW() - INTERVAL '${months-1} months'),
        date_trunc('month', NOW()),
        '1 month'::interval
      ) AS month
    )
    SELECT 
      TO_CHAR(ms.month, 'YYYY-MM') AS month,
      COALESCE(md.gb_added, 0) AS gb_added,
      SUM(COALESCE(md.gb_added, 0)) OVER (ORDER BY ms.month) AS cumulative_gb
    FROM months_series ms
    LEFT JOIN monthly_data md ON ms.month = md.month
    ORDER BY ms.month
  `);
}

// Get project status summary
controller.getProjectStatusSummary = async () => {
  return db.conn.task(async t => {
    // Project status summary
    const projectStatus = await t.any(`
      SELECT 
        tse.nome AS status,
        COUNT(DISTINCT p.id) AS project_count
      FROM acervo.projeto p
      JOIN dominio.tipo_status_execucao tse ON p.status_execucao_id = tse.code
      GROUP BY tse.nome, tse.code
      ORDER BY tse.code
    `);
    
    // Lot status summary
    const lotStatus = await t.any(`
      SELECT 
        tse.nome AS status,
        COUNT(DISTINCT l.id) AS lot_count
      FROM acervo.lote l
      JOIN dominio.tipo_status_execucao tse ON l.status_execucao_id = tse.code
      GROUP BY tse.nome, tse.code
      ORDER BY tse.code
    `);
    
    // Projects without lots
    const projectsWithoutLots = await t.one(`
      SELECT 
        COUNT(*) AS count
      FROM acervo.projeto p
      WHERE NOT EXISTS (
        SELECT 1 FROM acervo.lote l WHERE l.projeto_id = p.id
      )
    `);
    
    return {
      project_status: projectStatus,
      lot_status: lotStatus,
      projects_without_lots: parseInt(projectsWithoutLots.count)
    };
  });
}

// Get user activity metrics
controller.getUserActivityMetrics = async (limit = 10) => {
  return db.conn.any(`
    WITH user_uploads AS (
      SELECT 
        usuario_cadastramento_uuid,
        COUNT(*) AS upload_count
      FROM acervo.arquivo
      GROUP BY usuario_cadastramento_uuid
    ),
    user_modifications AS (
      SELECT 
        usuario_modificacao_uuid,
        COUNT(*) AS modification_count
      FROM acervo.arquivo
      WHERE usuario_modificacao_uuid IS NOT NULL
      GROUP BY usuario_modificacao_uuid
    ),
    user_downloads AS (
      SELECT 
        usuario_uuid,
        COUNT(*) AS download_count
      FROM acervo.download
      GROUP BY usuario_uuid
    )
    SELECT 
      u.nome AS usuario_nome,
      u.login AS usuario_login,
      COALESCE(up.upload_count, 0) AS uploads,
      COALESCE(um.modification_count, 0) AS modifications,
      COALESCE(ud.download_count, 0) AS downloads,
      COALESCE(up.upload_count, 0) + 
      COALESCE(um.modification_count, 0) + 
      COALESCE(ud.download_count, 0) AS total_activity
    FROM dgeo.usuario u
    LEFT JOIN user_uploads up ON u.uuid = up.usuario_cadastramento_uuid
    LEFT JOIN user_modifications um ON u.uuid = um.usuario_modificacao_uuid
    LEFT JOIN user_downloads ud ON u.uuid = ud.usuario_uuid
    WHERE u.ativo = true
    ORDER BY total_activity DESC
    LIMIT $1
  `, [limit]);
}

module.exports = controller