'use strict'

// Sem `arquivoCtrl`: quem precisa do controlador (dfd_ctrl, nota_credito_ctrl)
// o requer pelo caminho do modulo. O reexport nao tinha chamador nenhum.
module.exports = {
  arquivoRoute: require('./arquivo_route')
}
