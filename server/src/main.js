'use strict'

const { errorHandler, serializeErrorLoader } = require('./utils')
const { startServer } = require('./server')
const { db, databaseVersion } = require('./database')
const { initCleanupJobs } = require('./utils/cleanup_jobs')
const { initMiniaturaJob } = require('./utils/miniatura_job')

// O boot tinha um `verifyAuthServer` entre a versao do banco e os jobs: o SCA
// se recusava a subir enquanto o Auth Server externo nao respondesse. Ele saiu
// em 2026-08-02 com a fusao -- a senha e validada aqui dentro, entao nao ha
// mais servico de terceiro de quem depender para alguem conseguir entrar.
serializeErrorLoader.ready
  .then(db.createConn)
  .then(databaseVersion.load)
  .then(() => {
    initCleanupJobs();
    initMiniaturaJob();
    return startServer();
  })
  .catch(errorHandler.critical)
