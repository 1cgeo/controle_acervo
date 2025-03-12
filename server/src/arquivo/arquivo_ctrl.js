// Path: arquivo\arquivo_ctrl.js
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

controller.atualizaArquivo = async (arquivo, usuarioUuid) => {
  return db.conn.tx(async t => {
    arquivo.data_modificacao = new Date();
    arquivo.usuario_modificacao_uuid = usuarioUuid;

    const colunasArquivo = [
      'nome', 'tipo_arquivo_id', 'volume_armazenamento_id',
      'metadado', 'tipo_status_id', 'situacao_carregamento_id', 'orgao_produtor', 'descricao', 
      'data_modificacao', 'usuario_modificacao_uuid'
    ];

    const cs = new db.pgp.helpers.ColumnSet(colunasArquivo, { table: 'arquivo', schema: 'acervo' });
    const query = db.pgp.helpers.update(arquivo, cs) + ' WHERE id = $1';

    await t.none(query, [arquivo.id]);

    await refreshViews.atualizarViewsPorArquivos(t, [arquivo.id])
  });
};

controller.deleteArquivos = async (arquivoIds, motivo_exclusao, usuarioUuid) => {
  const data_delete = new Date();
  const usuario_delete_uuid = usuarioUuid;

  return db.conn.tx(async t => {
    // Verificar se todos os IDs de arquivo existem
    const existingFiles = await t.any(
      `SELECT id FROM acervo.arquivo WHERE id IN ($1:csv)`,
      [arquivoIds]
    );

    if (existingFiles.length !== arquivoIds.length) {
      const existingIds = existingFiles.map(f => f.id);
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
          tipo_status_id, situacao_carregamento_id, orgao_produtor, descricao, 
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
          4, //Em exclusão
          arquivo.situacao_carregamento_id, 
          arquivo.orgao_produtor, 
          arquivo.descricao, 
          arquivo.data_cadastramento, 
          arquivo.usuario_cadastramento_uuid, 
          arquivo.data_modificacao, 
          arquivo.usuario_modificacao_uuid, 
          data_delete, 
          usuario_delete_uuid
        ]
      );

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

      // Finally, delete the file itself from the arquivo table
      await t.none('DELETE FROM acervo.arquivo WHERE id = $1', [arquivo.id]);
    }

    await refreshViews.atualizarViewsPorArquivos(t, arquivoIds);
  });
};

