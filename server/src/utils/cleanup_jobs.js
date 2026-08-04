'use strict'

const cron = require('node-cron');
const { db } = require('../database');
const logger = require('./logger');

// Initialize cleanup jobs
const initCleanupJobs = () => {
  cron.schedule('0 * * * *', async () => {
    try {
      // Downloads: passa pelo CONTROLADOR, e não pela função SQL direto.
      //
      // A regra de quando um download vence tem de viver num lugar só. A rota
      // de administrador precisou do UPDATE aqui dentro para poder CONTAR o que
      // fechou e registrar quem mandou rodar; deixar o cron na função antiga
      // criaria duas cópias da mesma regra, que divergem com o tempo.
      //
      // Sem usuário, porque não há pessoa por trás: o evento de auditoria só é
      // gravado quando o cron fez alguma coisa, senão seria uma linha por hora
      // dizendo que não havia nada a fazer.
      // `require` aqui dentro, e nao no topo: `acervo_ctrl` puxa `../utils`, que
      // e o pacote deste arquivo. No topo, o ciclo entregaria um modulo pela
      // metade conforme a ordem de carga.
      const acervoCtrl = require('../acervo/acervo_ctrl');
      const { fechados } = await acervoCtrl.cleanupExpiredDownloads();
      logger.info(`Cleanup expired downloads completed successfully (${fechados} fechado(s))`);
      
      // Cleanup uploads
      await db.conn.any(`SELECT acervo.cleanup_expired_uploads()`);
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