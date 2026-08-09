'use strict'

// CAMPO: a atividade que a Divisao executa fora dela.
//
// Feature de PLATAFORMA com prefixo proprio (`/api/campo`), e nao de modulo: ela
// nao tem linha em `dominio.modulo`, e a autorizacao dela cobra o modulo
// `producao`, que ja existia. A tela mora na secao PIT, ao lado do plano do ano
// e da execucao dele, porque campo e o trabalho que o PIT promete.
//
// A estrutura e a de quatro arquivos da casa (`index`, `*_ctrl`, `*_route`,
// `*_schema`). Sem um quinto para as fotos e os tracks: os dois sao filhos do
// campo, se leem na ficha dele e nao tem tela propria.

module.exports = {
  campoRoute: require('./campo_route')
}
