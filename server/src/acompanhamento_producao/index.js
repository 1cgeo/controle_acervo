'use strict'

const acompanhamentoProducaoRoute = require('./acompanhamento_producao_route')

// O controlador sai nomeado porque ele responde perguntas que outras telas
// tambem fazem (o quadro de um lote, o realizado do ano), e quem as fizer deve
// chamar a mesma consulta em vez de escrever a segunda versao dela.
const acompanhamentoProducaoCtrl = require('./acompanhamento_producao_ctrl')

module.exports = { acompanhamentoProducaoRoute, acompanhamentoProducaoCtrl }
