'use strict'

const { errorHandler, serializeErrorLoader } = require('./utils')
const { startServer } = require('./server')
const { db, databaseVersion } = require('./database')

// SEM agendamento no boot. A limpeza de download e upload expirados e a
// varredura da fila de miniaturas têm rota de administrador, e quem manda rodar
// fica no rastro: duas instâncias contra o mesmo banco rodariam as duas em
// dobro, e a de miniatura ESCREVE.
serializeErrorLoader.ready
  .then(db.createConn)
  .then(databaseVersion.load)
  .then(startServer)
  .catch(errorHandler.critical)
