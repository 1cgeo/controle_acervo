'use strict'

const { loginRoute } = require('../login')
const { acervoRoute } = require('../acervo')
const { gerenciaRoute } = require('../gerencia')

const routes = app => {
  app.use('/login', loginRoute)

  app.use('/acervo', acervoRoute)

  app.use('/gerencia', gerenciaRoute)
}
module.exports = routes
