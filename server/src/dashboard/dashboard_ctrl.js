'use strict'

const { db } = require('../database')

const controller = {}

controller.getTotalProdutos = async () => {
  return db.conn.one('SELECT COUNT(*) AS total_oprodutos FROM acervo.produto');
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
    va.capacidade_mb AS capacidade_mb_volume, SUM(a.tamanho_mb) / 1024 AS total_gb 
    FROM acervo.arquivo AS a
    INNER JOIN acervo.volume_armazenamento AS va ON va.id = a.volume_armazenamento_id
    GROUP BY a.volume_armazenamento_id, va.nome, va.volume, va.capacidade_mb`
  );
}

controller.getUltimosCarregamentos = async () => {
  return db.conn.any(`
    SELECT * FROM acervo.arquivo 
    ORDER BY data_cadastramento DESC 
    LIMIT 10`);
}

controller.getUltimasModificacoes = async () => {
  return db.conn.any(`
    SELECT * 
    FROM acervo.arquivo 
    WHERE data_modificacao IS NOT NULL 
    ORDER BY data_modificacao DESC 
    LIMIT 10`
  );
}

controller.getUltimosDeletes = async () => {
  return db.conn.any(`
    SELECT * 
    FROM acervo.arquivo_deletado 
    ORDER BY data_delete DESC 
    LIMIT 10`
  );
}

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

module.exports = controller
