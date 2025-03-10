// Path: main.js
'use strict'

const { errorHandler } = require('./utils')
const { startServer } = require('./server')
const { db, databaseVersion } = require('./database')
const { verifyAuthServer } = require('./authentication')

db.createConn()
  .then(databaseVersion.load)
  .then(verifyAuthServer)
  .then(startServer)
  .catch(errorHandler.critical)
