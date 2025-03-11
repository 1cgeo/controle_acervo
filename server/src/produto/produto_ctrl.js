// Path: produto\produto_ctrl.js
"use strict";

const { db, refreshViews } = require("../database");
const { AppError, httpCode } = require("../utils");
const { v4: uuidv4 } = require('uuid');

const controller = {};

controller.atualizaProduto = async (produto, usuarioUuid) => {
  return db.conn.tx(async t => {
    produto.data_modificacao = new Date()
    produto.usuario_modificacao_uuid = usuarioUuid

    const colunasProduto = [
      'nome', 'mi', 'inom', 'tipo_escala_id', 'denominador_escala_especial',
      'tipo_produto_id', 'descricao',
      'data_modificacao', 'usuario_modificacao_uuid'
    ]

    const cs = new db.pgp.helpers.ColumnSet(colunasProduto, { table: 'produto', schema: 'acervo' })
    const query = db.pgp.helpers.update(produto, cs) + ' WHERE id = $1'

    await t.none(query, [produto.id])

    await refreshViews.atualizarViewsPorProdutos(t, [produto.id])
  })
}

controller.atualizaVersao = async (versao, usuarioUuid) => {
  return db.conn.tx(async t => {
    versao.data_modificacao = new Date();
    versao.usuario_modificacao_uuid = usuarioUuid;

    const colunasVersao = [
      'versao', 'nome', 'tipo_versao_id', 'subtipo_produto_id',
      'descricao', 'metadado', 'lote_id',
      'data_criacao', 'data_edicao',
      'data_modificacao', 'usuario_modificacao_uuid'
    ];

    const cs = new db.pgp.helpers.ColumnSet(colunasVersao, { table: 'versao', schema: 'acervo' });
    const query = db.pgp.helpers.update(versao, cs) + ' WHERE id = $1';

    await t.none(query, [versao.id]);

    await refreshViews.atualizarViewsPorVersoes(t, [versao.id])
  });
};


controller.deleteProdutos = async (produtoIds, motivo_exclusao, usuarioUuid) => {
  const data_delete = new Date();
  const usuario_delete_uuid = usuarioUuid;

  return db.conn.tx(async t => {
    // Verificar se todos os IDs de produto existem
    const existingProducts = await t.any(
      `SELECT id FROM acervo.produto WHERE id IN ($1:csv)`,
      [produtoIds]
    );

    if (existingProducts.length !== produtoIds.length) {
      const existingIds = existingProducts.map(p => p.id);
      const missingIds = produtoIds.filter(id => !existingIds.includes(parseInt(id)));
      throw new AppError(`Os seguintes produtos não foram encontrados: ${missingIds.join(', ')}`, httpCode.NotFound);
    }

    for (let id of produtoIds) {
      const produto = await t.one('SELECT * FROM acervo.produto WHERE id = $1', [id]);

      // Find all versions related to the product
      const versoes = await t.any('SELECT * FROM acervo.versao WHERE produto_id = $1', [id]);
      for (let versao of versoes) {
        // Move associated files to arquivo_deletado table
        const arquivos = await t.any('SELECT * FROM acervo.arquivo WHERE versao_id = $1', [versao.id]);
        for (let arquivo of arquivos) {
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
        }

        // Delete files from the original arquivo table
        await t.none('DELETE FROM acervo.arquivo WHERE versao_id = $1', [versao.id]);
        
        // Check for versao_relacionamento and delete
        await t.none(`
          DELETE FROM acervo.versao_relacionamento 
          WHERE versao_id_1 = $1 OR versao_id_2 = $1`, 
          [versao.id]
        );
      }

      // Delete all versions
      await t.none('DELETE FROM acervo.versao WHERE produto_id = $1', [id]);

      // Finally, delete the product itself from the produto table
      await t.none('DELETE FROM acervo.produto WHERE id = $1', [id]);
    }
    
    await refreshViews.atualizarViewsPorProdutos(t, produtoIds);
  });
};

