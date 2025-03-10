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

controller.bulkCreateProductsWithVersionAndMultipleFiles = async (produtos, usuarioUuid) => {
  return db.conn.tx(async t => {
    const produtosId = []
    for (const item of produtos) {
      const { produto, versao, arquivos } = item;

      // Insert product
      const { id: productId } = await t.one(
        `INSERT INTO acervo.produto(
          nome, mi, inom, tipo_escala_id, denominador_escala_especial, tipo_produto_id, descricao, 
          usuario_cadastramento_uuid, data_cadastramento, geom
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP, ST_GeomFromEWKT($8))
         RETURNING id`,
        [produto.nome, produto.mi, produto.inom, produto.tipo_escala_id, produto.denominador_escala_especial,
        produto.tipo_produto_id, produto.descricao, usuarioUuid, produto.geom]
      );

      produtosId.push(productId)

      if (!versao.uuid_versao) {
        versao.uuid_versao = uuidv4();
      }

      const { id: versionId } = await t.one(
        `INSERT INTO acervo.versao(
          uuid_versao, versao, nome, tipo_versao_id, subtipo_produto_id, produto_id, lote_id, metadado, descricao,
          data_criacao, data_edicao, usuario_cadastramento_uuid, data_cadastramento
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, CURRENT_TIMESTAMP)
         RETURNING id`,
        [versao.uuid_versao, versao.versao, versao.nome, versao.tipo_versao_id, versao.subtipo_produto_id, productId,
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
            tipo_status_id, situacao_carregamento_id, orgao_produtor, descricao,
            usuario_cadastramento_uuid, data_cadastramento
          ) VALUES (uuid_generate_v4(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, CURRENT_TIMESTAMP)`,
          [arquivo.nome, arquivo.nome_arquivo, versionId, arquivo.tipo_arquivo_id,
            volume_armazenamento_id, arquivo.extensao, arquivo.tamanho_mb,
          arquivo.checksum, arquivo.metadado, 1, // tipo_status_id is always 1
          arquivo.situacao_carregamento_id, arquivo.orgao_produtor, arquivo.descricao, usuarioUuid]
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
          uuid_versao, versao, nome, tipo_versao_id, subtipo_produto_id, produto_id, lote_id, metadado, descricao,
          data_criacao, data_edicao, usuario_cadastramento_uuid, data_cadastramento
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, CURRENT_TIMESTAMP)
         RETURNING id`,
        [versao.uuid_versao, versao.versao, versao.nome, versao.tipo_versao_id, versao.subtipo_produto_id, produto_id,
        versao.lote_id, versao.metadado, versao.descricao, versao.data_criacao,
        versao.data_edicao, usuarioUuid]
      );
      versoesId.push(versionId)

      // Check if volume_tipo_produto exists
      const volumeTipoProduto = await t.oneOrNone(
        `SELECT volume_armazenamento_id 
         FROM acervo.volume_tipo_produto 
         WHERE tipo_produto_id = $1 AND primario = TRUE`,
        [produto_id]
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
            tipo_status_id, situacao_carregamento_id, orgao_produtor, descricao,
            usuario_cadastramento_uuid, data_cadastramento
          ) VALUES (uuid_generate_v4(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, CURRENT_TIMESTAMP)`,
          [arquivo.nome, arquivo.nome_arquivo, versionId, arquivo.tipo_arquivo_id,
            volume_armazenamento_id, arquivo.extensao, arquivo.tamanho_mb,
          arquivo.checksum, arquivo.metadado, 1, // tipo_status_id is always 1
          arquivo.situacao_carregamento_id, arquivo.orgao_produtor, arquivo.descricao, usuarioUuid]
        );
      }
    }

    await refreshViews.atualizarViewsPorVersoes(t, versoesId);
  });
}

controller.verifica_sistematico_versoes_multiplos_arquivos = async (versoes) => {
  return db.conn.tx(async t => {
    const transfer_info = {};
    const espacoNecessarioPorVolume = {};

    for (const versao of versoes) {
      // Verificar se o produto existe
      const produto = await t.oneOrNone(
        'SELECT id, tipo_produto_id FROM acervo.produto WHERE inom = $1',
        [versao.produto_inom]
      );
      if (!produto) {
        throw new AppError(`Produto com INOM ${versao.produto_inom} não encontrado`, httpCode.NotFound);
      }

      // Verificar se existe um volume primário cadastrado para o tipo de produto
      const volumeTipoProduto = await t.oneOrNone(
        `SELECT va.id, va.volume, va.capacidade_gb
         FROM acervo.volume_tipo_produto vtp
         JOIN acervo.volume_armazenamento va ON va.id = vtp.volume_armazenamento_id
         WHERE vtp.tipo_produto_id = $1 AND vtp.primario = TRUE`,
        [produto.tipo_produto_id]
      );

      if (!volumeTipoProduto) {
        throw new AppError(`Não existe volume primário cadastrado para o tipo de produto do produto ${produto.id}`, httpCode.BadRequest);
      }

      // Verificar se a versão já existe pelo nome
      const versaoExistente = await t.oneOrNone(
        'SELECT id FROM acervo.versao WHERE produto_id = $1 AND versao = $2',
        [produto.id, versao.versao.versao]
      );

      if (versaoExistente) {
        throw new AppError(`Já existe uma versão com o nome "${versao.versao.versao}" para o produto ${versao.produto_inom}`, httpCode.Conflict);
      }

      // Verificar se algum arquivo já existe e calcular espaço necessário
      transfer_info[versao.versao.uuid_versao] = [];
      for (const arquivo of versao.arquivos) {
        const arquivoExistente = await t.oneOrNone(
          'SELECT id FROM acervo.arquivo WHERE nome_arquivo = $1 AND volume_armazenamento_id = $2',
          [arquivo.nome_arquivo, volumeTipoProduto.id]
        );

        if (arquivoExistente) {
          throw new AppError(`O arquivo ${arquivo.nome_arquivo} já existe no volume de armazenamento`, httpCode.Conflict);
        }

        // Adicionar ao espaço necessário para este volume
        if (!espacoNecessarioPorVolume[volumeTipoProduto.id]) {
          espacoNecessarioPorVolume[volumeTipoProduto.id] = 0;
        }
        espacoNecessarioPorVolume[volumeTipoProduto.id] += arquivo.tamanho_mb;

        // Adicionar informação de transferência
        transfer_info[versao.versao.uuid_versao].push({
          destination_path: path.join(volumeTipoProduto.volume, `${arquivo.nome_arquivo}${arquivo.extensao}`)
        });
      }
    }

    // Verificar espaço disponível para cada volume
    for (const [volumeId, espacoNecessario] of Object.entries(espacoNecessarioPorVolume)) {
      const espacoDisponivel = await t.one(
        `SELECT (va.capacidade_gb - COALESCE(SUM(a.tamanho_mb), 0) / 1024) as espaco_disponivel
          FROM acervo.volume_armazenamento va
          LEFT JOIN acervo.arquivo a ON a.volume_armazenamento_id = va.id
          WHERE va.id = $1
        GROUP BY va.id, va.capacidade_gb`,
        [volumeId]
      );

      if (espacoDisponivel.espaco_disponivel < espacoNecessario / 1024) { // Converter MB para GB
        throw new AppError(`Espaço insuficiente no volume de armazenamento ${volumeId}`, httpCode.BadRequest);
      }
    }

    return { transfer_info };
  });
};

controller.bulkSistematicCreateVersionWithFiles = async (versoes, usuarioUuid) => {
  return db.conn.tx(async t => {
    const versoesId = [];

    for (const item of versoes) {
      const { produto_inom, versao, arquivos } = item;

      // Encontrar o produto pelo INOM
      const produto = await t.oneOrNone('SELECT id, tipo_produto_id FROM acervo.produto WHERE inom = $1', [produto_inom]);
      if (!produto) {
        throw new AppError(`Produto com INOM ${produto_inom} não encontrado`, httpCode.NotFound);
      }

      // Obter o volume_armazenamento_id apropriado
      const volumeTipoProduto = await t.oneOrNone(
        `SELECT vtp.volume_armazenamento_id, va.volume
         FROM acervo.volume_armazenamento AS va
         INNER JOIN acervo.volume_tipo_produto AS vtp
         ON va.id = vtp.volume_armazenamento_id
         WHERE vtp.tipo_produto_id = $1 AND vtp.primario = TRUE`,
        [produto.tipo_produto_id]
      );

      if (!volumeTipoProduto) {
        throw new AppError(`Não existe volume_tipo_produto cadastrado para o tipo de produto do produto ${produto.id}`, httpCode.NotFound);
      }

      const volume_armazenamento_id = volumeTipoProduto.volume_armazenamento_id;

      // Verificar se todos os arquivos foram transferidos e se os checksums estão corretos
      for (const arquivo of arquivos) {
        const filePath = path.join(volumeTipoProduto.volume, `${arquivo.nome_arquivo}${arquivo.extensao}`);
        
        try {
          await fs.access(filePath);
        } catch (error) {
          throw new AppError(`Arquivo não encontrado: ${filePath}`, httpCode.NotFound);
        }

        const fileBuffer = await fs.readFile(filePath);
        const calculatedChecksum = crypto.createHash('sha256').update(fileBuffer).digest('hex');

        if (calculatedChecksum !== arquivo.checksum) {
          throw new AppError(`Checksum inválido para o arquivo: ${filePath}`, httpCode.BadRequest);
        }

        // Atualizar o tamanho do arquivo com o valor real
        arquivo.tamanho_mb = fileBuffer.length / (1024 * 1024);
      }

      // Inserir versão
      const { id: versionId } = await t.one(
        `INSERT INTO acervo.versao(
          uuid_versao, versao, nome, tipo_versao_id, subtipo_produto_id, produto_id, lote_id, metadado, descricao,
          data_criacao, data_edicao, usuario_cadastramento_uuid, data_cadastramento
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, CURRENT_TIMESTAMP)
         RETURNING id`,
        [versao.uuid_versao, versao.versao, versao.nome, versao.tipo_versao_id, versao.subtipo_produto_id, produto.id,
         versao.lote_id, versao.metadado, versao.descricao, versao.data_criacao,
         versao.data_edicao, usuarioUuid]
      );
      versoesId.push(versionId);

      // Inserir arquivos
      for (const arquivo of arquivos) {
        await t.none(
          `INSERT INTO acervo.arquivo(
            uuid_arquivo, nome, nome_arquivo, versao_id, tipo_arquivo_id,
            volume_armazenamento_id, extensao, tamanho_mb, checksum, metadado,
            tipo_status_id, situacao_carregamento_id, orgao_produtor, descricao,
            usuario_cadastramento_uuid, data_cadastramento
          ) VALUES (uuid_generate_v4(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, CURRENT_TIMESTAMP)`,
          [arquivo.nome, arquivo.nome_arquivo, versionId, arquivo.tipo_arquivo_id,
           volume_armazenamento_id, arquivo.extensao, arquivo.tamanho_mb,
           arquivo.checksum, arquivo.metadado, 1, // tipo_status_id is always 1
           arquivo.situacao_carregamento_id, arquivo.orgao_produtor, arquivo.descricao, usuarioUuid]
        );
      }
    }
    await refreshViews.atualizarViewsPorVersoes(t, versoesId);
  });
};

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
            tipo_status_id, situacao_carregamento_id, orgao_produtor, descricao,
            usuario_cadastramento_uuid, data_cadastramento
          ) VALUES (uuid_generate_v4(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, CURRENT_TIMESTAMP)`,
          [arquivo.nome, arquivo.nome_arquivo, versao_id, arquivo.tipo_arquivo_id,
            volume_armazenamento_id, arquivo.extensao, arquivo.tamanho_mb,
          arquivo.checksum, arquivo.metadado, 1, // tipo_status_id is always 1
          arquivo.situacao_carregamento_id, arquivo.orgao_produtor, arquivo.descricao, usuarioUuid]
        );
      }
    }
    await refreshViews.atualizarViewsPorArquivos(t, versoesIds);

  });
}

module.exports = controller;
