'use strict'

const { errorHandler, serializeErrorLoader } = require('./utils')
const { startServer } = require('./server')
const { db, databaseVersion } = require('./database')
const { verifyAuthServer } = require('./authentication')
const { initCleanupJobs } = require('./utils/cleanup_jobs')
const { initMiniaturaJob } = require('./utils/miniatura_job')

serializeErrorLoader.ready
  .then(db.createConn)
  .then(databaseVersion.load)
  .then(verifyAuthServer)
  .then(() => {
    initCleanupJobs();
    initMiniaturaJob();
    return startServer();
  })
  .catch(errorHandler.critical)
