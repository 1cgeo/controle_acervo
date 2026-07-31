// Path: orcamento\utils\index.js
'use strict'

// O modulo orcamento reusa os utilitarios do SCA, com UMA excecao declarada: o
// schemaValidation.
//
// Os dois sistemas tem um arquivo com esse nome, mas o CONTRATO difere. O do
// SCA descarta chave desconhecida do corpo (stripUnknown) e devolve um aviso no
// envelope. O do orcamento RECUSA a chave desconhecida com 400 e sugere o nome
// declarado mais parecido. Trocar um pelo outro mudaria o contrato de todas as
// rotas do orcamento (200 no lugar de 400) e derrubaria o teste que fixa esse
// comportamento. A versao propria fica aqui, sem tocar no utils/ do SCA.
//
// O caminho de require nas features fica '../utils', igual ao do repo de
// origem, o que evita reescrever import por import na fusao.
//
// O ARQUIVO do validador estrito saiu daqui em 2026-07-31 e mora em
// utils/schema_validation_estrito.js: nada nele e do orcamento, e a rota /metas,
// que deixou o modulo, precisava do mesmo contrato. Este index continua sendo
// quem ESCOLHE o estrito para as rotas do orcamento, entao o contrato delas nao
// mudou.

module.exports = {
  ...require('../../utils'),
  schemaValidation: require('../../utils/schema_validation_estrito')
}
