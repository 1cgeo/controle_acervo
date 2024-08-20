"use strict";

const { db } = require("../database");
const { AppError, httpCode } = require("../utils");

const controller = {};

controller.atualizaProduto = async (produto, userId) => {
  return db.sapConn.tx(async t => {
    produto.data_modificacao = new Date()
    produto.usuario_modificacao_id = userId

    const colunasProduto = [
      'nome', 'mi', 'inom', 'denominador_escala',
      'tipo_produto_id', 'descricao',
      'data_modificacao', 'usuario_modificacao_id'
    ]

    const cs = new db.pgp.helpers.ColumnSet(colunasProduto, { table: 'produto', schema: 'acervo' })
    const query = db.pgp.helpers.update(produto, cs) + `WHERE id = ${produto.id}`

    await t.none(query)
  })
}

controller.atualizaVersao = async (versao, userId) => {
  return db.sapConn.tx(async t => {
    versao.data_modificacao = new Date();
    versao.usuario_modificacao_id = userId;

    const colunasVersao = [
      'versao', 'descricao','descricao',
      'data_criacao', 'data_edicao',
      'data_modificacao', 'usuario_modificacao_id'
    ];

    const cs = new db.pgp.helpers.ColumnSet(colunasVersao, { table: 'versao', schema: 'acervo' });
    const query = db.pgp.helpers.update(versao, cs) + ` WHERE id = ${versao.id}`;

    await t.none(query);
  });
};

controller.atualizaArquivo = async (arquivo, userId) => {
  return db.sapConn.tx(async t => {
    arquivo.data_modificacao = new Date();
    arquivo.usuario_modificacao_id = userId;

    const colunasArquivo = [
      'nome', 'tipo_arquivo_id',
      'metadata', 'situacao_bdgex_id', 'orgao_produtor', 'descricao', 
      'data_modificacao', 'usuario_modificacao_id'
    ];

    const cs = new db.pgp.helpers.ColumnSet(colunasArquivo, { table: 'arquivo', schema: 'acervo' });
    const query = db.pgp.helpers.update(arquivo, cs) + ` WHERE id = ${arquivo.id}`;

    await t.none(query);
  });
};

controller.deleteProdutos = async (produtoIds, motivo_exclusao, userId) => {
  const data_delete = new Date();
  const usuario_delete_id = userId;

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
          await t.none(
            `INSERT INTO acervo.arquivo_deletado (
              uuid_arquivo, nome, nome_arquivo, motivo_exclusao, versao_id, tipo_arquivo_id, 
              volume_armazenamento_id, extensao, tamanho_mb, checksum, metadata, 
              tipo_status_id, situacao_bdgex_id, orgao_produtor, descricao, 
              data_cadastramento, usuario_cadastramento_id, data_modificacao, 
              usuario_modificacao_id, data_delete, usuario_delete_id
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 
                      $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)`,
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
              arquivo.usuario_cadastramento_id, 
              arquivo.data_modificacao, 
              arquivo.usuario_modificacao_id, 
              data_delete, 
              usuario_delete_id
            ]
          );
        }

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

controller.deleteVersoes = async (versaoIds, motivo_exclusao, userId) => {
  const data_delete = new Date();
  const usuario_delete_id = userId;

  return db.sapConn.tx(async t => {
    for (let id of versaoIds) {
      const versao = await t.oneOrNone('SELECT * FROM acervo.versao WHERE id = $1', [id]);
      if (!versao) continue;

      // Move associated files to arquivo_deletado table
      const arquivos = await t.any('SELECT * FROM acervo.arquivo WHERE versao_id = $1', [versao.id]);
      for (let arquivo of arquivos) {
        await t.none(
          `INSERT INTO acervo.arquivo_deletado (
            uuid_arquivo, nome, nome_arquivo, motivo_exclusao, versao_id, tipo_arquivo_id, 
            volume_armazenamento_id, extensao, tamanho_mb, checksum, metadata, 
            tipo_status_id, situacao_bdgex_id, orgao_produtor, descricao, 
            data_cadastramento, usuario_cadastramento_id, data_modificacao, 
            usuario_modificacao_id, data_delete, usuario_delete_id
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 
                    $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)`,
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
            arquivo.usuario_cadastramento_id, 
            arquivo.data_modificacao, 
            arquivo.usuario_modificacao_id, 
            data_delete, 
            usuario_delete_id
          ]
        );
      }

      // Delete files from the original arquivo table
      await t.none('DELETE FROM acervo.arquivo WHERE versao_id = $1', [versao.id]);

      // Finally, delete the version itself from the versao table
      await t.none('DELETE FROM acervo.versao WHERE id = $1', [versao.id]);
    }
  });
};

controller.deleteArquivos = async (arquivoIds, motivo_exclusao, userId) => {
  const data_delete = new Date();
  const usuario_delete_id = userId;

  return db.sapConn.tx(async t => {
    for (let id of arquivoIds) {
      const arquivo = await t.oneOrNone('SELECT * FROM acervo.arquivo WHERE id = $1', [id]);
      if (!arquivo) continue;

      // Move the file to arquivo_deletado table
      await t.none(
        `INSERT INTO acervo.arquivo_deletado (
          uuid_arquivo, nome, nome_arquivo, motivo_exclusao, versao_id, tipo_arquivo_id, 
          volume_armazenamento_id, extensao, tamanho_mb, checksum, metadata, 
          tipo_status_id, situacao_bdgex_id, orgao_produtor, descricao, 
          data_cadastramento, usuario_cadastramento_id, data_modificacao, 
          usuario_modificacao_id, data_delete, usuario_delete_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 
                  $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)`,
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
          arquivo.usuario_cadastramento_id, 
          arquivo.data_modificacao, 
          arquivo.usuario_modificacao_id, 
          data_delete, 
          usuario_delete_id
        ]
      );

      // Finally, delete the file itself from the arquivo table
      await t.none('DELETE FROM acervo.arquivo WHERE id = $1', [id]);
    }
  });
};

module.exports = controller;
