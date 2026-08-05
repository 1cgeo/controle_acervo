'use strict'

// Plano Interno de Trabalho: o plano anual da Divisao.
//
// Feature de PLATAFORMA, e nao de modulo: o PIT e o que a Divisao se
// comprometeu a entregar no ano. O orcamento amarra a NC e o item do PDR a meta
// que financiam, e a mapoteca amarra o pedido de impressao a meta que ele
// cumpre. Mesmo criterio de `limites` no banco e de `/usuarios` na API.

module.exports = {
  pitRoute: require('./pit_route'),
  pitCtrl: require('./pit_ctrl')
}
