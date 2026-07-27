// Path: orcamento\index.js
'use strict'

// Modulo orcamento (o antigo SCO, Sistema de Controle Orcamentario), absorvido
// como subarvore. Cada feature mantem a estrutura de origem
// (*_route / *_ctrl / *_schema / index). Os routers saem daqui e sao montados
// em routes.js sob o prefixo /api/orcamento/.

module.exports = {
  dominioRoute: require('./dominio').dominioRoute,
  configuracaoRoute: require('./configuracao').configuracaoRoute,
  metaRoute: require('./meta').metaRoute,
  dfdRoute: require('./dfd').dfdRoute,
  pdrRoute: require('./pdr').pdrRoute,
  notaCreditoRoute: require('./nota_credito').notaCreditoRoute,
  notaEmpenhoRoute: require('./nota_empenho').notaEmpenhoRoute,
  liquidacaoRoute: require('./nota_empenho').liquidacaoRoute,
  recebimentoRoute: require('./nota_empenho').recebimentoRoute,
  licitacaoRoute: require('./licitacao').licitacaoRoute,
  rpnpRoute: require('./licitacao').rpnpRoute,
  relatorioRoute: require('./relatorio').relatorioRoute,
  arquivoRoute: require('./arquivo').arquivoRoute,
  arquivoCtrl: require('./arquivo').arquivoCtrl
}
