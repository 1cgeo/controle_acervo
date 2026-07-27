'use strict'

// Monta uma instancia Express minima para testes de rota com supertest,
// reproduzindo a cadeia real do app: middleware sendJsonAndLog (envelope) +
// body parser + as rotas informadas + o error handler que formata AppError.
// Diferente do app.js real, nao serve estaticos nem Swagger (irrelevante p/ API).

const express = require('express')
const { sendJsonAndLogMiddleware, errorHandler } = require('../../../utils')

/**
 * @param {Array<{path:string, router:Function}>} mounts
 * @returns {import('express').Express}
 */
function buildTestApp (mounts) {
  const app = express()
  app.use(sendJsonAndLogMiddleware)
  app.use(express.json())
  for (const { path, router } of mounts) {
    app.use(path, router)
  }
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err)
    return errorHandler.log(err, res)
  })
  return app
}

module.exports = { buildTestApp }