controller.deleteVersoes = async (versaoIds, motivo_exclusao, usuarioUuid) => {
  const data_delete = new Date();
  const usuario_delete_uuid = usuarioUuid;

  return db.conn.tx(async t => {
    // Verificar se todos os IDs de versão existem
    const existingVersions = await t.any(
      `SELECT id FROM acervo.versao WHERE id IN ($1:csv)`,
      [versaoIds]
    );

    if (existingVersions.length !== versaoIds.length) {
      const existingIds = existingVersions.map(v => v.id);
      const missingIds = versaoIds.filter(id => !existingIds.includes(parseInt(id)));
      throw new AppError(`As seguintes versões não foram encontradas: ${missingIds.join(', ')}`, httpCode.NotFound);
    }

    for (let id of versaoIds) {
      const versao = await t.one('SELECT * FROM acervo.versao WHERE id = $1', [id]);

      // Verificar se é a única versão do produto
      const countVersions = await t.one(
        `SELECT COUNT(*) as count FROM acervo.versao WHERE produto_id = $1`,
        [versao.produto_id]
      );
      
      if (parseInt(countVersions.count) === 1) {
        throw new AppError(
          `Não é possível excluir a versão ${versao.versao} pois é a única versão do produto. Delete o produto inteiro.`, 
          httpCode.BadRequest
        );
      }

      // Move associated files to arquivo_deletado table
      const arquivos = await t.any('SELECT * FROM acervo.arquivo WHERE versao_id = $1', [versao.id]);
      for (let arquivo of arquivos) {
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
      }

      // Delete files from the original arquivo table
      await t.none('DELETE FROM acervo.arquivo WHERE versao_id = $1', [versao.id]);
      
      // Delete related versao_relacionamento entries
      await t.none(`
        DELETE FROM acervo.versao_relacionamento 
        WHERE versao_id_1 = $1 OR versao_id_2 = $1`, 
        [versao.id]
      );

      // Delete the version itself from the versao table
      await t.none('DELETE FROM acervo.versao WHERE id = $1', [versao.id]);
    }

    await refreshViews.atualizarViewsPorVersoes(t, versaoIds);
  });
};

controller.getVersaoRelacionamento = async () => {
  return db.conn.any(
    `SELECT 
      vr.id, vr.versao_id_1, vr.versao_id_2, vr.tipo_relacionamento_id, 
      vr.data_relacionamento, vr.usuario_relacionamento_uuid,
      tr.nome AS tipo_relacionamento_nome,
      v1.versao AS versao_1_nome, v1.produto_id AS produto_id_1,
      p1.nome AS produto_nome_1, p1.mi AS mi_1, p1.inom AS inom_1,
      v2.versao AS versao_2_nome, v2.produto_id AS produto_id_2,
      p2.nome AS produto_nome_2, p2.mi AS mi_2, p2.inom AS inom_2
     FROM acervo.versao_relacionamento vr
     INNER JOIN dominio.tipo_relacionamento tr ON vr.tipo_relacionamento_id = tr.code
     INNER JOIN acervo.versao v1 ON vr.versao_id_1 = v1.id
     INNER JOIN acervo.versao v2 ON vr.versao_id_2 = v2.id
     INNER JOIN acervo.produto p1 ON v1.produto_id = p1.id
     INNER JOIN acervo.produto p2 ON v2.produto_id = p2.id`
  );
};

controller.criaVersaoRelacionamento = async (versaoRelacionamento, usuarioUuid) => {
  versaoRelacionamento.usuario_relacionamento_uuid = usuarioUuid;

  return db.conn.tx(async t => {
    const cs = new db.pgp.helpers.ColumnSet([
      'versao_id_1', 'versao_id_2', 'tipo_relacionamento_id', 'usuario_relacionamento_uuid'
    ]);

    const query = db.pgp.helpers.insert(versaoRelacionamento, cs, {
      table: 'versao_relacionamento',
      schema: 'acervo'
    });

    await t.none(query);
  });
};

