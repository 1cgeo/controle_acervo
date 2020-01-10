'use strict'

const { loginRoute } = require('../login')
const { acervoRoute } = require('../acervo')
const { tipoProdutoRoute } = require('../produto')
const { volumeRoute } = require('../volume')
const { usuarioRoute } = require('../usuario')

const routes = app => {
  app.use('/login', loginRoute)

  app.use('/acervo', acervoRoute)

  app.use('/usuarios', usuarioRoute)

  app.use('/tipos_produto', tipoProdutoRoute)

  app.use('/volumes', volumeRoute)
}
module.exports = routes
