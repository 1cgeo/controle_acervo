'use strict'

// Modulo orcamento (o antigo SCO, Sistema de Controle Orcamentario), absorvido
// como subarvore. Cada feature mantem a estrutura de origem
// (*_route / *_ctrl / *_schema / index). Os routers saem daqui e sao montados
// em routes.js sob o prefixo /api/orcamento/.

module.exports = {
  dominioRoute: require('./dominio').dominioRoute,
  configuracaoRoute: require('./configuracao').configuracaoRoute,
  // SEM a meta do PIT: ela e feature de plataforma, em server/src/pit/, servida
  // por /api/metas. O orcamento a consome pelas FKs de `pdr_item` e
  // `nota_credito`.
  dfdRoute: require('./dfd').dfdRoute,
  pdrRoute: require('./pdr').pdrRoute,
  notaCreditoRoute: require('./nota_credito').notaCreditoRoute,
  // O recolhimento de credito: um DOCUMENTO do SIAFI por linha, apontando a NC
  // que ele abate. Ate a 1.39.0 isto era a coluna `nota_credito.valor_recolhido`.
  recolhimentoRoute: require('./nota_credito').recolhimentoRoute,
  notaEmpenhoRoute: require('./nota_empenho').notaEmpenhoRoute,
  liquidacaoRoute: require('./nota_empenho').liquidacaoRoute,
  recebimentoRoute: require('./nota_empenho').recebimentoRoute,
  licitacaoRoute: require('./licitacao').licitacaoRoute,
  rpnpRoute: require('./licitacao').rpnpRoute,
  // A execucao por ND que alimenta as tres abas do painel. Era a "tabela 3.1"
  // da feature relatorio, e ficou no orcamento quando o RPCMTec saiu: o painel
  // pede NUMEROS quebrados em PDR e Extra-PDR, com linha de total, e e lido por
  // quem tem consulta no modulo -- o relatorio pede a visao do PDR formatada e
  // e admin-only. Ver orcamento/dashboard/dashboard_ctrl.js.
  dashboardRoute: require('./dashboard').dashboardRoute,
  // SEM o RPCMTec, pelo mesmo motivo: ele e feature de plataforma, em
  // server/src/rpcmtec/, servida por /api/rpcmtec. O orcamento e FONTE das
  // subsecoes 4.1 a 4.7, e nao dono do relatorio.
  arquivoRoute: require('./arquivo').arquivoRoute
}
