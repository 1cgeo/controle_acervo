// Path: gerencia\gerencia_ctrl.js
"use strict";
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { db, refreshViews } = require("../database");
const { AppError, httpCode } = require("../utils");
const { v4: uuidv4 } = require('uuid');
const { version } = require('os');
const { pipeline } = require('stream');
const { promisify } = require('util');
const pipelineAsync = promisify(pipeline);

const {
  DB_USER,
  DB_PASSWORD,
  DB_SERVER,
  DB_PORT,
  DB_NAME
} = require('../config')

const controller = {};

controller.getTipoPostoGrad = async () => {
  return db.conn.any(`
    SELECT code, nome, nome_brev
    FROM dominio.tipo_posto_grad
    `);
};

controller.getTipoProduto = async () => {
  return db.conn.any(`
    SELECT code, nome
    FROM dominio.tipo_produto
    `);
};

controller.getSituacaoBDGEx = async () => {
  return db.conn.any(`
    SELECT code, nome
    FROM dominio.situacao_carregamento
    `);
};

controller.getTipoArquivo = async () => {
  return db.conn.any(`
    SELECT code, nome
    FROM dominio.tipo_arquivo
    `);
};

controller.getTipoRelacionamento = async () => {
  return db.conn.any(`
    SELECT code, nome
    FROM dominio.tipo_relacionamento
    `);
};

controller.getTipoStatusArquivo = async () => {
  return db.conn.any(`
    SELECT code, nome
    FROM dominio.tipo_status_arquivo
    `);
};

controller.getTipoVersao = async () => {
  return db.conn.any(`
    SELECT code, nome
    FROM dominio.tipo_versao
    `);
};

controller.getTipoStatusExecucao = async () => {
  return db.conn.any(`
    SELECT code, nome
    FROM dominio.tipo_status_execucao
    `);
};

controller.getArquivosDeletados = async () => {
  return db.conn.any(
    `
    SELECT 
      ad.id, 
      ad.uuid_arquivo, 
      ad.nome, 
      ad.nome_arquivo, 
      ad.motivo_exclusao, 
      ad.versao_id, 
      v.versao AS versao, 
      v.nome AS versao_nome,
      p.nome AS produto,
      p.mi,
      p.inom,
      te.nome AS escala,
      p.denominador_escala_especial,
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
      ad.metadado, 
      ad.tipo_status_id, 
      ts.nome AS tipo_status_nome, 
      ad.situacao_carregamento_id, 
      sb.nome AS situacao_carregamento_nome, 
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
      dominio.tipo_escala AS te ON te.code = p.tipo_escala_id
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
      dominio.situacao_carregamento sb ON ad.situacao_carregamento_id = sb.code
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

controller.verificarConsistencia = async () => {
  return db.conn.tx(async t => {
    // 1. Obter todos os arquivos e suas informações em uma consulta
    const arquivos = await t.any(`
      SELECT a.id, a.nome_arquivo, a.checksum, a.extensao, v.volume, a.tipo_arquivo_id
      FROM acervo.arquivo a
      JOIN acervo.volume_armazenamento v ON a.volume_armazenamento_id = v.id
      WHERE a.tipo_arquivo_id != 9
    `);

    const arquivosDeletados = await t.any(`
      SELECT ad.id, ad.nome_arquivo, ad.extensao, v.volume
      FROM acervo.arquivo_deletado ad
      JOIN acervo.volume_armazenamento v ON ad.volume_armazenamento_id = v.id
      WHERE ad.tipo_arquivo_id != 9
    `);

    // 2. Processar em lotes menores para evitar sobrecarga de memória
    const BATCH_SIZE = 50;
    const arquivosParaAtualizar = [];
    const arquivosDeletadosParaAtualizar = [];
    
    // Função auxiliar para cálculo de checksum com streams
    async function calculaChecksumStream(filePath) {
      return new Promise(async (resolve, reject) => {
        const hash = crypto.createHash('sha256');
        const readStream = fs.createReadStream(filePath);
        
        try {
          // pipeline garante que todos os streams sejam limpos
          await pipelineAsync(
            readStream,
            // Transform stream (opcional se quiser processar em chunks)
            hash
          );
          resolve(hash.digest('hex'));
        } catch (error) {
          reject(error);
        }
      });
    }
    
    // Processar arquivos existentes
    for (let i = 0; i < arquivos.length; i += BATCH_SIZE) {
      const batch = arquivos.slice(i, i + BATCH_SIZE);
      
      // Usar Promise.all para processamento paralelo dentro do lote
      const resultados = await Promise.all(batch.map(async arquivo => {
        const filePath = path.join(arquivo.volume, arquivo.nome_arquivo + arquivo.extensao);
        
        try {
          // Verificar existência do arquivo antes de ler
          await fs.access(filePath);
          // Usar stream para grandes arquivos
          const calculatedChecksum = await calculaChecksumStream(filePath);
          
          return {
            id: arquivo.id,
            status: calculatedChecksum !== arquivo.checksum ? 'checksum_invalido' : 'ok'
          };
        } catch (error) {
          return {
            id: arquivo.id,
            status: 'nao_encontrado'
          };
        }
      }));
      
      // Adicionar apenas os arquivos com problema
      resultados
        .filter(r => r.status !== 'ok')
        .forEach(r => arquivosParaAtualizar.push(r.id));
    }
    
    // Processar arquivos deletados
    for (let i = 0; i < arquivosDeletados.length; i += BATCH_SIZE) {
      const batch = arquivosDeletados.slice(i, i + BATCH_SIZE);
      
      const resultados = await Promise.all(batch.map(async arquivoDeletado => {
        const deletedFilePath = path.join(arquivoDeletado.volume, 
                                          arquivoDeletado.nome_arquivo + arquivoDeletado.extensao);
        
        try {
          // Verificar se o arquivo existe
          await fs.access(deletedFilePath);
          
          // Verificar se está associado a um arquivo existente
          const existingArquivo = await t.oneOrNone(`
            SELECT a.id 
            FROM acervo.arquivo a
            JOIN acervo.volume_armazenamento v ON a.volume_armazenamento_id = v.id
            WHERE concat(v.volume, a.nome_arquivo, a.extensao) = $1
          `, [deletedFilePath]);
          
          return {
            id: arquivoDeletado.id,
            status: !existingArquivo ? 'unexpected' : 'ok'
          };
        } catch (error) {
          // Arquivo não existe, o que é esperado para arquivos deletados
          return {
            id: arquivoDeletado.id,
            status: 'ok'
          };
        }
      }));
      
      // Adicionar apenas os arquivos com problema
      resultados
        .filter(r => r.status !== 'ok')
        .forEach(r => arquivosDeletadosParaAtualizar.push(r.id));
    }

    // Atualizar status de arquivos com problemas
    if (arquivosParaAtualizar.length > 0) {
      await t.none(`
        UPDATE acervo.arquivo
        SET tipo_status_id = 2
        WHERE id = ANY($1)
        AND tipo_status_id = 1
      `, [arquivosParaAtualizar]);
    }

    // Atualizar status de arquivos deletados com problemas
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
    `, [arquivosParaAtualizar.length > 0 ? arquivosParaAtualizar : [-1]]);

    // Verificar e atualizar arquivos deletados classificados incorretamente como incorretos
    await t.none(`
      UPDATE acervo.arquivo_deletado
      SET tipo_status_id = 3
      WHERE tipo_status_id = 4
      AND id NOT IN (SELECT unnest($1::bigint[]))
    `, [arquivosDeletadosParaAtualizar.length > 0 ? arquivosDeletadosParaAtualizar : [-1]]);

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
