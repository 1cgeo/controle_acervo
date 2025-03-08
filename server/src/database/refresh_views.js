// Path: database\refresh_views.js
'use strict'

const refreshViews = {}

refreshViews.atualizarViewsPorProdutos = async (connection, produtoIds) => {
    return connection.none('SELECT acervo.atualizar_mv_por_produtos($1)', [produtoIds]);
};

refreshViews.atualizarViewsPorVersoes = async (connection, versaoIds) => {
    return connection.none('SELECT acervo.atualizar_mv_por_versoes($1)', [versaoIds]);
};

refreshViews.atualizarViewsPorArquivos = async (connection, arquivoIds) => {
    return connection.none('SELECT acervo.atualizar_mv_por_arquivos($1)', [arquivoIds]);
};

module.exports = refreshViews
