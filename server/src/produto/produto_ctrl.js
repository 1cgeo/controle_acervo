"use strict";

const { db } = require("../database");
const { AppError, httpCode } = require("../utils");

const controller = {};

controller.atualizaProduto = async (produto, usuarioUuid) => {
  return db.sapConn.tx(async t => {
    produto.data_modificacao = new Date()
    produto.usuario_modificacao_uuid = usuarioUuid

    const colunasProduto = [
      'nome', 'mi', 'inom', 'denominador_escala',
      'tipo_produto_id', 'descricao',
      'data_modificacao', 'usuario_modificacao_uuid'
    ]

    const cs = new db.pgp.helpers.ColumnSet(colunasProduto, { table: 'produto', schema: 'acervo' })
    const query = db.pgp.helpers.update(produto, cs) + `WHERE id = ${produto.id}`

    await t.none(query)
  })
}

controller.atualizaVersao = async (versao, usuarioUuid) => {
  return db.sapConn.tx(async t => {
    versao.data_modificacao = new Date();
    versao.usuario_modificacao_uuid = usuarioUuid;

    const colunasVersao = [
      'versao', 'uuid_versao','descricao', 'metadata', 'lote_id',
      'data_criacao', 'data_edicao',
      'data_modificacao', 'usuario_modificacao_uuid'
    ];

    const cs = new db.pgp.helpers.ColumnSet(colunasVersao, { table: 'versao', schema: 'acervo' });
    const query = db.pgp.helpers.update(versao, cs) + ` WHERE id = ${versao.id}`;

    await t.none(query);
  });
};

controller.atualizaArquivo = async (arquivo, usuarioUuid) => {
  return db.sapConn.tx(async t => {
    arquivo.data_modificacao = new Date();
    arquivo.usuario_modificacao_uuid = usuarioUuid;

    const colunasArquivo = [
      'nome', 'tipo_arquivo_id',
      'metadado', 'situacao_bdgex_id', 'orgao_produtor', 'descricao', 
      'data_modificacao', 'usuario_modificacao_uuid'
    ];

    const cs = new db.pgp.helpers.ColumnSet(colunasArquivo, { table: 'arquivo', schema: 'acervo' });
    const query = db.pgp.helpers.update(arquivo, cs) + ` WHERE id = ${arquivo.id}`;

    await t.none(query);
  });
};

