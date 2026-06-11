// Path: acervo\acervo_ctrl.js
"use strict";
const archiver = require('archiver');
const { Readable } = require('stream');
const { db } = require("../database");
const { AppError, httpCode, domainConstants: { SUBTIPO_PRODUTO, TIPO_ESCALA, TIPO_ARQUIVO, TIPO_PRODUTO, STATUS_ARQUIVO } } = require("../utils");

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
  const versao = await db.conn.oneOrNone(`
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

  if (!versao) {
    throw new AppError('Versão não encontrada', httpCode.NotFound);
  }

  return versao;
};

controller.getProdutoById = async (produtoId) => {
  const produto = await db.conn.oneOrNone(`
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

  if (!produto) {
    throw new AppError('Produto não encontrado', httpCode.NotFound);
  }

  return produto;
};

controller.getProdutoDetailedById = async produtoId => {
  return db.conn.task(async t => {
    // Primeiro, obter informações básicas do produto
    const produto = await t.oneOrNone(`
      SELECT
        p.id,
        p.nome,
        p.mi,
        p.inom,
        p.tipo_escala_id,
        te.nome AS escala,
        p.denominador_escala_especial,
        p.tipo_produto_id,
        p.descricao,
        p.data_cadastramento,
        u1.nome AS usuario_cadastramento,
        p.data_modificacao,
        u2.nome AS usuario_modificacao,
        ST_AsEWKT(p.geom) AS geom
      FROM acervo.produto p
      INNER JOIN dominio.tipo_escala AS te ON te.code = p.tipo_escala_id
      LEFT JOIN dgeo.usuario AS u1 ON u1.uuid = p.usuario_cadastramento_uuid
      LEFT JOIN dgeo.usuario AS u2 ON u2.uuid = p.usuario_modificacao_uuid
      WHERE p.id = $1
    `, [produtoId]);

    if (!produto) {
      throw new AppError('Produto não encontrado', httpCode.NotFound);
    }

    // Obter todas as versões do produto com seus relacionamentos e arquivos
    const versoes = await t.any(`
      SELECT
        v.id AS versao_id,
        v.produto_id,
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
          vr.id,
          CASE WHEN vr.versao_id_1 = $1 THEN vr.versao_id_2 ELSE vr.versao_id_1 END AS versao_relacionada_id,
          vr.tipo_relacionamento_id,
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
    `SELECT id, nome, nome_arquivo, extensao, checksum, tipo_arquivo_id, tipo_status_id FROM acervo.arquivo WHERE id IN ($<arquivosIds:csv>)`,
    { arquivosIds }
  );

  if (existingArquivos.length !== arquivosIds.length) {
    throw new AppError("Um ou mais IDs de arquivo não existem", httpCode.NotFound);
  }

  // Arquivos com erro de carregamento/exclusão não são baixáveis
  const comErro = existingArquivos.filter(a => a.tipo_status_id !== STATUS_ARQUIVO.CARREGADO);
  if (comErro.length > 0) {
    throw new AppError(
      `Os seguintes arquivos estão com status de erro e não podem ser baixados: ${comErro.map(a => a.nome).join(', ')}`,
      httpCode.BadRequest
    );
  }

  // Tileserver (tipo 9) é uma URL, sem arquivo físico em volume — não é baixável.
  // Sem esta checagem seriam criados registros de download órfãos (sem token retornado).
  const tileserver = existingArquivos.filter(a => a.tipo_arquivo_id === TIPO_ARQUIVO.TILESERVER);
  if (tileserver.length > 0) {
    throw new AppError(
      `Os seguintes arquivos são do tipo Tileserver (URL) e não possuem arquivo físico para download: ${tileserver.map(a => a.nome).join(', ')}`,
      httpCode.BadRequest
    );
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
      a.tamanho_mb,
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
    tamanho_mb: file.tamanho_mb,
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
    SELECT a.id AS arquivo_id, a.nome, a.nome_arquivo, a.extensao, a.checksum, a.tamanho_mb, va.volume
    FROM newest_versions nv
    JOIN acervo.arquivo a ON a.versao_id = nv.versao_id
    JOIN acervo.volume_armazenamento va ON a.volume_armazenamento_id = va.id
    WHERE a.tipo_arquivo_id IN ($<tiposArquivo:csv>)
      AND a.tipo_status_id = $<statusCarregado>
    `,
    { produtosIds, tiposArquivo, statusCarregado: STATUS_ARQUIVO.CARREGADO }
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
    tamanho_mb: file.tamanho_mb,
    download_token: tokenMap[file.arquivo_id]
  }));

  return filePaths;
};

// Cleanup function that can be called by a scheduled job
// SELECT de função retorna 1 linha — usar .any(), nunca .none()
controller.cleanupExpiredDownloads = async () => {
  return db.conn.any(`SELECT acervo.cleanup_expired_downloads()`);
};

