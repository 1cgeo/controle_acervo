'use strict'

module.exports = {
  // O controller sai nomeado porque quem mais o usa nao e uma rota: sao os
  // controllers de escrita dos tres modulos, que o chamam DENTRO da propria
  // transacao.
  auditoriaCtrl: require('./auditoria_ctrl'),
  auditoriaRoute: require('./auditoria_route')
}
