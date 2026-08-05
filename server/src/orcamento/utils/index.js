'use strict'

// O modulo orcamento reusa os utilitarios do SCA, com UMA excecao declarada: o
// schemaValidation.
//
// Os dois tem um arquivo com esse nome, e o CONTRATO difere. O do SCA descarta
// chave desconhecida do corpo (stripUnknown) e devolve um aviso no envelope. O
// do orcamento RECUSA a chave desconhecida com 400 e sugere o nome declarado
// mais parecido. Trocar um pelo outro mudaria o contrato de todas as rotas do
// orcamento (200 no lugar de 400).
//
// O ARQUIVO do validador estrito mora em `utils/schema_validation_estrito.js`,
// porque nada nele e do orcamento. Este index e quem o ESCOLHE para as rotas
// daqui.

module.exports = {
  ...require('../../utils'),
  schemaValidation: require('../../utils/schema_validation_estrito')
}
