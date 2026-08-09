'use strict'

// GERENCIA DA PRODUCAO, herdada do `server/src/gerencia/` do SAP 2.3.5.
//
// O NOME DA PASTA NAO E O DO SAP, e a colisao foi medida: `/api/gerencia` ja
// existe aqui com 14 rotas do ACERVO (dominio e manutencao), entao o modulo de
// la entrou como `gerencia_producao`. Quem chega e quem se acomoda.
//
// A estrutura e a de quatro arquivos da casa, menos um: nao ha gerador de
// arquivo aqui, entao sao `index`, `*_ctrl`, `*_route` e `*_schema`. O que ficou
// de fora da travessia esta listado, com a razao de cada um, no cabecalho de
// `gerencia_producao_route.js`.

module.exports = {
  gerenciaProducaoRoute: require('./gerencia_producao_route')
}
