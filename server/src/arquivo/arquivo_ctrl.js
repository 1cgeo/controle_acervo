// Path: arquivo\arquivo_ctrl.js
"use strict";
const fs = require('fs').promises;
const fsClassic = require('fs');
const path = require('path');
const { caminhoNoVolume } = require('../utils/caminho_volume');
const crypto = require('crypto');
const { db } = require("../database");
const { AppError, httpCode, preserveOmitted, logger, domainConstants: { STATUS_ARQUIVO, TIPO_ARQUIVO, TIPO_VERSAO, SITUACAO_CARREGAMENTO } } = require("../utils");
const { v4: uuidv4 } = require('uuid');
const { version } = require('os');
const { pipeline } = require('stream');
const { promisify } = require('util');
const pipelineAsync = promisify(pipeline);

/**
 * Calcula checksum SHA-256 via streaming, sem carregar o arquivo inteiro em memória.
 * Retorna { checksum, fileSizeMB }.
 */
function calculateChecksumStream(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    let fileSize = 0;
    const stream = fsClassic.createReadStream(filePath);
    stream.on('data', (chunk) => {
      hash.update(chunk);
      fileSize += chunk.length;
    });
    stream.on('end', () => {
      resolve({
        checksum: hash.digest('hex'),
        fileSizeMB: fileSize / (1024 * 1024)
      });
    });
    stream.on('error', reject);
  });
}

/**
 * Garante que o nome físico (volume + nome_arquivo + extensao) ainda está
 * livre. O caminho de download é reconstruído como
 *   <volume>/<nome_arquivo>.<extensao>
 * portanto dois arquivos com o mesmo trio sobrescreveriam um ao outro no
 * volume. Recusar aqui (no prepare) evita corrupção silenciosa do acervo.
 *
 * @param {object} t            tarefa/transação pg-promise
 * @param {number} volumeId     volume_armazenamento_id (null para Tileserver — ignorado)
 * @param {string} nomeArquivo  nome físico sem extensão
 * @param {string} extensao     extensão sem o ponto
 * @param {Set<string>} usados  chaves já reservadas neste mesmo lote
 */
async function assertNomeFisicoLivre(t, volumeId, nomeArquivo, extensao, usados) {
  // Tileserver não tem arquivo físico em volume
  if (volumeId === null || volumeId === undefined) return;

  const chave = `${volumeId}/${nomeArquivo}.${extensao}`;

  if (usados && usados.has(chave)) {
    throw new AppError(
      `Dois arquivos deste envio resolvem para o mesmo nome físico "${nomeArquivo}.${extensao}" no volume ${volumeId}. ` +
      `Os nomes físicos devem ser únicos no volume.`,
      httpCode.Conflict
    );
  }

  const existente = await t.oneOrNone(
    `SELECT id FROM acervo.arquivo
     WHERE volume_armazenamento_id = $1 AND nome_arquivo = $2 AND extensao = $3
     LIMIT 1`,
    [volumeId, nomeArquivo, extensao]
  );
  if (existente) {
    throw new AppError(
      `Já existe um arquivo com o nome físico "${nomeArquivo}.${extensao}" no volume ${volumeId} ` +
      `(arquivo id ${existente.id}). Os nomes físicos devem ser únicos para não sobrescrever o acervo.`,
      httpCode.Conflict
    );
  }

  if (usados) usados.add(chave);
}

const {
  DB_USER,
  DB_PASSWORD,
  DB_SERVER,
  DB_PORT,
  DB_NAME
} = require('../config')

const controller = {};

controller.atualizaArquivo = async (arquivo, usuarioUuid) => {
  return db.conn.tx(async t => {
    try {
      arquivo.data_modificacao = new Date();
      arquivo.usuario_modificacao_uuid = usuarioUuid;

      const arquivoAtual = await t.oneOrNone(
        `SELECT tipo_arquivo_id FROM acervo.arquivo WHERE id = $1`,
        [arquivo.id]
      );

      if (!arquivoAtual) {
        throw new AppError('Arquivo não encontrado', httpCode.NotFound);
      }

      // Os CHECKs de acervo.arquivo exigem nome_arquivo URL e
      // extensao/tamanho_mb/checksum NULL para Tileserver (e o inverso para os
      // demais tipos); como este UPDATE não altera esses campos, cruzar a
      // fronteira do tipo Tileserver sempre violaria um CHECK
      const eraTileserver = Number(arquivoAtual.tipo_arquivo_id) === TIPO_ARQUIVO.TILESERVER;
      const seraTileserver = arquivo.tipo_arquivo_id === TIPO_ARQUIVO.TILESERVER;
      if (eraTileserver !== seraTileserver) {
        throw new AppError(
          'Não é possível alterar o tipo de um arquivo de/para Tileserver. Exclua o arquivo e cadastre novamente com o tipo correto.',
          httpCode.BadRequest
        );
      }

      // crs_original é o único campo opcional deste PUT e o def:null abaixo
      // apagava o CRS gravado de quem simplesmente não mandou a chave. Ausente
      // agora preserva; null explícito ainda limpa.
      await preserveOmitted(t, {
        table: 'arquivo',
        id: arquivo.id,
        fields: ['crs_original'],
        body: arquivo
      });

      const colunasArquivo = [
        'nome', 'tipo_arquivo_id', 'volume_armazenamento_id',
        'metadado', 'tipo_status_id', 'situacao_carregamento_id', 'descricao', 
        { name: 'crs_original', def: null }, 'data_modificacao', 'usuario_modificacao_uuid'
      ];

      const cs = new db.pgp.helpers.ColumnSet(colunasArquivo, { table: { table: 'arquivo', schema: 'acervo' } });
      const query = db.pgp.helpers.update(arquivo, cs) + ' WHERE id = $1';

      const result = await t.result(query, [arquivo.id]);

      if (result.rowCount === 0) {
        throw new AppError('Arquivo não encontrado', httpCode.NotFound);
      }

    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(`Erro ao atualizar arquivo: ${error.message}`, httpCode.InternalError, error);
    }
  });
};

/**
 * Recalcula checksum e tamanho a partir do arquivo que ESTÁ no volume, e grava.
 *
 * Existe para a recompressão sem perda do acervo: o GeoTIFF é reescrito com
 * COMPRESS=DEFLATE, o pixel continua idêntico, mas o SHA-256 do arquivo muda.
 * Sem isto o plugin recusa o download (valida checksum depois de copiar) e
 * gerencia.verificarConsistencia marca ERRO_CARREGAMENTO.
 *
 * O cliente NÃO declara checksum nem tamanho. Ele só aponta quais ids releu.
 * Quem mede é o servidor, lendo o byte no volume. É a diferença entre esta rota
 * e um UPDATE manual no banco.
 *
 * Não substitui prepareReplaceFiles: aquele troca o ARQUIVO (id e uuid novos,
 * linha antiga para arquivo_deletado). Este preserva id, uuid e histórico de
 * download, porque o arquivo é o mesmo, só mudou o empacotamento.
 */
controller.atualizarChecksum = async (arquivoIds, motivo, usuarioUuid) => {
  const arquivos = await db.conn.any(`
    SELECT a.id, a.nome_arquivo, a.extensao, a.checksum, a.tamanho_mb,
           a.tipo_arquivo_id, v.volume
    FROM acervo.arquivo a
    JOIN acervo.volume_armazenamento v ON a.volume_armazenamento_id = v.id
    WHERE a.id IN ($<ids:csv>)
  `, { ids: arquivoIds });

  if (arquivos.length !== arquivoIds.length) {
    const achados = new Set(arquivos.map(a => Number(a.id)));
    throw new AppError(
      `Arquivos não encontrados ou sem volume: ${arquivoIds.filter(i => !achados.has(Number(i))).join(', ')}`,
      httpCode.NotFound
    );
  }

  const tileserver = arquivos.filter(a => Number(a.tipo_arquivo_id) === TIPO_ARQUIVO.TILESERVER);
  if (tileserver.length > 0) {
    throw new AppError(
      `Arquivo Tileserver não tem arquivo físico no volume: ${tileserver.map(a => a.id).join(', ')}`,
      httpCode.BadRequest
    );
  }

  // Leitura e hash FORA da transação: o cálculo é longo e seguraria a conexão
  // aberta o tempo todo. Mesmo motivo de gerencia_ctrl.verificarConsistencia.
  // Qualquer arquivo ausente aborta ANTES de gravar qualquer linha.
  const medidos = [];
  for (const a of arquivos) {
    const filePath = caminhoNoVolume(a.volume, `${a.nome_arquivo}.${a.extensao}`);
    try {
      await fs.access(filePath);
    } catch (error) {
      throw new AppError(
        `Arquivo ${a.id} (${a.nome_arquivo}.${a.extensao}) não existe no volume. Nada foi alterado.`,
        httpCode.BadRequest
      );
    }
    const { checksum, fileSizeMB } = await calculateChecksumStream(filePath);
    medidos.push({
      id: a.id,
      nome_arquivo: a.nome_arquivo,
      extensao: a.extensao,
      checksum_anterior: a.checksum,
      checksum_novo: checksum,
      tamanho_mb_anterior: Number(a.tamanho_mb),
      tamanho_mb_novo: fileSizeMB,
      alterado: checksum !== a.checksum
    });
  }

  const alterados = medidos.filter(m => m.alterado);

  if (alterados.length > 0) {
    const data_modificacao = new Date();
    await db.conn.tx(async t => {
      for (const m of alterados) {
        await t.none(`
          UPDATE acervo.arquivo
          SET checksum = $<checksum>, tamanho_mb = $<tamanho_mb>,
              data_modificacao = $<data_modificacao>,
              usuario_modificacao_uuid = $<usuarioUuid>
          WHERE id = $<id>
        `, {
          checksum: m.checksum_novo,
          tamanho_mb: m.tamanho_mb_novo,
          data_modificacao,
          usuarioUuid,
          id: m.id
        });
      }
    });
  }

  logger.info('Checksum de arquivo atualizado por releitura do volume', {
    usuarioUuid,
    motivo,
    solicitados: arquivoIds.length,
    alterados: alterados.length,
    detalhe: alterados.map(m => ({
      id: m.id,
      de: m.checksum_anterior,
      para: m.checksum_novo,
      mb_de: m.tamanho_mb_anterior,
      mb_para: m.tamanho_mb_novo
    }))
  });

  return {
    solicitados: arquivoIds.length,
    alterados: alterados.length,
    inalterados: medidos.length - alterados.length,
    economia_mb: alterados.reduce((s, m) => s + (m.tamanho_mb_anterior - m.tamanho_mb_novo), 0),
    arquivos: medidos
  };
};

