'use strict'

module.exports = {
  notaCreditoRoute: require('./nota_credito_route'),
  // O documento de recolhimento e feature IRMA da NC, e mora na mesma pasta pelo
  // mesmo motivo da liquidacao morar na pasta da nota de empenho: ninguem abre
  // "recolhimento n.o 12"; abre a nota de credito e olha o que dela foi
  // devolvido. A rota, porem, e propria (/api/orcamento/recolhimentos), porque o
  // fechamento do exercicio pergunta pelo ANO, e nao por uma NC.
  recolhimentoRoute: require('./recolhimento_route')
}
