'use strict'

/**
 * A aritmética de PERÍODO do RPCMTec: ano mais mês, e nada além disso.
 *
 * POR QUE ESTE ARQUIVO EXISTE. A regra "o mês anterior, virando o ano em
 * janeiro" estava escrita DUAS vezes, em `rpcmtec_ctrl.js` e em
 * `rpcmtec_subsecao_ctrl.js`, e as duas cópias tinham assinaturas diferentes
 * (uma recebia dois argumentos, a outra um objeto). Mesma regra, dois contratos:
 * quem lesse uma e chamasse a outra receberia `NaN` no ano, sem erro nenhum.
 *
 * As duas cópias serviam ao mesmo mês: o RPCMTec compara sempre o mês do
 * recorte com o imediatamente anterior (o estoque que a edição passada
 * reportou, o digitado que se copia). É uma regra só, e agora mora num lugar só.
 *
 * A ASSINATURA é o objeto `{ ano, mes }`, e não `(ano, mes)`. É a forma que os
 * dois chamadores já tinham em mãos (a edição vem do banco com as duas
 * colunas), e ela não deixa inverter a ordem dos argumentos em silêncio.
 */

/**
 * O mês anterior a `{ ano, mes }`, virando o ano em janeiro.
 *
 * @param {{ano: number, mes: number}} periodo - Mês do recorte (mes de 1 a 12)
 * @returns {{ano: number, mes: number}} O mês imediatamente anterior
 */
const mesAnterior = ({ ano, mes }) =>
  mes === 1 ? { ano: ano - 1, mes: 12 } : { ano, mes: mes - 1 }

module.exports = { mesAnterior }