controller.deleteArquivos = async (arquivoIds, motivo_exclusao, usuarioUuid) => {
  const data_delete = new Date();
  const usuario_delete_uuid = usuarioUuid;

  return db.conn.tx(async t => {
    try {
      // Verificar se todos os IDs de arquivo existem
      const existingFiles = await t.any(
        `SELECT id FROM acervo.arquivo WHERE id IN ($1:csv)`,
        [arquivoIds]
      );

      if (existingFiles.length !== arquivoIds.length) {
        // BIGSERIAL retorna como string no driver — normalizar para número
        const existingIds = existingFiles.map(f => Number(f.id));
        const missingIds = arquivoIds.filter(id => !existingIds.includes(parseInt(id)));
        throw new AppError(`Os seguintes arquivos não foram encontrados: ${missingIds.join(', ')}`, httpCode.NotFound);
      }

      for (let id of arquivoIds) {
        const arquivo = await t.one('SELECT * FROM acervo.arquivo WHERE id = $1', [id]);

        // Move the file to arquivo_deletado table
        const { id: arquivoDeletadoId } = await t.one(
          `INSERT INTO acervo.arquivo_deletado (
            uuid_arquivo, nome, nome_arquivo, motivo_exclusao, versao_id, tipo_arquivo_id, 
            volume_armazenamento_id, extensao, tamanho_mb, checksum, metadado, 
            tipo_status_id, situacao_carregamento_id, descricao, crs_original,
            data_cadastramento, usuario_cadastramento_uuid, data_modificacao, 
            usuario_modificacao_uuid, data_delete, usuario_delete_uuid
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 
                    $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
          RETURNING id`,
          [
            arquivo.uuid_arquivo, 
            arquivo.nome, 
            arquivo.nome_arquivo, 
            motivo_exclusao, 
            arquivo.versao_id, 
            arquivo.tipo_arquivo_id, 
            arquivo.volume_armazenamento_id, 
            arquivo.extensao, 
            arquivo.tamanho_mb, 
            arquivo.checksum, 
            arquivo.metadado, 
            STATUS_ARQUIVO.EXCLUIDO,
            arquivo.situacao_carregamento_id, 
            arquivo.descricao, 
            arquivo.crs_original,
            arquivo.data_cadastramento, 
            arquivo.usuario_cadastramento_uuid, 
            arquivo.data_modificacao, 
            arquivo.usuario_modificacao_uuid, 
            data_delete, 
            usuario_delete_uuid
          ]
        );

        try {
          // Move related downloads to download_deletado table for THIS file
          await t.none(
            `INSERT INTO acervo.download_deletado (arquivo_deletado_id, usuario_uuid, data_download)
             SELECT $1, d.usuario_uuid, d.data_download
             FROM acervo.download d
             WHERE d.arquivo_id = $2`,
            [arquivoDeletadoId, arquivo.id]
          );

          // Delete related downloads from the original download table
          await t.none('DELETE FROM acervo.download WHERE arquivo_id = $1', [arquivo.id]);
        } catch (downloadError) {
          throw new AppError(
            `Erro ao processar downloads do arquivo ${arquivo.nome}: ${downloadError.message}`, 
            httpCode.InternalError, 
            downloadError
          );
        }

        // Finally, delete the file itself from the arquivo table
        await t.none('DELETE FROM acervo.arquivo WHERE id = $1', [arquivo.id]);
      }

    } catch (error) {
      // Se não for um AppError, cria um
      if (!(error instanceof AppError)) {
        throw new AppError(`Erro ao deletar arquivos: ${error.message}`, httpCode.InternalError, error);
      }
      throw error;
    }
  });
};