controller.prepareAddFiles = async (requestData, usuarioUuid) => {
  return db.conn.tx(async t => {
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
      const foundIds = versoes.map(v => v.id);
      const missingIds = versao_ids.filter(id => !foundIds.includes(id));
      throw new AppError(`Versões não encontradas com IDs: ${missingIds.join(', ')}`, httpCode.NotFound);
    }
    
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
      const arquivoExistente = await t.oneOrNone(
        `SELECT id FROM acervo.arquivo 
         WHERE nome_arquivo = $1 AND versao_id = $2`,
        [arquivo.nome_arquivo, arquivo.versao_id]
      );
      
      if (arquivoExistente) {
        throw new AppError(`Arquivo ${arquivo.nome_arquivo} já existe para a versão ${arquivo.versao_id}`, httpCode.Conflict);
      }
    }
    
    // Calculate required space per volume
    const spaceNeededByVolume = {};
    for (const arquivo of arquivos) {
      const versao = versoes.find(v => v.id === arquivo.versao_id);
      const volume = volumeByProductType[versao.tipo_produto_id];
      
      if (!spaceNeededByVolume[volume.volume_armazenamento_id]) {
        spaceNeededByVolume[volume.volume_armazenamento_id] = 0;
      }
      spaceNeededByVolume[volume.volume_armazenamento_id] += arquivo.tamanho_mb;
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
    
    for (const arquivo of arquivos) {
      const versao = versoes.find(v => v.id === arquivo.versao_id);
      const volume = volumeByProductType[versao.tipo_produto_id];
      const destinationPath = path.join(volume.volume, `${arquivo.nome_arquivo}.${arquivo.extensao}`);
      
      // Register file in the temporary table
      await t.none(
        `INSERT INTO acervo.upload_arquivo_temp(
          session_id, nome, nome_arquivo, destination_path, 
          tipo_arquivo_id, volume_armazenamento_id, extensao, tamanho_mb, 
          expected_checksum, metadado, situacao_carregamento_id, 
          orgao_produtor, descricao, versao_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [
          sessionId, 
          arquivo.nome, 
          arquivo.nome_arquivo, 
          destinationPath, 
          arquivo.tipo_arquivo_id,
          volume.volume_armazenamento_id,
          arquivo.extensao, 
          arquivo.tamanho_mb,
          arquivo.checksum, 
          arquivo.metadado || {}, 
          arquivo.situacao_carregamento_id || 1,
          arquivo.orgao_produtor || 'N/A', 
          arquivo.descricao || '',
          arquivo.versao_id
        ]
      );
      
      arquivosInfo.push({
        nome: arquivo.nome,
        nome_arquivo: arquivo.nome_arquivo,
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
  });
};

controller.prepareAddVersion = async (requestData, usuarioUuid) => {
  return db.conn.tx(async t => {
    const { versoes } = requestData;
    
    // Verify all product_ids exist
    const produto_ids = [...new Set(versoes.map(v => v.produto_id))];
    
    const produtos = await t.any(
      'SELECT id, tipo_produto_id FROM acervo.produto WHERE id IN ($1:csv)',
      [produto_ids]
    );
    
    if (produtos.length !== produto_ids.length) {
      const foundIds = produtos.map(p => p.id);
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
        'SELECT id FROM acervo.versao WHERE produto_id = $1 AND versao = $2',
        [item.produto_id, item.versao.versao]
      );
      
      if (versaoExistente) {
        throw new AppError(`Já existe uma versão com o nome "${item.versao.versao}" para o produto ${item.produto_id}`, httpCode.Conflict);
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
        spaceNeededByVolume[volume.volume_armazenamento_id] += arquivo.tamanho_mb;
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
    
    for (const item of versoes) {
      const produto = produtoMap[item.produto_id];
      const volume = volumeByProductType[produto.tipo_produto_id];
      
      // Create temporary version
      const { id: versaoTempId } = await t.one(
        `INSERT INTO acervo.upload_versao_temp(
          session_id, uuid_versao, versao, nome, tipo_versao_id, 
          subtipo_produto_id, lote_id, metadado, descricao, 
          data_criacao, data_edicao, produto_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
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
          item.produto_id
        ]
      );
      
      // Process files for this version
      const arquivosInfo = [];
      
      for (const arquivo of item.arquivos) {
        const destinationPath = path.join(volume.volume, `${arquivo.nome_arquivo}.${arquivo.extensao}`);
        
        // Register file in the temporary table
        await t.none(
          `INSERT INTO acervo.upload_arquivo_temp(
            session_id, nome, nome_arquivo, destination_path, 
            tipo_arquivo_id, volume_armazenamento_id, extensao, tamanho_mb, 
            expected_checksum, metadado, situacao_carregamento_id, 
            orgao_produtor, descricao, versao_temp_id
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
          [
            sessionId, 
            arquivo.nome, 
            arquivo.nome_arquivo, 
            destinationPath, 
            arquivo.tipo_arquivo_id,
            volume.volume_armazenamento_id,
            arquivo.extensao, 
            arquivo.tamanho_mb,
            arquivo.checksum, 
            arquivo.metadado || {}, 
            arquivo.situacao_carregamento_id || 1,
            arquivo.orgao_produtor || 'N/A', 
            arquivo.descricao || '',
            versaoTempId
          ]
        );
        
        arquivosInfo.push({
          nome: arquivo.nome,
          nome_arquivo: arquivo.nome_arquivo,
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
  });
};

controller.prepareAddProduct = async (requestData, usuarioUuid) => {
  return db.conn.tx(async t => {
    const { produtos } = requestData;
    
    // Check for duplicate INOMs
    const inoms = produtos.map(p => p.produto.inom).filter(inom => inom !== null && inom !== '');
    const uniqueInoms = [...new Set(inoms)];
    
    if (inoms.length !== uniqueInoms.length) {
      throw new AppError('Existem produtos com INOMs duplicados na solicitação', httpCode.BadRequest);
    }
    
    // Check if any INOM already exists in the database
    for (const item of produtos) {
      if (item.produto.inom) {
        const existingProduct = await t.oneOrNone(
          'SELECT id FROM acervo.produto WHERE inom = $1',
          [item.produto.inom]
        );
        
        if (existingProduct) {
          throw new AppError(`Já existe um produto com o INOM ${item.produto.inom}`, httpCode.Conflict);
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
          spaceNeededByVolume[volume.volume_armazenamento_id] += arquivo.tamanho_mb;
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
    
    for (const item of produtos) {
      const volume = volumeByProductType[item.produto.tipo_produto_id];
      
      // Create temporary product
      const { id: produtoTempId } = await t.one(
        `INSERT INTO acervo.upload_produto_temp(
          session_id, nome, mi, inom, tipo_escala_id, 
          denominador_escala_especial, tipo_produto_id, descricao, geom
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING id`,
        [
          sessionId,
          item.produto.nome,
          item.produto.mi,
          item.produto.inom,
          item.produto.tipo_escala_id,
          item.produto.denominador_escala_especial,
          item.produto.tipo_produto_id,
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
            data_criacao, data_edicao, produto_temp_id
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
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
            produtoTempId
          ]
        );
        
        // Process files for this version
        const arquivosInfo = [];
        
        for (const arquivo of versao.arquivos) {
          const destinationPath = path.join(volume.volume, `${arquivo.nome_arquivo}.${arquivo.extensao}`);
          
          // Register file in the temporary table
          await t.none(
            `INSERT INTO acervo.upload_arquivo_temp(
              session_id, nome, nome_arquivo, destination_path, 
              tipo_arquivo_id, volume_armazenamento_id, extensao, tamanho_mb, 
              expected_checksum, metadado, situacao_carregamento_id, 
              orgao_produtor, descricao, versao_temp_id
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
            [
              sessionId, 
              arquivo.nome, 
              arquivo.nome_arquivo, 
              destinationPath, 
              arquivo.tipo_arquivo_id,
              volume.volume_armazenamento_id,
              arquivo.extensao, 
              arquivo.tamanho_mb,
              arquivo.checksum, 
              arquivo.metadado || {}, 
              arquivo.situacao_carregamento_id || 1,
              arquivo.orgao_produtor || 'N/A', 
              arquivo.descricao || '',
              versaoTempId
            ]
          );
          
          arquivosInfo.push({
            nome: arquivo.nome,
            nome_arquivo: arquivo.nome_arquivo,
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
  return db.conn.tx(async t => {
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
        // Check if file exists
        await fs.access(filePath);
        
        // Validate checksum
        const fileBuffer = await fs.readFile(filePath);
        const calculatedChecksum = crypto.createHash('sha256').update(fileBuffer).digest('hex');
        
        if (calculatedChecksum !== arquivo.expected_checksum) {
          fileValid = false;
          errorMessage = `Falha na validação do checksum para ${arquivo.nome}`;
          allValid = false;
        }
        
        // Update real file size
        if (fileValid) {
          const fileSizeMB = fileBuffer.length / (1024 * 1024);
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
        await t.none(
          `UPDATE acervo.upload_session 
           SET status = 'failed', error_message = $1, completed_at = NOW() 
           WHERE id = $2`,
          [error.message, session.id]
        );
        
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
  });
};

// Helper function for Scenario 1: Process add_files to main tables
async function processAddFiles(t, session) {
  // Get files from the temporary table with existing version ID
  const arquivos = await t.any(
    `SELECT * FROM acervo.upload_arquivo_temp 
     WHERE session_id = $1 AND versao_id IS NOT NULL`,
    [session.id]
  );
  
  // Insert each file into the main arquivo table
  for (const arquivo of arquivos) {
    await t.none(
      `INSERT INTO acervo.arquivo(
        uuid_arquivo, nome, nome_arquivo, versao_id, tipo_arquivo_id,
        volume_armazenamento_id, extensao, tamanho_mb, checksum, metadado,
        tipo_status_id, situacao_carregamento_id, orgao_produtor, descricao,
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
        1, // tipo_status_id - Carregado
        arquivo.situacao_carregamento_id,
        arquivo.orgao_produtor, 
        arquivo.descricao,
        session.usuario_uuid
      ]
    );
  }
  
  // Get all affected versions for view refresh
  const versaoIds = [...new Set(arquivos.map(a => a.versao_id))];
  
  // Refresh views
  if (versaoIds.length > 0) {
    await refreshViews.atualizarViewsPorVersoes(t, versaoIds);
  }
}

// Helper function for Scenario 2: Process add_version to main tables
async function processAddVersion(t, session) {
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
        lote_id, metadado, descricao, data_criacao, data_edicao, 
        usuario_cadastramento_uuid, data_cadastramento
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, CURRENT_TIMESTAMP)
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
          tipo_status_id, situacao_carregamento_id, orgao_produtor, descricao,
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
          1, // tipo_status_id - Carregado
          arquivo.situacao_carregamento_id,
          arquivo.orgao_produtor, 
          arquivo.descricao,
          session.usuario_uuid
        ]
      );
    }
  }
  
  // Refresh views
  if (produtoIds.length > 0) {
    await refreshViews.atualizarViewsPorProdutos(t, produtoIds);
  }
}

// Helper function for Scenario 3: Process add_product to main tables
async function processAddProduct(t, session) {
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
        descricao, data_cadastramento, usuario_cadastramento_uuid, 
        data_modificacao, usuario_modificacao_uuid, geom
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP, $8, CURRENT_TIMESTAMP, $8, ST_GeomFromEWKT($9))
      RETURNING id`,
      [
        produtoTemp.nome,
        produtoTemp.mi,
        produtoTemp.inom,
        produtoTemp.tipo_escala_id,
        produtoTemp.denominador_escala_especial,
        produtoTemp.tipo_produto_id,
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
          lote_id, metadado, descricao, data_criacao, data_edicao, 
          usuario_cadastramento_uuid, data_cadastramento
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, CURRENT_TIMESTAMP)
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
            tipo_status_id, situacao_carregamento_id, orgao_produtor, descricao,
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
            1, // tipo_status_id - Carregado
            arquivo.situacao_carregamento_id,
            arquivo.orgao_produtor, 
            arquivo.descricao,
            session.usuario_uuid
          ]
        );
      }
    }
  }
  
  // Refresh views
  if (produtoIds.length > 0) {
    await refreshViews.atualizarViewsPorProdutos(t, produtoIds);
  }
}

module.exports = controller;
