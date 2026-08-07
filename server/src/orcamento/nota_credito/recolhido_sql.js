'use strict'

/**
 * A FONTE UNICA da expressao "quanto desta nota de credito foi recolhido".
 *
 * Ate a 1.39.0 isto era uma COLUNA (`orcamento.nota_credito.valor_recolhido`),
 * um numero que alguem digitava na propria NC. A 1.40.0 a apagou: o recolhimento
 * e um DOCUMENTO do SIAFI (numero, data, ND, UG emitente e historico), mora em
 * `orcamento.nota_credito_recolhimento`, e o recolhido de uma NC e a SOMA das
 * linhas que apontam para ela.
 *
 * POR QUE UM ARQUIVO SO PARA ISTO. Sao SEIS consultas que precisam do mesmo
 * numero: a lista e a ficha da NC, o teto do empenho, a ficha da NE, o painel e
 * as subsecoes 4.1, 4.2 e 4.7 do RPCMTec. Enquanto era coluna, as seis liam o
 * mesmo `nc.valor_recolhido` e nao havia como discordarem. Copiada seis vezes, a
 * subconsulta volta a poder divergir, e o dia em que uma delas ganhar um filtro
 * a mais produz duas telas com dois recolhidos, sem erro nenhum entre as duas.
 *
 * COALESCE PARA ZERO, e nao NULO: a NC sem nenhum recolhimento recolheu zero, e
 * o saldo que a subtrai nao pode virar NULO por causa disso. A 4.1 do RPCMTec,
 * que distingue '-' (nao ha NC nesta ND) de '0,00' (ha NC, e nada foi recolhido),
 * consegue as duas coisas com esta mesma expressao: o COALESCE e por NC, e o SUM
 * de fora e que fica sem ele. Ver o comentario la.
 *
 * @param {string} [alias='nc'] - o apelido da `orcamento.nota_credito` na
 *   consulta que chama. IDENTIFICADOR INTERNO, escrito no proprio fonte da
 *   consulta; nunca entrada do usuario.
 * @returns {string} a subconsulta escalar, ja entre parenteses
 */
const recolhidoDaNc = (alias = 'nc') => `COALESCE((
       SELECT SUM(rec.valor)
         FROM orcamento.nota_credito_recolhimento AS rec
        WHERE rec.nota_credito_id = ${alias}.id
     ), 0)`

module.exports = { recolhidoDaNc }
