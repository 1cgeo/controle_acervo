'use strict'

const { errorHandler, serializeErrorLoader } = require('./utils')
const { startServer } = require('./server')
const { db, databaseVersion } = require('./database')

// O boot tinha um `verifyAuthServer` entre a versao do banco e os jobs: o SCA
// se recusava a subir enquanto o Auth Server externo nao respondesse. Ele saiu
// em 2026-08-02 com a fusao: a senha e validada aqui dentro, entao nao ha
// mais servico de terceiro de quem depender para alguem conseguir entrar.
//
// O CRON SAIU EM 2026-08-04, a pedido do chefe. Eram dois: limpeza de downloads
// e uploads expirados (de hora em hora) e varredura da fila de miniaturas (na
// meia hora). Duas instancias do app contra o mesmo banco rodavam os dois em
// dobro, e o de miniatura ESCREVE. Agora as duas tarefas tem rota de
// administrador, e quem manda rodar fica no rastro.
//
// A expiracao do download deixou de depender disso: `confirmDownload` recusa
// token vencido na hora do uso. Antes, so o cron fechava, entao o token valia
// ate a proxima passada, ou para sempre com o cron desligado.
serializeErrorLoader.ready
  .then(db.createConn)
  .then(databaseVersion.load)
  .then(startServer)
  .catch(errorHandler.critical)
