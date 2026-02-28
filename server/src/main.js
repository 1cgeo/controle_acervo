// Path: main.js
'use strict'

const { errorHandler, serializeErrorLoader } = require('./utils')
const { startServer } = require('./server')
const { db, databaseVersion } = require('./database')
const { verifyAuthServer } = require('./authentication')
const { initCleanupJobs } = require('./utils/cleanup_jobs')

serializeErrorLoader.ready
  .then(db.createConn)
  .then(databaseVersion.load)
  .then(verifyAuthServer)
  .then(() => {
    initCleanupJobs();
    return startServer();
  })
  .catch(errorHandler.critical)
