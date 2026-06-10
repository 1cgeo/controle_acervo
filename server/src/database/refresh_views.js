// Path: database\refresh_views.js
'use strict'

// SELECT de função sempre retorna 1 linha, então .any() (não .none(), que
// rejeitaria com QueryResultError). Os ids vêm de RETURNING como strings
// (BIGSERIAL), por isso o cast explícito para bigint[].
const refreshViews = {}

refreshViews.atualizarViewsPorProdutos = async (connection, produtoIds) => {
    return connection.any('SELECT acervo.atualizar_mv_por_produtos($1::bigint[])', [produtoIds]);
};

refreshViews.atualizarViewsPorVersoes = async (connection, versaoIds) => {
    return connection.any('SELECT acervo.atualizar_mv_por_versoes($1::bigint[])', [versaoIds]);
};

refreshViews.atualizarViewsPorArquivos = async (connection, arquivoIds) => {
    return connection.any('SELECT acervo.atualizar_mv_por_arquivos($1::bigint[])', [arquivoIds]);
};

module.exports = refreshViews