controller.prepareAddFiles = async (requestData, usuarioUuid) => {
  return db.conn.tx(async t => {
    try {
      const { arquivos } = requestData;
      
      // Verify all versao_ids exist and get their product types
      const versao_ids = [...new Set(arquivos.map(a => a.versao_id))];
      
      const versoes = await t.any(
        `SELECT v.id, v.produto_id, p.tipo_produto_id
         FROM acervo.versao v
         JOIN acervo.produto p ON v.produto_id = p.id
         WHERE v.id IN ($1:csv)`,
        [versao_ids]
      );
      
      if (versoes.length !== versao_ids.length) {
        const foundIds = versoes.map(v => Number(v.id));
        const missingIds = versao_ids.filter(id => !foundIds.includes(id));
        throw new AppError(`Versões não encontradas com IDs: ${missingIds.join(', ')}`, httpCode.NotFound);
      }
      
      // Criar mapeamento de versões
      const versaoMap = {};
      versoes.forEach(v => {
        versaoMap[v.id] = v;
      });
      
      // Get volumes for all product types
      const productTypes = [...new Set(versoes.map(v => v.tipo_produto_id))];
      const volumeTypes = await t.any(
        `SELECT vtp.tipo_produto_id, vtp.volume_armazenamento_id, va.volume, va.capacidade_gb
         FROM acervo.volume_tipo_produto vtp
         JOIN acervo.volume_armazenamento va ON va.id = vtp.volume_armazenamento_id
         WHERE vtp.tipo_produto_id IN ($1:csv) AND vtp.primario = TRUE`,
        [productTypes]
      );
      
      const volumeByProductType = {};
      volumeTypes.forEach(vt => {
        volumeByProductType[vt.tipo_produto_id] = vt;
      });
      
      // Check if all product types have primary volumes
      for (const pt of productTypes) {
        if (!volumeByProductType[pt]) {
          throw new AppError(`Não existe volume primário cadastrado para o tipo de produto ${pt}`, httpCode.BadRequest);
        }
      }
      
      // Check if any file already exists for its version
      for (const arquivo of arquivos) {
        // A chave fisica e (volume, nome_arquivo, extensao); arquivos irmaos de uma
        // mesma versao (ex.: .tif principal + .pdf + .json de edicao) compartilham
        // nome_arquivo e so diferem na extensao. Por isso o check inclui extensao
        // (IS NOT DISTINCT FROM trata o NULL do Tileserver como igualdade).
        const arquivoExistente = await t.oneOrNone(
          `SELECT id FROM acervo.arquivo
           WHERE nome_arquivo = $1 AND extensao IS NOT DISTINCT FROM $2 AND versao_id = $3`,
          [arquivo.nome_arquivo, arquivo.extensao, arquivo.versao_id]
        );

        if (arquivoExistente) {
          throw new AppError(`Arquivo ${arquivo.nome_arquivo}.${arquivo.extensao} já existe para a versão ${arquivo.versao_id}`, httpCode.Conflict);
        }

        // Espelha a UNIQUE unique_file_per_version (checksum, versao_id):
        // sem este check a duplicata só estouraria no confirm, após a
        // transferência dos arquivos
        if (arquivo.checksum) {
          const checksumExistente = await t.oneOrNone(
            `SELECT id FROM acervo.arquivo
             WHERE checksum = $1 AND versao_id = $2`,
            [arquivo.checksum, arquivo.versao_id]
          );

          if (checksumExistente) {
            throw new AppError(`Já existe arquivo com o mesmo checksum para a versão ${arquivo.versao_id} (${arquivo.nome_arquivo})`, httpCode.Conflict);
          }
        }
      }

      // Duplicatas de checksum dentro do próprio payload
      const chavesChecksum = arquivos.filter(a => a.checksum).map(a => `${a.checksum}|${a.versao_id}`);
      const checksumDuplicado = chavesChecksum.filter((c, i) => chavesChecksum.indexOf(c) !== i);
      if (checksumDuplicado.length > 0) {
        throw new AppError('A requisição contém arquivos com checksum duplicado para a mesma versão', httpCode.BadRequest);
      }

      // Calculate required space per volume
      const spaceNeededByVolume = {};
      for (const arquivo of arquivos) {
        const versao = versoes.find(v => Number(v.id) === Number(arquivo.versao_id));
        const volume = volumeByProductType[versao.tipo_produto_id];
        
        if (!spaceNeededByVolume[volume.volume_armazenamento_id]) {
          spaceNeededByVolume[volume.volume_armazenamento_id] = 0;
        }
        spaceNeededByVolume[volume.volume_armazenamento_id] += arquivo.tamanho_mb || 0;
      }
      
      // Check space availability for each volume
      for (const [volumeId, space] of Object.entries(spaceNeededByVolume)) {
        const spaceGB = space / 1024; // Convert to GB
        const espacoDisponivel = await t.one(
          `SELECT (va.capacidade_gb - COALESCE(SUM(a.tamanho_mb), 0) / 1024) as espaco_disponivel
           FROM acervo.volume_armazenamento va
           LEFT JOIN acervo.arquivo a ON a.volume_armazenamento_id = va.id
           WHERE va.id = $1
           GROUP BY va.id, va.capacidade_gb`,
          [volumeId]
        );
        
        if (espacoDisponivel.espaco_disponivel < spaceGB) {
          throw new AppError(`Espaço insuficiente no volume de armazenamento ${volumeId}. Necessário: ${spaceGB.toFixed(2)}GB, Disponível: ${espacoDisponivel.espaco_disponivel.toFixed(2)}GB`, httpCode.BadRequest);
        }
      }
      
      // Create upload session
      const { id: sessionId, uuid_session } = await t.one(
        `INSERT INTO acervo.upload_session(
          usuario_uuid, operation_type
        ) VALUES ($1, $2) RETURNING id, uuid_session`,
        [usuarioUuid, 'add_files']
      );
      
      // Process files
      const arquivosInfo = [];
      const nomesFisicosUsados = new Set();

      for (const arquivo of arquivos) {
        const versao = versoes.find(v => Number(v.id) === Number(arquivo.versao_id));
        const volume = volumeByProductType[versao.tipo_produto_id];
        const isTileserver = arquivo.tipo_arquivo_id === TIPO_ARQUIVO.TILESERVER;
          // Tileserver é uma URL — sem arquivo físico, volume ou extensão
          const destinationPath = isTileserver
            ? arquivo.nome_arquivo
            : caminhoNoVolume(volume.volume, `${arquivo.nome_arquivo}.${arquivo.extensao}`);

        // Impede colisão de nome físico no volume (sobrescrita silenciosa)
        await assertNomeFisicoLivre(
          t,
          isTileserver ? null : volume.volume_armazenamento_id,
          arquivo.nome_arquivo, arquivo.extensao, nomesFisicosUsados
        );

        // Register file in the temporary table
        await t.none(
          `INSERT INTO acervo.upload_arquivo_temp(
            session_id, nome, nome_arquivo, destination_path, 
            tipo_arquivo_id, volume_armazenamento_id, extensao, tamanho_mb, 
            expected_checksum, metadado, situacao_carregamento_id, 
            descricao, crs_original, versao_id
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
          [
            sessionId, 
            arquivo.nome, 
            arquivo.nome_arquivo, 
            destinationPath, 
            arquivo.tipo_arquivo_id,
            isTileserver ? null : volume.volume_armazenamento_id,
            arquivo.extensao, 
            arquivo.tamanho_mb,
            arquivo.checksum, 
            arquivo.metadado || {}, 
            arquivo.situacao_carregamento_id || SITUACAO_CARREGAMENTO.NAO_CARREGADO,
            arquivo.descricao || '',
            arquivo.crs_original || null,
            arquivo.versao_id
          ]
        );
        
        arquivosInfo.push({
          uuid_arquivo: arquivo.uuid_arquivo || null,
          nome: arquivo.nome,
          nome_arquivo: arquivo.nome_arquivo,
          tipo_arquivo_id: arquivo.tipo_arquivo_id,
          versao_id: arquivo.versao_id,
          destination_path: destinationPath,
          checksum: arquivo.checksum
        });
      }
      
      return {
        session_uuid: uuid_session,
        operation_type: 'add_files',
        arquivos: arquivosInfo
      };
    } catch (error) {
      if (!(error instanceof AppError)) {
        throw new AppError(`Erro ao preparar upload de arquivos: ${error.message}`, httpCode.InternalError, error);
      }
      throw error;
    }
  });
};

/**
 * Prepara a SUBSTITUICAO de conteudo de arquivos em versoes EXISTENTES, sem criar
 * nova versao. Difere do prepareAddFiles em dois pontos: (1) NAO aplica os checks
 * de colisao contra o acervo -- substituir o arquivo que ja ocupa o slot
 * (versao_id, nome_arquivo, extensao) e justamente o objetivo, e um irmao de mesmo
 * nome_arquivo (ex.: o .json) deve coexistir; (2) o destination_path e o mesmo do
 * arquivo atual, entao a transferencia sobrescreve o fisico no lugar (sem orfao).
 * A troca em si (soft-delete do antigo + insert do novo) acontece atomicamente no
 * confirm-upload (processReplaceFiles). A unicidade (checksum, versao_id) segue
 * garantida pela constraint do banco no INSERT do confirm.
 */
controller.prepareReplaceFiles = async (requestData, usuarioUuid) => {
  return db.conn.tx(async t => {
    try {
      const { arquivos } = requestData;

      // Verifica se todas as versoes existem e pega o tipo de produto de cada
      const versao_ids = [...new Set(arquivos.map(a => a.versao_id))];
      const versoes = await t.any(
        `SELECT v.id, v.produto_id, p.tipo_produto_id
         FROM acervo.versao v
         JOIN acervo.produto p ON v.produto_id = p.id
         WHERE v.id IN ($1:csv)`,
        [versao_ids]
      );
      if (versoes.length !== versao_ids.length) {
        const foundIds = versoes.map(v => Number(v.id));
        const missingIds = versao_ids.filter(id => !foundIds.includes(id));
        throw new AppError(`Versões não encontradas com IDs: ${missingIds.join(', ')}`, httpCode.NotFound);
      }

      // Volume primario por tipo de produto
      const productTypes = [...new Set(versoes.map(v => v.tipo_produto_id))];
      const volumeTypes = await t.any(
        `SELECT vtp.tipo_produto_id, vtp.volume_armazenamento_id, va.volume, va.capacidade_gb
         FROM acervo.volume_tipo_produto vtp
         JOIN acervo.volume_armazenamento va ON va.id = vtp.volume_armazenamento_id
         WHERE vtp.tipo_produto_id IN ($1:csv) AND vtp.primario = TRUE`,
        [productTypes]
      );
      const volumeByProductType = {};
      volumeTypes.forEach(vt => { volumeByProductType[vt.tipo_produto_id] = vt; });
      for (const pt of productTypes) {
        if (!volumeByProductType[pt]) {
          throw new AppError(`Não existe volume primário cadastrado para o tipo de produto ${pt}`, httpCode.BadRequest);
        }
      }

      // Duplicatas de checksum dentro do proprio payload (mesma versao)
      const chavesChecksum = arquivos.filter(a => a.checksum).map(a => `${a.checksum}|${a.versao_id}`);
      if (chavesChecksum.some((c, i) => chavesChecksum.indexOf(c) !== i)) {
        throw new AppError('A requisição contém arquivos com checksum duplicado para a mesma versão', httpCode.BadRequest);
      }

      // Cria a sessao de upload
      const { id: sessionId, uuid_session } = await t.one(
        `INSERT INTO acervo.upload_session(usuario_uuid, operation_type)
         VALUES ($1, $2) RETURNING id, uuid_session`,
        [usuarioUuid, 'replace_files']
      );

      const arquivosInfo = [];
      const nomesFisicosUsados = new Set();
      for (const arquivo of arquivos) {
        const versao = versoes.find(v => Number(v.id) === Number(arquivo.versao_id));
        const volume = volumeByProductType[versao.tipo_produto_id];
        const isTileserver = arquivo.tipo_arquivo_id === TIPO_ARQUIVO.TILESERVER;
        const destinationPath = isTileserver
          ? arquivo.nome_arquivo
          : caminhoNoVolume(volume.volume, `${arquivo.nome_arquivo}.${arquivo.extensao}`);

        // So impede que DOIS arquivos DESTE envio resolvam para o mesmo nome fisico.
        // (Nao checamos o acervo: substituir o slot existente e o objetivo.)
        if (!isTileserver) {
          const chave = `${volume.volume_armazenamento_id}/${arquivo.nome_arquivo}.${arquivo.extensao}`;
          if (nomesFisicosUsados.has(chave)) {
            throw new AppError(`Dois arquivos deste envio resolvem para o mesmo nome físico "${arquivo.nome_arquivo}.${arquivo.extensao}" no volume ${volume.volume_armazenamento_id}.`, httpCode.Conflict);
          }
          nomesFisicosUsados.add(chave);
        }

        await t.none(
          `INSERT INTO acervo.upload_arquivo_temp(
            session_id, nome, nome_arquivo, destination_path,
            tipo_arquivo_id, volume_armazenamento_id, extensao, tamanho_mb,
            expected_checksum, metadado, situacao_carregamento_id,
            descricao, crs_original, versao_id
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
          [
            sessionId,
            arquivo.nome,
            arquivo.nome_arquivo,
            destinationPath,
            arquivo.tipo_arquivo_id,
            isTileserver ? null : volume.volume_armazenamento_id,
            arquivo.extensao,
            arquivo.tamanho_mb,
            arquivo.checksum,
            arquivo.metadado || {},
            arquivo.situacao_carregamento_id || SITUACAO_CARREGAMENTO.NAO_CARREGADO,
            arquivo.descricao || '',
            arquivo.crs_original || null,
            arquivo.versao_id
          ]
        );

        arquivosInfo.push({
          uuid_arquivo: arquivo.uuid_arquivo || null,
          nome: arquivo.nome,
          nome_arquivo: arquivo.nome_arquivo,
          tipo_arquivo_id: arquivo.tipo_arquivo_id,
          versao_id: arquivo.versao_id,
          destination_path: destinationPath,
          checksum: arquivo.checksum
        });
      }

      return {
        session_uuid: uuid_session,
        operation_type: 'replace_files',
        arquivos: arquivosInfo
      };
    } catch (error) {
      if (!(error instanceof AppError)) {
        throw new AppError(`Erro ao preparar substituição de arquivos: ${error.message}`, httpCode.InternalError, error);
      }
      throw error;
    }
  });
};

controller.prepareAddVersion = async (requestData, usuarioUuid) => {
  return db.conn.tx(async t => {
    try {
      const { versoes } = requestData;
      
      // Verify all product_ids exist
      const produto_ids = [...new Set(versoes.map(v => v.produto_id))];
      
      const produtos = await t.any(
        'SELECT id, tipo_produto_id FROM acervo.produto WHERE id IN ($1:csv)',
        [produto_ids]
      );
      
      if (produtos.length !== produto_ids.length) {
        const foundIds = produtos.map(p => Number(p.id));
        const missingIds = produto_ids.filter(id => !foundIds.includes(parseInt(id)));
        throw new AppError(`Produtos não encontrados com IDs: ${missingIds.join(', ')}`, httpCode.NotFound);
      }
      
      // Create mapping for easier access
      const produtoMap = {};
      produtos.forEach(p => {
        produtoMap[p.id] = p;
      });
      
      // Check if any version name already exists for its product
      for (const item of versoes) {
        const versaoExistente = await t.oneOrNone(
          'SELECT id FROM acervo.versao WHERE produto_id = $1 AND versao = $2 AND subtipo_produto_id = $3',
          [item.produto_id, item.versao.versao, item.versao.subtipo_produto_id]
        );

        if (versaoExistente) {
          throw new AppError(`Já existe uma versão com o nome "${item.versao.versao}" (subtipo ${item.versao.subtipo_produto_id}) para o produto ${item.produto_id}`, httpCode.Conflict);
        }
      }

      // Espelha o trigger acervo.validate_version: versão "N-SIGLA" com N > 1
      // exige a versão anterior (exceto registros históricos). Sem este check a
      // falha só estouraria no confirm, após a transferência dos arquivos
      for (const item of versoes) {
        const match = /^([0-9]+)-([A-Z]{1,5})$/.exec(item.versao.versao);
        if (!match || item.versao.tipo_versao_id === TIPO_VERSAO.REGISTRO_HISTORICO) {
          continue;
        }

        const numero = parseInt(match[1], 10);
        if (numero <= 1) {
          continue;
        }

        const versaoAnterior = `${numero - 1}-${match[2]}`;
        const anteriorNoPayload = versoes.some(v =>
          v.produto_id === item.produto_id && v.versao.versao === versaoAnterior
        );

        if (!anteriorNoPayload) {
          const anterior = await t.oneOrNone(
            'SELECT id FROM acervo.versao WHERE produto_id = $1 AND versao = $2',
            [item.produto_id, versaoAnterior]
          );

          if (!anterior) {
            throw new AppError(`Não existe a versão anterior ${versaoAnterior} para o produto ${item.produto_id}`, httpCode.BadRequest);
          }
        }
      }

      // Get volumes for all product types
      const productTypes = [...new Set(produtos.map(p => p.tipo_produto_id))];
      const volumeTypes = await t.any(
        `SELECT vtp.tipo_produto_id, vtp.volume_armazenamento_id, va.volume, va.capacidade_gb
         FROM acervo.volume_tipo_produto vtp
         JOIN acervo.volume_armazenamento va ON va.id = vtp.volume_armazenamento_id
         WHERE vtp.tipo_produto_id IN ($1:csv) AND vtp.primario = TRUE`,
        [productTypes]
      );
      
      const volumeByProductType = {};
      volumeTypes.forEach(vt => {
        volumeByProductType[vt.tipo_produto_id] = vt;
      });
      
      // Check if all product types have primary volumes
      for (const pt of productTypes) {
        if (!volumeByProductType[pt]) {
          throw new AppError(`Não existe volume primário cadastrado para o tipo de produto ${pt}`, httpCode.BadRequest);
        }
      }
      
      // Calculate required space per volume
      const spaceNeededByVolume = {};
      for (const item of versoes) {
        const produto = produtoMap[item.produto_id];
        const volume = volumeByProductType[produto.tipo_produto_id];
        
        if (!spaceNeededByVolume[volume.volume_armazenamento_id]) {
          spaceNeededByVolume[volume.volume_armazenamento_id] = 0;
        }
        
        for (const arquivo of item.arquivos) {
          spaceNeededByVolume[volume.volume_armazenamento_id] += arquivo.tamanho_mb || 0;
        }
      }
      
      // Check space availability for each volume
      for (const [volumeId, space] of Object.entries(spaceNeededByVolume)) {
        const spaceGB = space / 1024; // Convert to GB
        const espacoDisponivel = await t.one(
          `SELECT (va.capacidade_gb - COALESCE(SUM(a.tamanho_mb), 0) / 1024) as espaco_disponivel
           FROM acervo.volume_armazenamento va
           LEFT JOIN acervo.arquivo a ON a.volume_armazenamento_id = va.id
           WHERE va.id = $1
           GROUP BY va.id, va.capacidade_gb`,
          [volumeId]
        );
        
        if (espacoDisponivel.espaco_disponivel < spaceGB) {
          throw new AppError(`Espaço insuficiente no volume de armazenamento ${volumeId}. Necessário: ${spaceGB.toFixed(2)}GB, Disponível: ${espacoDisponivel.espaco_disponivel.toFixed(2)}GB`, httpCode.BadRequest);
        }
      }
      
      // Create upload session
      const { id: sessionId, uuid_session } = await t.one(
        `INSERT INTO acervo.upload_session(
          usuario_uuid, operation_type
        ) VALUES ($1, $2) RETURNING id, uuid_session`,
        [usuarioUuid, 'add_version']
      );
      
      // Process each version and its files
      const result = [];
      const nomesFisicosUsados = new Set();

      for (const item of versoes) {
        const produto = produtoMap[item.produto_id];
        const volume = volumeByProductType[produto.tipo_produto_id];
        
        // Create temporary version
        const { id: versaoTempId } = await t.one(
          `INSERT INTO acervo.upload_versao_temp(
            session_id, uuid_versao, versao, nome, tipo_versao_id, 
            subtipo_produto_id, lote_id, metadado, descricao, 
            data_criacao, data_edicao, produto_id, orgao_produtor, palavras_chave
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
          RETURNING id`,
          [
            sessionId,
            item.versao.uuid_versao || uuidv4(),
            item.versao.versao,
            item.versao.nome,
            item.versao.tipo_versao_id,
            item.versao.subtipo_produto_id,
            item.versao.lote_id,
            item.versao.metadado || {},
            item.versao.descricao || '',
            item.versao.data_criacao,
            item.versao.data_edicao,
            item.produto_id,
            item.versao.orgao_produtor,
            item.versao.palavras_chave || []
          ]
        );
        
        // Process files for this version
        const arquivosInfo = [];
        
        for (const arquivo of item.arquivos) {
          const isTileserver = arquivo.tipo_arquivo_id === TIPO_ARQUIVO.TILESERVER;
          // Tileserver é uma URL — sem arquivo físico, volume ou extensão
          const destinationPath = isTileserver
            ? arquivo.nome_arquivo
            : caminhoNoVolume(volume.volume, `${arquivo.nome_arquivo}.${arquivo.extensao}`);

          // Impede colisão de nome físico no volume (sobrescrita silenciosa)
          await assertNomeFisicoLivre(
            t,
            isTileserver ? null : volume.volume_armazenamento_id,
            arquivo.nome_arquivo, arquivo.extensao, nomesFisicosUsados
          );

          // Register file in the temporary table
          await t.none(
            `INSERT INTO acervo.upload_arquivo_temp(
              session_id, nome, nome_arquivo, destination_path,
              tipo_arquivo_id, volume_armazenamento_id, extensao, tamanho_mb,
              expected_checksum, metadado, situacao_carregamento_id,
              descricao, crs_original, versao_temp_id
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
            [
              sessionId, 
              arquivo.nome, 
              arquivo.nome_arquivo, 
              destinationPath, 
              arquivo.tipo_arquivo_id,
              isTileserver ? null : volume.volume_armazenamento_id,
              arquivo.extensao, 
              arquivo.tamanho_mb,
              arquivo.checksum, 
              arquivo.metadado || {}, 
              arquivo.situacao_carregamento_id || SITUACAO_CARREGAMENTO.NAO_CARREGADO,
              arquivo.descricao || '',
              arquivo.crs_original || null,
              versaoTempId
            ]
          );
          
          arquivosInfo.push({
            uuid_arquivo: arquivo.uuid_arquivo || null,
            nome: arquivo.nome,
            nome_arquivo: arquivo.nome_arquivo,
            tipo_arquivo_id: arquivo.tipo_arquivo_id,
            destination_path: destinationPath,
            checksum: arquivo.checksum
          });
        }

        result.push({
          produto_id: item.produto_id,
          versao_info: item.versao,
          arquivos: arquivosInfo
        });
      }
      
      return {
        session_uuid: uuid_session,
        operation_type: 'add_version',
        versoes: result
      };
    } catch (error) {
      if (!(error instanceof AppError)) {
        throw new AppError(`Erro ao preparar upload de versão: ${error.message}`, httpCode.InternalError, error);
      }
      throw error;
    }
  });
};

controller.prepareAddProduct = async (requestData, usuarioUuid) => {
  return db.conn.tx(async t => {
    try {
      const { produtos } = requestData;
      
      // Check for duplicate INOMs.
      // A mesma MI/INOM pode gerar produtos distintos por TIPO (ex.: Carta
      // Topográfica e o CDGV de mesma folha são produtos separados — ver
      // regras_carga_produtos.md 2.4). Desde 2026-07-06 a identidade também
      // considera o SUBTIPO quando ele exige produto próprio (define_produto),
      // p.ex. a Carta Topográfica Militar (24) coexiste com a civil na mesma
      // folha como produto separado (ver acervo.validate_version). Logo a
      // unicidade é por (INOM, tipo_produto_id, subtipo_produto_id).
      const inomKeys = produtos
        .filter(p => p.produto.inom !== null && p.produto.inom !== '')
        .map(p => `${p.produto.inom}|${p.produto.tipo_produto_id}|${p.produto.subtipo_produto_id ?? ''}`);
      const uniqueInomKeys = [...new Set(inomKeys)];

      if (inomKeys.length !== uniqueInomKeys.length) {
        throw new AppError('Existem produtos com mesmo INOM, tipo e subtipo duplicados na solicitação', httpCode.BadRequest);
      }

      // Check if any (INOM, tipo_produto, subtipo_produto) already exists in the database
      for (const item of produtos) {
        if (item.produto.inom) {
          const existingProduct = await t.oneOrNone(
            'SELECT id FROM acervo.produto WHERE inom = $1 AND tipo_produto_id = $2 AND subtipo_produto_id IS NOT DISTINCT FROM $3',
            [item.produto.inom, item.produto.tipo_produto_id, item.produto.subtipo_produto_id ?? null]
          );

          if (existingProduct) {
            throw new AppError(`Já existe um produto do mesmo tipo e subtipo com o INOM ${item.produto.inom}`, httpCode.Conflict);
          }
        }
      }

      // Espelha o trigger acervo.validate_version: como os produtos são novos,
      // versão "N-SIGLA" com N > 1 exige a versão anterior dentro do próprio
      // payload (exceto registros históricos). Também valida duplicatas
      for (const item of produtos) {
        const versoesProduto = item.versoes.map(v => v.versao);
        const versaoDuplicada = versoesProduto.filter((v, i) => versoesProduto.indexOf(v) !== i);
        if (versaoDuplicada.length > 0) {
          throw new AppError(`O produto ${item.produto.inom || item.produto.nome} contém versões duplicadas: ${[...new Set(versaoDuplicada)].join(', ')}`, httpCode.BadRequest);
        }

        for (const versao of item.versoes) {
          const match = /^([0-9]+)-([A-Z]{1,5})$/.exec(versao.versao);
          if (!match || versao.tipo_versao_id === TIPO_VERSAO.REGISTRO_HISTORICO) {
            continue;
          }

          const numero = parseInt(match[1], 10);
          if (numero <= 1) {
            continue;
          }

          const versaoAnterior = `${numero - 1}-${match[2]}`;
          if (!versoesProduto.includes(versaoAnterior)) {
            throw new AppError(`Não existe a versão anterior ${versaoAnterior} para o produto ${item.produto.inom || item.produto.nome} na solicitação`, httpCode.BadRequest);
          }
        }
      }

      // Get volumes for all product types
      const productTypes = [...new Set(produtos.map(p => p.produto.tipo_produto_id))];
      const volumeTypes = await t.any(
        `SELECT vtp.tipo_produto_id, vtp.volume_armazenamento_id, va.volume, va.capacidade_gb
         FROM acervo.volume_tipo_produto vtp
         JOIN acervo.volume_armazenamento va ON va.id = vtp.volume_armazenamento_id
         WHERE vtp.tipo_produto_id IN ($1:csv) AND vtp.primario = TRUE`,
        [productTypes]
      );
      
      const volumeByProductType = {};
      volumeTypes.forEach(vt => {
        volumeByProductType[vt.tipo_produto_id] = vt;
      });
      
      // Check if all product types have primary volumes
      for (const pt of productTypes) {
        if (!volumeByProductType[pt]) {
          throw new AppError(`Não existe volume primário cadastrado para o tipo de produto ${pt}`, httpCode.BadRequest);
        }
      }
      
      // Calculate required space per volume
      const spaceNeededByVolume = {};
      for (const item of produtos) {
        const volume = volumeByProductType[item.produto.tipo_produto_id];
        
        if (!spaceNeededByVolume[volume.volume_armazenamento_id]) {
          spaceNeededByVolume[volume.volume_armazenamento_id] = 0;
        }
        
        for (const versao of item.versoes) {
          for (const arquivo of versao.arquivos) {
            spaceNeededByVolume[volume.volume_armazenamento_id] += arquivo.tamanho_mb || 0;
          }
        }
      }
      
      // Check space availability for each volume
      for (const [volumeId, space] of Object.entries(spaceNeededByVolume)) {
        const spaceGB = space / 1024; // Convert to GB
        const espacoDisponivel = await t.one(
          `SELECT (va.capacidade_gb - COALESCE(SUM(a.tamanho_mb), 0) / 1024) as espaco_disponivel
           FROM acervo.volume_armazenamento va
           LEFT JOIN acervo.arquivo a ON a.volume_armazenamento_id = va.id
           WHERE va.id = $1
           GROUP BY va.id, va.capacidade_gb`,
          [volumeId]
        );
        
        if (espacoDisponivel.espaco_disponivel < spaceGB) {
          throw new AppError(`Espaço insuficiente no volume de armazenamento ${volumeId}. Necessário: ${spaceGB.toFixed(2)}GB, Disponível: ${espacoDisponivel.espaco_disponivel.toFixed(2)}GB`, httpCode.BadRequest);
        }
      }
      
      // Create upload session
      const { id: sessionId, uuid_session } = await t.one(
        `INSERT INTO acervo.upload_session(
          usuario_uuid, operation_type
        ) VALUES ($1, $2) RETURNING id, uuid_session`,
        [usuarioUuid, 'add_product']
      );
      
      // Process each product and its versions
      const result = [];
      const nomesFisicosUsados = new Set();

      for (const item of produtos) {
        const volume = volumeByProductType[item.produto.tipo_produto_id];
        
        // Create temporary product
        const { id: produtoTempId } = await t.one(
          `INSERT INTO acervo.upload_produto_temp(
            session_id, nome, mi, inom, tipo_escala_id,
            denominador_escala_especial, tipo_produto_id, subtipo_produto_id, descricao, geom
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          RETURNING id`,
          [
            sessionId,
            item.produto.nome,
            item.produto.mi,
            item.produto.inom,
            item.produto.tipo_escala_id,
            item.produto.denominador_escala_especial,
            item.produto.tipo_produto_id,
            item.produto.subtipo_produto_id ?? null,
            item.produto.descricao || '',
            item.produto.geom
          ]
        );
        
        // Process each version for this product
        const versoesInfo = [];
        
        for (const versao of item.versoes) {
          // Create temporary version
          const { id: versaoTempId } = await t.one(
            `INSERT INTO acervo.upload_versao_temp(
              session_id, uuid_versao, versao, nome, tipo_versao_id, 
              subtipo_produto_id, lote_id, metadado, descricao, 
              data_criacao, data_edicao, produto_temp_id, orgao_produtor, palavras_chave
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
            RETURNING id`,
            [
              sessionId,
              versao.uuid_versao || uuidv4(),
              versao.versao,
              versao.nome,
              versao.tipo_versao_id,
              versao.subtipo_produto_id,
              versao.lote_id,
              versao.metadado || {},
              versao.descricao || '',
              versao.data_criacao,
              versao.data_edicao,
              produtoTempId,
              versao.orgao_produtor,
              versao.palavras_chave || []
            ]
          );
          
          // Process files for this version
          const arquivosInfo = [];
          
          for (const arquivo of versao.arquivos) {
            const isTileserver = arquivo.tipo_arquivo_id === TIPO_ARQUIVO.TILESERVER;
          // Tileserver é uma URL — sem arquivo físico, volume ou extensão
          const destinationPath = isTileserver
            ? arquivo.nome_arquivo
            : caminhoNoVolume(volume.volume, `${arquivo.nome_arquivo}.${arquivo.extensao}`);

            // Impede colisão de nome físico no volume (sobrescrita silenciosa)
            await assertNomeFisicoLivre(
              t,
              isTileserver ? null : volume.volume_armazenamento_id,
              arquivo.nome_arquivo, arquivo.extensao, nomesFisicosUsados
            );

            // Register file in the temporary table
            await t.none(
              `INSERT INTO acervo.upload_arquivo_temp(
                session_id, nome, nome_arquivo, destination_path, 
                tipo_arquivo_id, volume_armazenamento_id, extensao, tamanho_mb, 
                expected_checksum, metadado, situacao_carregamento_id, 
                descricao, crs_original, versao_temp_id
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
              [
                sessionId, 
                arquivo.nome, 
                arquivo.nome_arquivo, 
                destinationPath, 
                arquivo.tipo_arquivo_id,
                isTileserver ? null : volume.volume_armazenamento_id,
                arquivo.extensao, 
                arquivo.tamanho_mb,
                arquivo.checksum, 
                arquivo.metadado || {}, 
                arquivo.situacao_carregamento_id || SITUACAO_CARREGAMENTO.NAO_CARREGADO,
                arquivo.descricao || '',
                arquivo.crs_original || null,
                versaoTempId
              ]
            );
            
            arquivosInfo.push({
              uuid_arquivo: arquivo.uuid_arquivo || null,
              nome: arquivo.nome,
              nome_arquivo: arquivo.nome_arquivo,
              tipo_arquivo_id: arquivo.tipo_arquivo_id,
              destination_path: destinationPath,
              checksum: arquivo.checksum
            });
          }

          versoesInfo.push({
            versao_info: versao,
            arquivos: arquivosInfo
          });
        }
        
        result.push({
          produto_info: item.produto,
          versoes: versoesInfo
        });
      }
      
      return {
        session_uuid: uuid_session,
        operation_type: 'add_product',
        produtos: result
      };
    } catch (error) {
      if (!(error instanceof AppError)) {
        throw new AppError(`Erro ao preparar upload de produto: ${error.message}`, httpCode.InternalError, error);
      }
      throw error;
    }
  });
};

controller.getProblemUploads = async () => {
  return db.conn.task(async t => {
    const failedSessions = await t.any(
      `SELECT us.id, us.uuid_session, us.operation_type, us.status, 
              us.error_message, us.created_at, us.completed_at, u.nome as usuario_nome
       FROM acervo.upload_session us
       JOIN dgeo.usuario u ON us.usuario_uuid = u.uuid
       WHERE us.status = 'failed'
       ORDER BY us.created_at DESC
       LIMIT 50`
    );
    
    const result = [];
    
    for (const session of failedSessions) {
      // Get failed files based on operation type
      const failedFiles = await t.any(
        `SELECT uf.nome, uf.nome_arquivo, uf.destination_path, uf.status, 
                uf.error_message, uf.versao_id, uf.versao_temp_id
         FROM acervo.upload_arquivo_temp uf
         WHERE uf.session_id = $1 AND uf.status = 'failed'`,
        [session.id]
      );
      
      // Organize results based on operation type
      let sessionDetails = {
        session_uuid: session.uuid_session,
        operation_type: session.operation_type,
        status: session.status,
        error_message: session.error_message,
        created_at: session.created_at,
        completed_at: session.completed_at,
        usuario_nome: session.usuario_nome
      };
      
      switch (session.operation_type) {
        case 'add_files':
          // Group failed files by version
          const filesByVersion = {};
          
          for (const file of failedFiles) {
            if (file.versao_id) {
              if (!filesByVersion[file.versao_id]) {
                filesByVersion[file.versao_id] = [];
              }
              filesByVersion[file.versao_id].push({
                nome: file.nome,
                nome_arquivo: file.nome_arquivo,
                error_message: file.error_message
              });
            }
          }
          
          sessionDetails.versoes_com_problema = Object.entries(filesByVersion).map(([versao_id, files]) => ({
            versao_id: parseInt(versao_id),
            arquivos_com_problema: files
          }));
          break;
          
        case 'add_version':
          // Get all temporary versions for this session
          const versoesTemp = await t.any(
            `SELECT v.*, p.nome as produto_nome
             FROM acervo.upload_versao_temp v
             JOIN acervo.produto p ON v.produto_id = p.id
             WHERE v.session_id = $1`,
            [session.id]
          );
          
          // Group failed files by version
          const filesByTempVersion = {};
          
          for (const file of failedFiles) {
            if (file.versao_temp_id) {
              if (!filesByTempVersion[file.versao_temp_id]) {
                filesByTempVersion[file.versao_temp_id] = [];
              }
              filesByTempVersion[file.versao_temp_id].push({
                nome: file.nome,
                nome_arquivo: file.nome_arquivo,
                error_message: file.error_message
              });
            }
          }
          
          sessionDetails.versoes_com_problema = versoesTemp.map(versao => ({
            produto_id: versao.produto_id,
            produto_nome: versao.produto_nome,
            versao_info: {
              versao: versao.versao,
              nome: versao.nome
            },
            arquivos_com_problema: filesByTempVersion[versao.id] || []
          }));
          break;
          
        case 'add_product':
          // Get all temporary products and versions for this session
          const produtosTemp = await t.any(
            `SELECT * FROM acervo.upload_produto_temp WHERE session_id = $1`,
            [session.id]
          );
          
          sessionDetails.produtos_com_problema = await Promise.all(produtosTemp.map(async produto => {
            const versoesTemp = await t.any(
              `SELECT * FROM acervo.upload_versao_temp 
               WHERE session_id = $1 AND produto_temp_id = $2`,
              [session.id, produto.id]
            );
            
            return {
              produto_info: {
                nome: produto.nome,
                inom: produto.inom,
                mi: produto.mi
              },
              versoes_com_problema: await Promise.all(versoesTemp.map(async versao => {
                const arquivosComProblema = failedFiles
                  .filter(f => f.versao_temp_id === versao.id)
                  .map(f => ({
                    nome: f.nome,
                    nome_arquivo: f.nome_arquivo,
                    error_message: f.error_message
                  }));
                
                return {
                  versao_info: {
                    versao: versao.versao,
                    nome: versao.nome
                  },
                  arquivos_com_problema: arquivosComProblema
                };
              }))
            };
          }));
          break;
      }
      
      result.push(sessionDetails);
    }
    
    return result;
  });
};

controller.confirmUpload = async (sessionUuid, usuarioUuid) => {
  // Falha de processamento precisa ser persistida fora da transação:
  // o rollback desfaria um UPDATE de status feito dentro dela
  let processingFailure = null;

  return db.conn.tx(async t => {
    try {
      // Find the upload session
      const session = await t.oneOrNone(
        `SELECT * FROM acervo.upload_session WHERE uuid_session = $1 AND status = 'pending'`,
        [sessionUuid]
      );
      
      if (!session) {
        throw new AppError('Sessão de upload não encontrada ou já processada', httpCode.NotFound);
      }
      
      // Check if user matches
      if (session.usuario_uuid !== usuarioUuid) {
        throw new AppError('Usuário não autorizado para esta sessão de upload', httpCode.Forbidden);
      }
      
      // Get all files for this session
      const arquivos = await t.any(
        `SELECT * FROM acervo.upload_arquivo_temp WHERE session_id = $1`,
        [session.id]
      );
      
      if (arquivos.length === 0) {
        throw new AppError('Nenhum arquivo encontrado para esta sessão', httpCode.BadRequest);
      }
      
      // Verify each file exists and validate checksums
      const fileResults = {};
      let allValid = true;
      
      for (const arquivo of arquivos) {
        const filePath = arquivo.destination_path;
        const isTileserver = arquivo.tipo_arquivo_id === TIPO_ARQUIVO.TILESERVER;
        let fileValid = true;
        let errorMessage = null;
        
        // Create structure to organize files by version/product
        if (arquivo.versao_id) {
          if (!fileResults[`versao_${arquivo.versao_id}`]) {
            fileResults[`versao_${arquivo.versao_id}`] = {
              versao_id: arquivo.versao_id,
              files: []
            };
          }
        } else if (arquivo.versao_temp_id) {
          if (!fileResults[`versao_temp_${arquivo.versao_temp_id}`]) {
            fileResults[`versao_temp_${arquivo.versao_temp_id}`] = {
              versao_temp_id: arquivo.versao_temp_id,
              files: []
            };
          }
        }
        
        try {
          if (isTileserver) {
            // Tileserver é uma URL — não há arquivo físico para validar
            await t.none(
              `UPDATE acervo.upload_arquivo_temp SET status = 'completed' WHERE id = $1`,
              [arquivo.id]
            );
            fileResults[arquivo.versao_id ? `versao_${arquivo.versao_id}` : `versao_temp_${arquivo.versao_temp_id}`].files.push({
              nome: arquivo.nome,
              nome_arquivo: arquivo.nome_arquivo,
              status: 'completed',
              error_message: null
            });
            continue;
          }

          // Check if file exists
          await fs.access(filePath);

          // Validate checksum via streaming (sem carregar arquivo inteiro em memória)
          const { checksum: calculatedChecksum, fileSizeMB } = await calculateChecksumStream(filePath);

          if (calculatedChecksum !== arquivo.expected_checksum) {
            fileValid = false;
            errorMessage = `Falha na validação do checksum para ${arquivo.nome}`;
            allValid = false;
          }

          // Update real file size
          if (fileValid) {
            await t.none(
              `UPDATE acervo.upload_arquivo_temp SET tamanho_mb = $1, status = 'completed' WHERE id = $2`,
              [fileSizeMB, arquivo.id]
            );
          } else {
            await t.none(
              `UPDATE acervo.upload_arquivo_temp SET status = 'failed', error_message = $1 WHERE id = $2`,
              [errorMessage, arquivo.id]
            );
          }
        } catch (error) {
          fileValid = false;
          errorMessage = `Arquivo não encontrado: ${filePath}`;
          allValid = false;

          await t.none(
            `UPDATE acervo.upload_arquivo_temp SET status = 'failed', error_message = $1 WHERE id = $2`,
            [errorMessage, arquivo.id]
          );
        }
        
        // Add file result to appropriate group
        const fileResult = {
          nome: arquivo.nome,
          nome_arquivo: arquivo.nome_arquivo,
          status: fileValid ? 'completed' : 'failed',
          error_message: errorMessage
        };
        
        if (arquivo.versao_id) {
          fileResults[`versao_${arquivo.versao_id}`].files.push(fileResult);
        } else if (arquivo.versao_temp_id) {
          fileResults[`versao_temp_${arquivo.versao_temp_id}`].files.push(fileResult);
        }
      }
      
      // If all files are valid, process based on operation type
      if (allValid) {
        try {
          switch (session.operation_type) {
            case 'add_files':
              await processAddFiles(t, session);
              break;
            case 'replace_files':
              await processReplaceFiles(t, session);
              break;
            case 'add_version':
              await processAddVersion(t, session);
              break;
            case 'add_product':
              await processAddProduct(t, session);
              break;
          }
          
          await t.none(
            `UPDATE acervo.upload_session 
             SET status = 'completed', completed_at = NOW() 
             WHERE id = $1`,
            [session.id]
          );
          
          // Organize files by operation type
          let result;
          switch (session.operation_type) {
            case 'replace_files':
            case 'add_files':
              result = {
                session_uuid: sessionUuid,
                operation_type: session.operation_type,
                status: 'completed',
                versoes: Object.values(fileResults).map(v => ({
                  versao_id: v.versao_id,
                  files: v.files
                }))
              };
              break;
              
            case 'add_version':
              const versoesTemp = await t.any(
                `SELECT v.*, p.id as produto_id 
                 FROM acervo.upload_versao_temp v
                 LEFT JOIN acervo.produto p ON v.produto_id = p.id
                 WHERE v.session_id = $1`,
                [session.id]
              );
              
              result = {
                session_uuid: sessionUuid,
                operation_type: session.operation_type,
                status: 'completed',
                versoes: versoesTemp.map(v => {
                  const versaoResults = fileResults[`versao_temp_${v.id}`] || { files: [] };
                  return {
                    produto_id: v.produto_id,
                    versao_id: v.id,
                    files: versaoResults.files
                  };
                })
              };
              break;
              
            case 'add_product':
              const produtosTemp = await t.any(
                `SELECT * FROM acervo.upload_produto_temp WHERE session_id = $1`,
                [session.id]
              );
              
              result = {
                session_uuid: sessionUuid,
                operation_type: session.operation_type,
                status: 'completed',
                produtos: await Promise.all(produtosTemp.map(async p => {
                  const versoesTemp = await t.any(
                    `SELECT * FROM acervo.upload_versao_temp WHERE session_id = $1 AND produto_temp_id = $2`,
                    [session.id, p.id]
                  );
                  
                  return {
                    produto_temp_id: p.id,
                    versoes: versoesTemp.map(v => {
                      const versaoResults = fileResults[`versao_temp_${v.id}`] || { files: [] };
                      return {
                        versao_temp_id: v.id,
                        files: versaoResults.files
                      };
                    })
                  };
                }))
              };
              break;
          }
          
          return result;
        } catch (error) {
          processingFailure = { sessionId: session.id, message: error.message };

          throw error;
        }
      } else {
        await t.none(
          `UPDATE acervo.upload_session 
           SET status = 'failed', error_message = 'Um ou mais arquivos falharam na validação', completed_at = NOW() 
           WHERE id = $1`,
          [session.id]
        );
        
        // Return failure result with file details
        return {
          session_uuid: sessionUuid,
          operation_type: session.operation_type,
          status: 'failed',
          error_message: 'Um ou mais arquivos falharam na validação',
          detalhes: Object.values(fileResults)
        };
      }
    } catch (error) {
      if (!(error instanceof AppError)) {
        throw new AppError(`Erro ao confirmar upload: ${error.message}`, httpCode.InternalError, error);
      }
      throw error;
    }
  }).catch(async error => {
    if (processingFailure) {
      await db.conn.none(
        `UPDATE acervo.upload_session
         SET status = 'failed', error_message = $1, completed_at = NOW()
         WHERE id = $2`,
        [processingFailure.message, processingFailure.sessionId]
      ).catch(() => {});
    }

    throw error;
  });
};

// Helper function for Scenario 1: Process add_files to main tables
async function processAddFiles(t, session) {
  try {
    // Get files from the temporary table with existing version ID
    const arquivos = await t.any(
      `SELECT * FROM acervo.upload_arquivo_temp 
       WHERE session_id = $1 AND versao_id IS NOT NULL`,
      [session.id]
    );
    
    // Get the versao_ids
    const versaoIds = [...new Set(arquivos.map(a => a.versao_id))];
    
    // Insert each file into the main arquivo table
    for (const arquivo of arquivos) {
      await t.none(
        `INSERT INTO acervo.arquivo(
          uuid_arquivo, nome, nome_arquivo, versao_id, tipo_arquivo_id,
          volume_armazenamento_id, extensao, tamanho_mb, checksum, metadado,
          tipo_status_id, situacao_carregamento_id, descricao, crs_original,
          usuario_cadastramento_uuid, data_cadastramento
        ) VALUES (uuid_generate_v4(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, CURRENT_TIMESTAMP)`,
        [
          arquivo.nome, 
          arquivo.nome_arquivo, 
          arquivo.versao_id, 
          arquivo.tipo_arquivo_id,
          arquivo.volume_armazenamento_id, 
          arquivo.extensao, 
          arquivo.tamanho_mb,
          arquivo.expected_checksum, 
          arquivo.metadado, 
          STATUS_ARQUIVO.CARREGADO, // tipo_status_id
          arquivo.situacao_carregamento_id,
          arquivo.descricao,
          arquivo.crs_original,
          session.usuario_uuid
        ]
      );
    }
  } catch (error) {
    throw new AppError(`Erro ao processar arquivos: ${error.message}`, httpCode.InternalError, error);
  }
}

// Processa replace_files: para cada arquivo do envio, dentro da MESMA transacao do
// confirm, faz soft-delete do arquivo que ocupa o slot (versao_id, nome_arquivo,
// extensao) -- se houver -- e insere o novo. Atomico: sem meio-termo entre apagar
// e recadastrar. Se o slot estiver vazio (upsert), apenas insere.
async function processReplaceFiles(t, session) {
  try {
    const arquivos = await t.any(
      `SELECT * FROM acervo.upload_arquivo_temp
       WHERE session_id = $1 AND versao_id IS NOT NULL`,
      [session.id]
    );

    const motivo = 'Substituído por nova versão do mesmo arquivo (replace-files)';

    for (const arquivo of arquivos) {
      // Arquivo que ocupa o slot atualmente (se houver)
      const atual = await t.oneOrNone(
        `SELECT * FROM acervo.arquivo
         WHERE versao_id = $1 AND nome_arquivo = $2 AND extensao = $3`,
        [arquivo.versao_id, arquivo.nome_arquivo, arquivo.extensao]
      );

      if (atual) {
        // Move o antigo para arquivo_deletado (auditoria), espelhando deleteArquivos
        const { id: arquivoDeletadoId } = await t.one(
          `INSERT INTO acervo.arquivo_deletado (
            uuid_arquivo, nome, nome_arquivo, motivo_exclusao, versao_id, tipo_arquivo_id,
            volume_armazenamento_id, extensao, tamanho_mb, checksum, metadado,
            tipo_status_id, situacao_carregamento_id, descricao, crs_original,
            data_cadastramento, usuario_cadastramento_uuid, data_modificacao,
            usuario_modificacao_uuid, data_delete, usuario_delete_uuid
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
          RETURNING id`,
          [
            atual.uuid_arquivo, atual.nome, atual.nome_arquivo, motivo, atual.versao_id, atual.tipo_arquivo_id,
            atual.volume_armazenamento_id, atual.extensao, atual.tamanho_mb, atual.checksum, atual.metadado,
            STATUS_ARQUIVO.EXCLUIDO, atual.situacao_carregamento_id, atual.descricao, atual.crs_original,
            atual.data_cadastramento, atual.usuario_cadastramento_uuid, atual.data_modificacao,
            atual.usuario_modificacao_uuid, new Date(), session.usuario_uuid
          ]
        );
        await t.none(
          `INSERT INTO acervo.download_deletado (arquivo_deletado_id, usuario_uuid, data_download)
           SELECT $1, d.usuario_uuid, d.data_download
           FROM acervo.download d WHERE d.arquivo_id = $2`,
          [arquivoDeletadoId, atual.id]
        );
        await t.none('DELETE FROM acervo.download WHERE arquivo_id = $1', [atual.id]);
        await t.none('DELETE FROM acervo.arquivo WHERE id = $1', [atual.id]);
      }

      // Insere o novo arquivo no mesmo slot
      await t.none(
        `INSERT INTO acervo.arquivo(
          uuid_arquivo, nome, nome_arquivo, versao_id, tipo_arquivo_id,
          volume_armazenamento_id, extensao, tamanho_mb, checksum, metadado,
          tipo_status_id, situacao_carregamento_id, descricao, crs_original,
          usuario_cadastramento_uuid, data_cadastramento
        ) VALUES (uuid_generate_v4(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, CURRENT_TIMESTAMP)`,
        [
          arquivo.nome,
          arquivo.nome_arquivo,
          arquivo.versao_id,
          arquivo.tipo_arquivo_id,
          arquivo.volume_armazenamento_id,
          arquivo.extensao,
          arquivo.tamanho_mb,
          arquivo.expected_checksum,
          arquivo.metadado,
          STATUS_ARQUIVO.CARREGADO,
          arquivo.situacao_carregamento_id,
          arquivo.descricao,
          arquivo.crs_original,
          session.usuario_uuid
        ]
      );
    }
  } catch (error) {
    throw new AppError(`Erro ao substituir arquivos: ${error.message}`, httpCode.InternalError, error);
  }
}

// Helper function for Scenario 2: Process add_version to main tables
async function processAddVersion(t, session) {
  try {
    // Get versions from temporary table
    const versoesTemp = await t.any(
      `SELECT * FROM acervo.upload_versao_temp 
       WHERE session_id = $1 AND produto_id IS NOT NULL`,
      [session.id]
    );
    
    const produtoIds = [];
    const versaoIds = [];
    
    // Process each version
    for (const versaoTemp of versoesTemp) {
      produtoIds.push(versaoTemp.produto_id);
      
      // Insert version into the main versao table
      const { id: versaoId } = await t.one(
        `INSERT INTO acervo.versao(
          uuid_versao, versao, nome, tipo_versao_id, subtipo_produto_id, produto_id, 
          lote_id, metadado, descricao, orgao_produtor, palavras_chave, data_criacao, data_edicao, 
          usuario_cadastramento_uuid, data_cadastramento
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, CURRENT_TIMESTAMP)
        RETURNING id`,
        [
          versaoTemp.uuid_versao,
          versaoTemp.versao,
          versaoTemp.nome,
          versaoTemp.tipo_versao_id,
          versaoTemp.subtipo_produto_id,
          versaoTemp.produto_id,
          versaoTemp.lote_id,
          versaoTemp.metadado,
          versaoTemp.descricao,
          versaoTemp.orgao_produtor,
          versaoTemp.palavras_chave || [],
          versaoTemp.data_criacao,
          versaoTemp.data_edicao,
          session.usuario_uuid
        ]
      );
      
      versaoIds.push(versaoId);
      
      // Get files for this version from temporary table
      const arquivos = await t.any(
        `SELECT * FROM acervo.upload_arquivo_temp 
         WHERE session_id = $1 AND versao_temp_id = $2`,
        [session.id, versaoTemp.id]
      );
      
      // Insert each file into the main arquivo table
      for (const arquivo of arquivos) {
        await t.none(
          `INSERT INTO acervo.arquivo(
            uuid_arquivo, nome, nome_arquivo, versao_id, tipo_arquivo_id,
            volume_armazenamento_id, extensao, tamanho_mb, checksum, metadado,
            tipo_status_id, situacao_carregamento_id, descricao, crs_original,
            usuario_cadastramento_uuid, data_cadastramento
          ) VALUES (uuid_generate_v4(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, CURRENT_TIMESTAMP)`,
          [
            arquivo.nome, 
            arquivo.nome_arquivo, 
            versaoId,  // Use the newly created versao ID
            arquivo.tipo_arquivo_id,
            arquivo.volume_armazenamento_id, 
            arquivo.extensao, 
            arquivo.tamanho_mb,
            arquivo.expected_checksum, 
            arquivo.metadado, 
            STATUS_ARQUIVO.CARREGADO, // tipo_status_id
            arquivo.situacao_carregamento_id,
            arquivo.descricao,
            arquivo.crs_original,
            session.usuario_uuid
          ]
        );
      }
    }
  } catch (error) {
    throw new AppError(`Erro ao processar versões: ${error.message}`, httpCode.InternalError, error);
  }
}

// Helper function for Scenario 3: Process add_product to main tables
async function processAddProduct(t, session) {
  try {
    // Get products from temporary table
    const produtosTemp = await t.any(
      `SELECT * FROM acervo.upload_produto_temp 
       WHERE session_id = $1`,
      [session.id]
    );
    
    const produtoIds = [];
    
    // Process each product
    for (const produtoTemp of produtosTemp) {
      // Insert product into the main produto table
      const { id: produtoId } = await t.one(
        `INSERT INTO acervo.produto(
          nome, mi, inom, tipo_escala_id, denominador_escala_especial, tipo_produto_id,
          subtipo_produto_id, descricao, data_cadastramento, usuario_cadastramento_uuid, geom
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP, $9, ST_GeomFromEWKT($10))
        RETURNING id`,
        [
          produtoTemp.nome,
          produtoTemp.mi,
          produtoTemp.inom,
          produtoTemp.tipo_escala_id,
          produtoTemp.denominador_escala_especial,
          produtoTemp.tipo_produto_id,
          produtoTemp.subtipo_produto_id ?? null,
          produtoTemp.descricao,
          session.usuario_uuid,
          produtoTemp.geom
        ]
      );
      
      produtoIds.push(produtoId);
      
      // Get versions for this product from temporary table
      const versoesTemp = await t.any(
        `SELECT * FROM acervo.upload_versao_temp 
         WHERE session_id = $1 AND produto_temp_id = $2`,
        [session.id, produtoTemp.id]
      );
      
      // Process each version
      for (const versaoTemp of versoesTemp) {
        // Insert version into the main versao table
        const { id: versaoId } = await t.one(
          `INSERT INTO acervo.versao(
            uuid_versao, versao, nome, tipo_versao_id, subtipo_produto_id, produto_id, 
            lote_id, metadado, descricao, orgao_produtor, palavras_chave, data_criacao, data_edicao, 
            usuario_cadastramento_uuid, data_cadastramento
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, CURRENT_TIMESTAMP)
          RETURNING id`,
          [
            versaoTemp.uuid_versao,
            versaoTemp.versao,
            versaoTemp.nome,
            versaoTemp.tipo_versao_id,
            versaoTemp.subtipo_produto_id,
            produtoId,  // Use the newly created produto ID
            versaoTemp.lote_id,
            versaoTemp.metadado,
            versaoTemp.descricao,
            versaoTemp.orgao_produtor,
            versaoTemp.palavras_chave || [],
            versaoTemp.data_criacao,
            versaoTemp.data_edicao,
            session.usuario_uuid
          ]
        );
        
        // Get files for this version from temporary table
        const arquivos = await t.any(
          `SELECT * FROM acervo.upload_arquivo_temp 
           WHERE session_id = $1 AND versao_temp_id = $2`,
          [session.id, versaoTemp.id]
        );
        
        // Insert each file into the main arquivo table
        for (const arquivo of arquivos) {
          await t.none(
            `INSERT INTO acervo.arquivo(
              uuid_arquivo, nome, nome_arquivo, versao_id, tipo_arquivo_id,
              volume_armazenamento_id, extensao, tamanho_mb, checksum, metadado,
              tipo_status_id, situacao_carregamento_id, descricao, crs_original,
              usuario_cadastramento_uuid, data_cadastramento
            ) VALUES (uuid_generate_v4(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, CURRENT_TIMESTAMP)`,
            [
              arquivo.nome, 
              arquivo.nome_arquivo, 
              versaoId,  // Use the newly created versao ID
              arquivo.tipo_arquivo_id,
              arquivo.volume_armazenamento_id, 
              arquivo.extensao, 
              arquivo.tamanho_mb,
              arquivo.expected_checksum, 
              arquivo.metadado, 
              STATUS_ARQUIVO.CARREGADO, // tipo_status_id
              arquivo.situacao_carregamento_id,
              arquivo.descricao,
              arquivo.crs_original,
              session.usuario_uuid
            ]
          );
        }
      }
    }
  } catch (error) {
    throw new AppError(`Erro ao processar produtos: ${error.message}`, httpCode.InternalError, error);
  }
}

controller.getUploadSessions = async () => {
  return db.conn.any(
    `SELECT us.id, us.uuid_session, us.operation_type, us.status,
            us.error_message, us.created_at, us.expiration_time, us.completed_at,
            u.nome AS usuario_nome
     FROM acervo.upload_session us
     JOIN dgeo.usuario u ON us.usuario_uuid = u.uuid
     ORDER BY us.created_at DESC
     LIMIT 100`
  );
};

controller.cancelUpload = async (sessionUuid, usuarioUuid) => {
  return db.conn.tx(async t => {
    const session = await t.oneOrNone(
      `SELECT * FROM acervo.upload_session WHERE uuid_session = $1 AND status = 'pending'`,
      [sessionUuid]
    );

    if (!session) {
      throw new AppError('Sessão de upload não encontrada ou já processada', httpCode.NotFound);
    }

    // Verificar se o usuário é o dono da sessão ou admin
    if (session.usuario_uuid !== usuarioUuid) {
      // Verificar se é admin
      const usuario = await t.oneOrNone(
        'SELECT administrador FROM dgeo.usuario WHERE uuid = $1',
        [usuarioUuid]
      );
      if (!usuario || !usuario.administrador) {
        throw new AppError('Apenas o criador da sessão ou um administrador pode cancelá-la', httpCode.Forbidden);
      }
    }

    await t.none(
      `UPDATE acervo.upload_session
       SET status = 'cancelled', error_message = 'Cancelado pelo usuário', completed_at = NOW()
       WHERE id = $1`,
      [session.id]
    );

    await t.none(
      `UPDATE acervo.upload_arquivo_temp
       SET status = 'cancelled', error_message = 'Sessão cancelada pelo usuário'
       WHERE session_id = $1 AND status = 'pending'`,
      [session.id]
    );
  });
};

/**
 * Renomeia o arquivo físico para o padrão derivado dos metadados.
 *
 * O nome NÃO vem do cliente: sai de `acervo.nome_arquivo_padrao`, a mesma função
 * que o invariante 7a usa para auditar. Auditor e escritor são a mesma regra.
 *
 * Ordem por arquivo, e ela importa. O UPDATE vai ANTES do disco, dentro da
 * transação: os índices únicos `unique_nome_fisico_por_volume{,_ci}` recusam a
 * colisão ali, com o disco ainda intacto. Só depois de o banco aceitar é que o
 * byte se move. Falhando o rename, o ROLLBACK desfaz tudo e nada mudou.
 *
 * `fs.rename` do Node sobrescreve em silêncio no Windows (libuv usa MoveFileEx com
 * MOVEFILE_REPLACE_EXISTING). Por isso o destino é conferido antes: sobrescrever é
 * o único modo de falha irreversível desta operação, e nenhuma auditoria posterior
 * o detecta.
 *
 * Idempotente. Reexecutar é seguro: cada arquivo é reclassificado pelo estado real
 * (o que está no banco e o que está no disco), nunca por um log da execução
 * anterior. Interrupção no meio não deixa estado que a próxima chamada não resolva.
 */
controller.renomearPadrao = async (arquivoIds, limite, dryRun, motivo, usuarioUuid) => {
  // Sessão de upload aberta congela um destination_path e a transferência
  // sobrescreve o físico no lugar. Renomear por baixo dela perde bytes.
  const abertas = await db.conn.one(
    `SELECT count(*)::int AS n FROM acervo.upload_session
     WHERE status NOT IN ('completed', 'failed', 'cancelled')`
  );
  if (abertas.n > 0 && !dryRun) {
    throw new AppError(
      `Há ${abertas.n} sessão(ões) de upload aberta(s). Renomear agora sobrescreveria os bytes que elas vão gravar. Espere fechar ou cancele.`,
      httpCode.Conflict
    );
  }

  const filtro = arquivoIds && arquivoIds.length ? 'AND a.id IN ($<ids:csv>)' : '';
  const divergentes = await db.conn.any(`
    SELECT a.id, a.nome_arquivo, a.extensao, vol.volume,
           acervo.nome_arquivo_padrao(p.tipo_produto_id, v.subtipo_produto_id, p.mi,
             p.inom, p.nome, p.tipo_escala_id, p.denominador_escala_especial,
             v.versao) AS esperado
    FROM acervo.arquivo a
    JOIN acervo.versao v ON v.id = a.versao_id
    JOIN acervo.produto p ON p.id = v.produto_id
    JOIN acervo.volume_armazenamento vol ON vol.id = a.volume_armazenamento_id
    WHERE a.tipo_arquivo_id <> ${TIPO_ARQUIVO.TILESERVER}
      AND a.nome_arquivo IS DISTINCT FROM acervo.nome_arquivo_padrao(
        p.tipo_produto_id, v.subtipo_produto_id, p.mi, p.inom, p.nome,
        p.tipo_escala_id, p.denominador_escala_especial, v.versao)
      ${filtro}
    ORDER BY a.id`, { ids: arquivoIds });

  // Nome não computável é defeito de metadado, não de arquivo. Renomear para NULL
  // destruiria a única pista de onde o byte está. Aborta e nomeia os culpados: o
  // invariante 7b lista todos.
  const semNome = divergentes.filter(d => d.esperado === null);
  if (semNome.length > 0) {
    throw new AppError(
      `${semNome.length} arquivo(s) sem nome padrão computável (rótulo de versão ou nome de produto fora do padrão). Conserte os metadados primeiro; veja o invariante 7b. Ids: ${semNome.slice(0, 20).map(d => d.id).join(', ')}`,
      httpCode.BadRequest
    );
  }

  const lote = divergentes.slice(0, limite);
  const resultado = {
    dry_run: dryRun,
    divergentes_total: divergentes.length,
    nesta_chamada: lote.length,
    restantes: Math.max(0, divergentes.length - lote.length),
    renomeados: 0,
    so_banco: 0,
    falhas: 0,
    detalhe: []
  };

  if (dryRun) {
    resultado.amostra = lote.slice(0, 20).map(d => ({
      id: d.id,
      de: `${d.nome_arquivo}.${d.extensao}`,
      para: `${d.esperado}.${d.extensao}`
    }));
    return resultado;
  }

  for (const d of lote) {
    const atual = caminhoNoVolume(d.volume, `${d.nome_arquivo}.${d.extensao}`);
    const alvo = caminhoNoVolume(d.volume, `${d.esperado}.${d.extensao}`);
    let renomeou = false;
    try {
      const temAtual = await fs.access(atual).then(() => true).catch(() => false);
      const temAlvo = await fs.access(alvo).then(() => true).catch(() => false);

      if (!temAtual && !temAlvo) {
        throw new Error('nem o nome atual nem o alvo existem no volume');
      }
      if (temAtual && temAlvo) {
        // Os dois existem: renomear apagaria um. Nunca decide sozinho.
        throw new Error('o nome alvo JÁ EXISTE no volume e é outro arquivo');
      }

      await db.conn.tx(async t => {
        // O banco decide primeiro. Colisão estoura aqui, com o disco intacto.
        const upd = await t.result(
          `UPDATE acervo.arquivo
           SET nome_arquivo = $<esperado>, data_modificacao = NOW(),
               usuario_modificacao_uuid = $<usuarioUuid>
           WHERE id = $<id> AND nome_arquivo = $<atual>`,
          { esperado: d.esperado, usuarioUuid, id: d.id, atual: d.nome_arquivo }
        );
        if (upd.rowCount !== 1) {
          throw new Error(`UPDATE afetou ${upd.rowCount} linha(s); outro processo mexeu neste arquivo`);
        }
        if (temAtual) {
          await fs.rename(atual, alvo);
          renomeou = true;
        }
      });

      resultado.renomeados++;
      if (!renomeou) resultado.so_banco++;
    } catch (erro) {
      // A transação já reverteu o banco. Falta desfazer o disco, se moveu.
      if (renomeou) {
        try {
          await fs.rename(alvo, atual);
        } catch (e2) {
          logger.error('Renome revertido no banco mas NAO no disco', {
            arquivo_id: d.id, de: atual, para: alvo, erro: e2.message
          });
        }
      }
      resultado.falhas++;
      resultado.detalhe.push({
        id: d.id,
        de: `${d.nome_arquivo}.${d.extensao}`,
        para: `${d.esperado}.${d.extensao}`,
        erro: erro.message
      });
      // Falha em série é sinal de causa comum (volume caiu, permissão): parar cedo
      // vale mais que insistir 5.000 vezes no mesmo erro.
      if (resultado.falhas >= 20) {
        resultado.interrompido = 'teto de 20 falhas atingido';
        break;
      }
    }
  }

  logger.info('Renome para o nome padrão', {
    usuarioUuid, motivo,
    divergentes: divergentes.length,
    renomeados: resultado.renomeados,
    falhas: resultado.falhas
  });

  return resultado;
};

module.exports = controller;