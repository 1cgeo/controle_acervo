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

  // Load database version (required by routes.js)
  await databaseVersion.load()

  // Now import the app (controllers will use the initialized db.conn)
  const app = require('../../server/app')
  appInstance = app
  return app
}

module.exports = { getApp }