controller.refreshAllMaterializedViews = async () => {
  return db.conn.task(async t => {
    try {
      await t.any(`SELECT acervo.refresh_all_materialized_views()`);
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
      await t.any(`SELECT acervo.criar_views_materializadas()`);
      return {
        success: true,
        message: 'Views materializadas criadas com sucesso'
      };
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
        { id: TIPO_ESCALA.ESCALA_25K, name: '25k', description: '1:25.000' },
        { id: TIPO_ESCALA.ESCALA_50K, name: '50k', description: '1:50.000' },
        { id: TIPO_ESCALA.ESCALA_100K, name: '100k', description: '1:100.000' },
        { id: TIPO_ESCALA.ESCALA_250K, name: '250k', description: '1:250.000' }
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

// Exporta um ZIP de CSVs no mesmo padrão da planilha de referência da ASC
// (uma "aba" por escala+tipo: T250/O250/T100/O100/T50/O50/T25/O25), uma linha
// por versão (edição). Permite comparar o acervo com a planilha no mesmo formato.
controller.getPlanilhaCSV = async (scaleOptions = {}) => {
  return new Promise(async (resolve, reject) => {
    try {
      const archive = archiver('zip', { zlib: { level: 9 } });
      const chunks = [];
      archive.on('data', (c) => chunks.push(c));
      archive.on('end', () => resolve(Buffer.concat(chunks)));
      archive.on('error', (e) => reject(e));

      const todasEscalas = [
        { id: TIPO_ESCALA.ESCALA_250K, name: '250k' },
        { id: TIPO_ESCALA.ESCALA_100K, name: '100k' },
        { id: TIPO_ESCALA.ESCALA_50K, name: '50k' },
        { id: TIPO_ESCALA.ESCALA_25K, name: '25k' }
      ];
      const selecionadas = todasEscalas.filter(e => scaleOptions[e.name] === true);
      const escalas = selecionadas.length > 0 ? selecionadas : todasEscalas;
      const tipos = [
        { id: TIPO_PRODUTO.CARTA_TOPOGRAFICA, prefix: 'T', label: 'C. Topo' },
        { id: TIPO_PRODUTO.CARTA_ORTOIMAGEM, prefix: 'O', label: 'C. Orto' }
      ];
      const COLS = ['Cont_Edicao', 'MI', 'INOM', 'Tipo_Produto', 'Subtipo', 'Nome', 'Orgao_Produtor', 'EPSG', 'Ano_Dados', 'Ano_Edicao', 'Versao', 'Lote', 'Tem_Arquivo'];
      const esc = (s) => {
        if (s == null) return '';
        const v = String(s);
        return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
      };

      for (const e of escalas) {
        for (const t of tipos) {
          const rows = await db.conn.any(`
            SELECT
              substring(v.versao from '^([0-9]+)') AS cont_edicao,
              p.mi, p.inom,
              $<label> AS tipo_produto,
              sp.nome AS subtipo,
              v.nome,
              v.orgao_produtor,
              (SELECT a.crs_original FROM acervo.arquivo a
                 WHERE a.versao_id = v.id AND a.tipo_arquivo_id = 1 LIMIT 1) AS epsg,
              EXTRACT(YEAR FROM v.data_criacao)::int AS ano_dados,
              EXTRACT(YEAR FROM v.data_edicao)::int AS ano_edicao,
              v.versao,
              l.nome AS lote,
              (SELECT count(*) FROM acervo.arquivo a WHERE a.versao_id = v.id) AS tem_arquivo
            FROM acervo.versao v
            JOIN acervo.produto p ON p.id = v.produto_id
            JOIN dominio.subtipo_produto sp ON sp.code = v.subtipo_produto_id
            LEFT JOIN acervo.lote l ON l.id = v.lote_id
            WHERE p.tipo_escala_id = $<escId> AND p.tipo_produto_id = $<tipoId>
            ORDER BY p.mi, p.inom, EXTRACT(YEAR FROM v.data_edicao)
          `, { escId: e.id, tipoId: t.id, label: t.label });

          const linhas = [COLS.join(',')];
          for (const r of rows) {
            linhas.push([r.cont_edicao, r.mi, r.inom, r.tipo_produto, r.subtipo, r.nome,
              r.orgao_produtor, r.epsg, r.ano_dados, r.ano_edicao, r.versao, r.lote, r.tem_arquivo]
              .map(esc).join(','));
          }
          const csv = '﻿' + linhas.join('\r\n'); // BOM para abrir certo no Excel
          archive.append(Readable.from(csv), { name: `${t.prefix}${e.name}.csv` });
        }
      }
      archive.finalize();
    } catch (error) {
      reject(error);
    }
  });
};

// Escalas da carta topográfica sistemática e o sufixo usado nos arquivos do
// site de produtos. Exportado para a rota pública de integração mapear o nome
// de escala (ex.: '50k') para o code do domínio.
const SITUACAO_GERAL_ESCALAS = [
  { id: TIPO_ESCALA.ESCALA_25K, name: '25k' },
  { id: TIPO_ESCALA.ESCALA_50K, name: '50k' },
  { id: TIPO_ESCALA.ESCALA_100K, name: '100k' },
  { id: TIPO_ESCALA.ESCALA_250K, name: '250k' }
];
controller.SITUACAO_GERAL_ESCALAS = SITUACAO_GERAL_ESCALAS;

// Normaliza um identificador (MI/INOM) para comparação tolerante a espaços/caixa
const normIdentificador = (s) =>
  s == null ? '' : String(s).trim().toUpperCase().replace(/\s+/g, '');

const situacaoEdicoes = (edicoes) => {
  if (edicoes.length === 0) return 'Não mapeado';
  if (edicoes.length === 1) return 'Concluído';
  return 'Múltiplas edições';
};

// Núcleo reutilizável da situação geral, usado pela rota ZIP (GET
// /api/acervo/situacao-geral) e pela rota pública de integração (GET
// /api/integracao/acervo/situacao_geral). Devolve, por escala, uma feature
// GeoJSON por célula da grade (MI), mesclando Carta Topográfica e Carta
// Ortoimagem da mesma MI (no SCA são produtos distintos). Formato de
// propriedades idêntico aos arquivos do site de produtos (1cgeo/produtos),
// com os anos de edição vindos de v.data_edicao (finalização).
//   - incluirGeom: inclui a geometria (cara); a rota pública omite por padrão.
//   - filtroIds: Set de MI/INOM normalizados; quando presente, limita às folhas
//     pedidas (modo por identificador da skill consultar-produtos).
controller.getSituacaoGeralCells = async (scaleId, { incluirGeom = true, filtroIds = null } = {}) => {
  const celulas = await db.conn.any(`
    WITH produtos_escala AS (
      SELECT p.id, p.mi, p.inom, p.geom, p.tipo_produto_id
      FROM acervo.produto p
      WHERE p.tipo_escala_id = $1 AND p.mi IS NOT NULL
    ),
    edicoes AS (
      SELECT pe.mi,
             pe.tipo_produto_id,
             ARRAY_AGG(DISTINCT EXTRACT(YEAR FROM v.data_edicao)::int
                       ORDER BY EXTRACT(YEAR FROM v.data_edicao)::int DESC) AS anos
      FROM produtos_escala pe
      JOIN acervo.versao v ON v.produto_id = pe.id
      GROUP BY pe.mi, pe.tipo_produto_id
    ),
    grade AS (
      SELECT DISTINCT ON (mi) mi, inom, geom
      FROM produtos_escala
      ORDER BY mi, id
    )
    SELECT
      g.mi AS "identificadorMI",
      g.inom AS "identificadorINOM",
      ${incluirGeom ? 'ST_AsGeoJSON(g.geom)::json AS geometry,' : ''}
      COALESCE(t.anos, ARRAY[]::int[]) AS "edicoes_topo",
      COALESCE(o.anos, ARRAY[]::int[]) AS "edicoes_orto"
    FROM grade g
    LEFT JOIN edicoes t ON t.mi = g.mi AND t.tipo_produto_id = ${TIPO_PRODUTO.CARTA_TOPOGRAFICA}
    LEFT JOIN edicoes o ON o.mi = g.mi AND o.tipo_produto_id = ${TIPO_PRODUTO.CARTA_ORTOIMAGEM}
    ORDER BY g.mi
  `, [scaleId]);

  // Construct GeoJSON features (chaves e tipos idênticos aos arquivos do site:
  // id sequencial como string, anos como strings em ordem decrescente)
  return celulas
    .filter(c => !filtroIds ||
      filtroIds.has(normIdentificador(c.identificadorMI)) ||
      filtroIds.has(normIdentificador(c.identificadorINOM)))
    .map((celula, index) => {
      const edicoesTopo = celula.edicoes_topo.map(ano => ano.toString());
      const edicoesOrto = celula.edicoes_orto.map(ano => ano.toString());

      const feature = {
        type: "Feature",
        properties: {
          id: index.toString(),
          identificadorMI: celula.identificadorMI,
          situacao_topo: situacaoEdicoes(edicoesTopo),
          edicoes_topo: edicoesTopo,
          situacao_orto: situacaoEdicoes(edicoesOrto),
          edicoes_orto: edicoesOrto,
          identificadorINOM: celula.identificadorINOM
        }
      };
      if (incluirGeom) feature.geometry = celula.geometry;
      return feature;
    });
};

// Helper function to generate GeoJSON for a specific scale
// Formato idêntico ao consumido pelo site de produtos (1cgeo/produtos):
// uma feature por célula da grade (MI), mesclando os produtos de Carta
// Topográfica e Carta Ortoimagem da mesma MI (no SCA são produtos distintos)
async function generateGeoJSONForScale(scaleId) {
  const features = await controller.getSituacaoGeralCells(scaleId, { incluirGeom: true });
  const escala = SITUACAO_GERAL_ESCALAS.find(s => s.id === scaleId);

  // Create the GeoJSON structure
  return {
    type: "FeatureCollection",
    name: `situacao-geral-ct-${escala ? escala.name : scaleId}`,
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
