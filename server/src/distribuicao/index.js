'use strict'

module.exports = {
  distribuicaoRoute: require('./distribuicao_route'),
  // O controller sai nomeado porque `calculaFila` nao e so da rota: quem
  // gerencia a producao tambem precisa saber o que a fila entregaria a uma
  // pessoa sem entregar de verdade.
  distribuicaoCtrl: require('./distribuicao_ctrl')
}
