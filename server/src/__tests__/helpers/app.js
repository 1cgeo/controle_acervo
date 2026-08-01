'use strict'

/**
 * Returns the Express app ready for Supertest.
 * Must be called AFTER setting NODE_ENV=test so config.js loads config_testing.env.
 *
 * The DB connection must be initialized before importing the app,
 * since controllers and routes import db at require-time.
 */
let appInstance = null

const getApp = async () => {
  if (appInstance) return appInstance

  // Initialize the DB connection that controllers will use
  const { db, databaseVersion } = require('../../database')
  await db.createConn()

  // Exigido pelo routes.js, que lê a versão no require.
  await databaseVersion.load()

  const app = require('../../server/app')
  appInstance = app
  return app
}

module.exports = { getApp }