controller.atualizaVersaoRelacionamento = async (versaoRelacionamento, usuarioUuid) => {
  versaoRelacionamento.usuario_relacionamento_uuid = usuarioUuid;

  return db.conn.tx(async t => {
    const cs = new db.pgp.helpers.ColumnSet([
      'id', 'versao_id_1', 'versao_id_2', 'tipo_relacionamento_id', 'usuario_relacionamento_uuid'
    ]);

    const query = 
      db.pgp.helpers.update(
        versaoRelacionamento,
        cs,
        { table: 'versao_relacionamento', schema: 'acervo' },
        {
          tableAlias: 'X',
          valueAlias: 'Y'
        }
      ) + ' WHERE Y.id = X.id';

    await t.none(query);
  });
};

controller.deleteVersaoRelacionamento = async (versaoRelacionamentoIds, usuarioUuid) => {
  return db.conn.tx(async t => {
    const exists = await t.any(
      `SELECT id FROM acervo.versao_relacionamento
      WHERE id in ($<versaoRelacionamentoIds:csv>)`,
      { versaoRelacionamentoIds }
    );

    if (exists && exists.length < versaoRelacionamentoIds.length) {
      throw new AppError(
        'O id informado não corresponde a uma entrada do Versão Relacionamento',
        httpCode.BadRequest
      );
    }

    return t.any(
      `DELETE FROM acervo.versao_relacionamento
      WHERE id in ($<versaoRelacionamentoIds:csv>)`,
      { versaoRelacionamentoIds }
    );
  });
};

controller.criaVersaoHistorica = async (versoes, usuarioUuid) => {
  const data_cadastramento = new Date();

  const versoesPreparadas = versoes.map(versao => {
    return {
      ...versao,
      uuid_versao: versao.uuid_versao || uuidv4(),
      data_cadastramento: data_cadastramento,
      usuario_cadastramento_uuid: usuarioUuid,
      tipo_versao_id: 2, // Registro Histórico
    };
  });

  const versoesId = versoes.map(versao => versao.id)

  return db.conn.tx(async t => {
    const cs = new db.pgp.helpers.ColumnSet([
      'uuid_versao', 'versao', 'nome', 'produto_id', 'lote_id', 'metadado', 'descricao',
      'data_criacao', 'data_edicao', 'tipo_versao_id', 'subtipo_produto_id', 'data_cadastramento', 'usuario_cadastramento_uuid'
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
        INSERT INTO acervo.produto(nome, mi, inom, tipo_escala_id, denominador_escala_especial, tipo_produto_id, descricao, geom, data_cadastramento, usuario_cadastramento_uuid)
        VALUES($1, $2, $3, $4, $5, $6, $7, ST_GeomFromGeoJSON($8), $9, $10)
        RETURNING id
      `, [produto.nome, produto.mi, produto.inom, produto.tipo_escala_id, produto.denominador_escala_especial, produto.tipo_produto_id, produto.descricao, produto.geom, data_cadastramento, usuarioUuid]);

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
        'uuid_versao', 'versao', 'nome', 'produto_id', 'lote_id', 'metadado', 'descricao',
        'data_criacao', 'data_edicao', 'tipo_versao_id', 'subtipo_produto_id', 'data_cadastramento', 'usuario_cadastramento_uuid'
      ], { table: 'versao', schema: 'acervo' });

      const query = db.pgp.helpers.insert(versoesPreparadas, cs);
      await t.none(query);
    }

    await refreshViews.atualizarViewsPorProdutos(t, produtosIds);
  });
};

controller.bulkCreateProducts = async (produtos, usuarioUuid) => {
  produtos.forEach(produto => {
    produto.data_cadastramento = new Date();
    produto.usuario_cadastramento_uuid = usuarioUuid;
    produto.geom = `ST_GeomFromEWKT('${produto.geom}')`;
  });

  return db.conn.tx(async t => {
    const cs = new db.pgp.helpers.ColumnSet([
      'nome', 'mi', 'inom', 'tipo_escala_id', 'denominador_escala_especial', 'tipo_produto_id', 'descricao',
      'usuario_cadastramento_uuid',
      {name: 'data_cadastramento', cast: 'date'},
      {name: 'geom', mod: ':raw'}
    ]);

    const query = db.pgp.helpers.insert(produtos, cs, {
      table: 'produto',
      schema: 'acervo'
    });

    await t.none(query);
  });
};

module.exports = controller;
