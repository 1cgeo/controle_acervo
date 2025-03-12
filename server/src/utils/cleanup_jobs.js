// Path: utils\cleanup_jobs.js
'use strict'

const cron = require('node-cron');
const { db } = require('../database');
const { logger } = require('./logger');

// Initialize cleanup jobs
const initCleanupJobs = () => {
  // Schedule job to run every hour
  cron.schedule('0 * * * *', async () => {
    try {
      // Cleanup downloads
      await db.conn.none(`SELECT acervo.cleanup_expired_downloads()`);
      logger.info('Cleanup expired downloads completed successfully');
      
      // Cleanup uploads
      await db.conn.none(`SELECT acervo.cleanup_expired_uploads()`);
      logger.info('Cleanup expired uploads completed successfully');
    } catch (error) {
      logger.error('Error cleaning up expired records', { error });
    }
  });
  
  logger.info('Cleanup jobs scheduled');
};

module.exports = {
  initCleanupJobs
};