controller.deleteProdutos = async (produtoIds, motivo_exclusao, usuarioUuid) => {
  const data_delete = new Date();
  const usuario_delete_uuid = usuarioUuid;

  return db.sapConn.tx(async t => {
    for (let id of produtoIds) {
      const produto = await t.oneOrNone('SELECT * FROM acervo.produto WHERE id = $1', [id]);
      if (!produto) continue;

      // Find all versions related to the product
      const versoes = await t.any('SELECT * FROM acervo.versao WHERE produto_id = $1', [id]);
      for (let versao of versoes) {
        // Move associated files to arquivo_deletado table
        const arquivos = await t.any('SELECT * FROM acervo.arquivo WHERE versao_id = $1', [versao.id]);
        for (let arquivo of arquivos) {
          const arquivoDeletadoId = await t.one(
            `INSERT INTO acervo.arquivo_deletado (
              uuid_arquivo, nome, nome_arquivo, motivo_exclusao, versao_id, tipo_arquivo_id, 
              volume_armazenamento_id, extensao, tamanho_mb, checksum, metadata, 
              tipo_status_id, situacao_bdgex_id, orgao_produtor, descricao, 
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
              arquivo.metadata, 
              4, //Em exclusão
              arquivo.situacao_bdgex_id, 
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
        }

        // Move related downloads to download_deletado table using the new arquivo_deletado_id
        await t.none(
          `INSERT INTO acervo.download_deletado (arquivo_deletado_id, usuario_uuid, data_download)
           SELECT $1, d.usuario_uuid, d.data_download
           FROM acervo.download d
           WHERE d.arquivo_id = $2`,
          [arquivoDeletadoId.id, arquivo.id]
        );

        // Delete related downloads from the original download table
       await t.none('DELETE FROM acervo.download WHERE arquivo_id = $1', [arquivo.id]);

        // Delete files from the original arquivo table
        await t.none('DELETE FROM acervo.arquivo WHERE versao_id = $1', [versao.id]);

        // Delete the version from the versao table
        await t.none('DELETE FROM acervo.versao WHERE id = $1', [versao.id]);
      }

      // Finally, delete the product itself from the produto table
      await t.none('DELETE FROM acervo.produto WHERE id = $1', [id]);
    }
  });
};

controller.deleteVersoes = async (versaoIds, motivo_exclusao, usuarioUuid) => {
  const data_delete = new Date();
  const usuario_delete_uuid = usuarioUuid;

  return db.sapConn.tx(async t => {
    for (let id of versaoIds) {
      const versao = await t.oneOrNone('SELECT * FROM acervo.versao WHERE id = $1', [id]);
      if (!versao) continue;

      // Move associated files to arquivo_deletado table
      const arquivos = await t.any('SELECT * FROM acervo.arquivo WHERE versao_id = $1', [versao.id]);
      for (let arquivo of arquivos) {
        const arquivoDeletadoId = await t.one(
          `INSERT INTO acervo.arquivo_deletado (
            uuid_arquivo, nome, nome_arquivo, motivo_exclusao, versao_id, tipo_arquivo_id, 
            volume_armazenamento_id, extensao, tamanho_mb, checksum, metadata, 
            tipo_status_id, situacao_bdgex_id, orgao_produtor, descricao, 
            data_cadastramento, usuario_cadastramento_uuid, data_modificacao, 
            usuario_modificacao_uuid, data_delete, usuario_delete_uuid
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 
                    $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
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
            arquivo.metadata, 
            4, //Em exclusão
            arquivo.situacao_bdgex_id, 
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
      }

       // Move related downloads to download_deletado table using the new arquivo_deletado_id
       await t.none(
        `INSERT INTO acervo.download_deletado (arquivo_deletado_id, usuario_uuid, data_download)
         SELECT $1, d.usuario_uuid, d.data_download
         FROM acervo.download d
         WHERE d.arquivo_id = $2`,
        [arquivoDeletadoId.id, arquivo.id]
      );

      // Delete related downloads from the original download table
      await t.none('DELETE FROM acervo.download WHERE arquivo_id = $1', [arquivo.id]);

      // Delete files from the original arquivo table
      await t.none('DELETE FROM acervo.arquivo WHERE versao_id = $1', [versao.id]);

      // Finally, delete the version itself from the versao table
      await t.none('DELETE FROM acervo.versao WHERE id = $1', [versao.id]);
    }
  });
};

controller.deleteArquivos = async (arquivoIds, motivo_exclusao, usuarioUuid) => {
  const data_delete = new Date();
  const usuario_delete_uuid = usuarioUuid;

  return db.sapConn.tx(async t => {
    for (let id of arquivoIds) {
      const arquivo = await t.oneOrNone('SELECT * FROM acervo.arquivo WHERE id = $1', [id]);
      if (!arquivo) continue;

      // Move the file to arquivo_deletado table
      const arquivoDeletadoId = await t.one(
        `INSERT INTO acervo.arquivo_deletado (
          uuid_arquivo, nome, nome_arquivo, motivo_exclusao, versao_id, tipo_arquivo_id, 
          volume_armazenamento_id, extensao, tamanho_mb, checksum, metadata, 
          tipo_status_id, situacao_bdgex_id, orgao_produtor, descricao, 
          data_cadastramento, usuario_cadastramento_uuid, data_modificacao, 
          usuario_modificacao_uuid, data_delete, usuario_delete_uuid
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 
                  $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
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
          arquivo.metadata, 
          4, //Em exclusão
          arquivo.situacao_bdgex_id, 
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

      // Move related downloads to download_deletado table using the new arquivo_deletado_id
      await t.none(
        `INSERT INTO acervo.download_deletado (arquivo_deletado_id, usuario_uuid, data_download)
         SELECT $1, d.usuario_uuid, d.data_download
         FROM acervo.download d
         WHERE d.arquivo_id = $2`,
        [arquivoDeletadoId.id, arquivo.id]
      );

      // Delete related downloads from the original download table
      await t.none('DELETE FROM acervo.download WHERE arquivo_id = $1', [arquivo.id]);

      // Finally, delete the file itself from the arquivo table
      await t.none('DELETE FROM acervo.arquivo WHERE id = $1', [id]);
    }
  });
};

controller.getVersaoRelacionamento = async () => {
  return db.sapConn.any(
    `SELECT id, versao_id_1, versao_id_2, tipo_relacionamento_id, data_relacionamento, usuario_relacionamento_uuid 
     FROM acervo.versao_relacionamento`
  );
};

controller.criaVersaoRelacionamento = async (versaoRelacionamento, usuarioUuid) => {
  versaoRelacionamento.usuario_relacionamento_uuid = usuarioUuid;

  return db.sapConn.tx(async t => {
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

  return db.sapConn.tx(async t => {
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

controller.deleteVersaoRelacionamento = async versaoRelacionamentoIds => {
  return db.sapConn.task(async t => {
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

module.exports = controller;
