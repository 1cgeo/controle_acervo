"use strict";

const { db } = require("../database");
const { AppError, httpCode } = require("../utils");

const controller = {};

controller.criaProduto = async (produto, userId) => {
  return db.sapConn.tx(async t => {
    produto.uuid_produto = produto.uuid_produto || uuid.v4()
    produto.uuid_versao = produto.uuid_versao || uuid.v4()
    produto.data_cadastramento = new Date()
    produto.usuario_cadastramento_id = userId
    produto.geom = `ST_GeomFromEWKT('${produto.geom}')`

    const colunasProduto = [
      'nome', 'uuid_produto', 'uuid_versao', 'data_criacao',
      'data_edicao', 'mi', 'inom', 'denominador_escala',
      'tipo_produto_id', 'situacao_bdgex_id', 'orgao_produtor',
      'descricao', 'data_cadastramento', 'usuario_cadastramento_id',
      'geom'
    ]

    const csProduto = new db.pgp.helpers.ColumnSet(colunasProduto, { table: 'produto', schema: 'acervo' })
    const queryProduto = db.pgp.helpers.insert(produto, csProduto)
    const produtoId = await t.one(`${queryProduto} RETURNING id`)

    for (const arquivo of produto.arquivos) {
      arquivo.produto_id = produtoId.id
    }

    const colunasArquivo = ['volume_armazenamento_id', 'produto_id', 'nome', 'descricao', 'extensao', 'tamanho_mb']
    const csArquivo = new db.pgp.helpers.ColumnSet(colunasArquivo, { table: 'arquivo', schema: 'acervo' })
    const queryArquivo = db.pgp.helpers.insert(produto.arquivos, csArquivo)
    await t.none(queryArquivo)
  })
}

controller.atualizaProduto = async (produto, userId) => {
  return db.sapConn.tx(async t => {
    produto.data_modificacao = new Date()
    produto.usuario_modificacao_id = userId
    produto.geom = `ST_GeomFromEWKT('${produto.geom}')`

    const colunasProduto = [
      'id', 'nome', 'uuid_produto', 'uuid_versao', 'data_criacao',
      'data_edicao', 'mi', 'inom', 'denominador_escala',
      'tipo_produto_id', 'situacao_bdgex_id', 'orgao_produtor',
      'descricao', 'data_modificacao', 'usuario_modificacao_id',
      'geom'
    ]

    const cs = new db.pgp.helpers.ColumnSet(colunasProduto, { table: 'produto', schema: 'acervo' })
    const query = db.pgp.helpers.update(produto, cs) + `WHERE id = ${produto.id}`

    await t.none(query)
  })
}

controller.deleteArquivos = async (arquivoIds, userId) => {
  return db.sapConn.tx(async t => {
    const arquivos = await t.any('SELECT * FROM acervo.arquivo WHERE id IN ($<arquivoIds:csv>)', { arquivoIds })
    const data_delete = new Date()
    const usuario_delete_id = userId

    for (let arquivo of arquivos) {
      await t.none(`
        INSERT INTO acervo.arquivo_deletado(volume_armazenamento_id, produto_id, nome, descricao, extensao, tamanho_mb, data_delete, usuario_delete_id) 
        VALUES($1, $2, $3, $4, $5, $6, $7, $8)`, 
      [arquivo.volume_armazenamento_id, arquivo.produto_id, arquivo.nome, arquivo.descricao, arquivo.extensao, arquivo.tamanho_mb, data_delete, usuario_delete_id])
    }

    await t.none('DELETE FROM acervo.arquivo WHERE id IN ($<arquivoIds:csv>)', { arquivoIds })
  })
}

controller.deleteProdutos = async (produtoIds, userId) => {
  const data_delete = new Date()
  const usuario_delete_id = userId

  return db.sapConn.tx(async t => {
    for (let id of produtoIds) {
      // Primeiro, obtenha o produto que você deseja deletar.
      const produto = await t.oneOrNone('SELECT * FROM acervo.produto WHERE id = $1', [id])
      if (!produto) continue;

      // Copie o produto para a tabela produto_deletado.
      await t.none('INSERT INTO acervo.produto_deletado(nome, uuid_produto, uuid_versao, data_criacao, data_edicao, mi, inom, denominador_escala, tipo_produto_id, situacao_bdgex_id, orgao_produtor, descricao, data_cadastramento, usuario_cadastramento_id, data_modificacao, usuario_modificacao_id, data_delete, usuario_delete_id, geom) VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)', 
      [produto.nome, produto.uuid_produto, produto.uuid_versao, produto.data_criacao, produto.data_edicao, produto.mi, produto.inom, produto.denominador_escala, produto.tipo_produto_id, produto.situacao_bdgex_id, produto.orgao_produtor, produto.descricao, produto.data_cadastramento, produto.usuario_cadastramento_id, produto.data_modificacao, produto.usuario_modificacao_id, data_delete, usuario_delete_id, produto.geom])

      // Mova os arquivos associados para a tabela arquivo_deletado.
      const arquivos = await t.any('SELECT * FROM acervo.arquivo WHERE produto_id = $1', [id])
      for (let arquivo of arquivos) {
        await t.none('INSERT INTO acervo.arquivo_deletado(volume_armazenamento_id, produto_id, nome, descricao, extensao, tamanho_mb, data_delete, usuario_delete_id) VALUES($1, $2, $3, $4, $5, $6, $7, $8)', 
        [arquivo.volume_armazenamento_id, id, arquivo.nome, arquivo.descricao, arquivo.extensao, arquivo.tamanho_mb, data_delete, usuario_delete_id])
      }

      // Depois de mover todos os arquivos, delete-os da tabela original.
      await t.none('DELETE FROM acervo.arquivo WHERE produto_id = $1', [id])

      // Finalmente, delete o produto da tabela original.
      await t.none('DELETE FROM acervo.produto WHERE id = $1', [id])
    }
  })
}

module.exports = controller;
