'use strict'

const http = require('http')

const { databaseVersion } = require('../database')

const app = require('./app')

const { logger, AppError } = require('../utils')

const { VERSION, PORT } = require('../config')

/**
 * O SERVIDOR ANUNCIA UM DESFECHO SÓ, e o código de saída diz a verdade.
 *
 * Em 2026-08-04 um boot registrou "Servidor HTTP do Serviço iniciado" e "A porta
 * 3015 já está em uso" com 1 ms de diferença, saiu com código 1, e mesmo assim
 * atendeu a sessão inteira. Quem automatiza deploy lê o código de saída: nessa
 * forma ele deixa de ser sinal, e os dois enganos possíveis são silenciosos.
 *
 * A causa está no desenho antigo, e não no sistema operacional. O sucesso era
 * escrito dentro do callback do `listen`, sem trava, e o handler de `error` só
 * era registrado DEPOIS de o bind já ter começado. Nada tornava os dois
 * exclusivos: bastava o servidor emitir `listening` e falhar em seguida para as
 * duas linhas saírem.
 *
 * Duas mudanças resolvem, sem depender de descobrir o gatilho no Windows:
 *
 * 1. O `error` é registrado ANTES do `listen`, com o servidor criado à mão. Com
 *    `app.listen()` isso é impossível, porque ele já inicia o bind.
 * 2. Um sinalizador deixa `anunciar` acontecer uma vez só. O primeiro desfecho
 *    ganha, e o segundo é registrado como aviso, em vez de virar uma segunda
 *    verdade contraditória no log.
 */
const criarServidorHttps = () => {
  const fs = require('fs')
  const https = require('https')
  const path = require('path')

  const key = path.join(__dirname, 'sslcert/key.pem')
  const cert = path.join(__dirname, 'sslcert/cert.pem')

  if (!fs.existsSync(key) || !fs.existsSync(cert)) {
    throw new AppError(
      'Para executar o serviço no modo HTTPS é necessário criar a chave e certificado com OpenSSL. Verifique a Wiki do serviço no Github para mais informações'
    )
  }

  return https.createServer(
    {
      key: fs.readFileSync(key, 'utf8'),
      cert: fs.readFileSync(cert, 'utf8')
    },
    app
  )
}

const startServer = () => {
  const argv = require('minimist')(process.argv.slice(2))
  const https = ('https' in argv && argv.https)

  // Criado sem escutar: é o que permite registrar o `error` antes do bind.
  const server = https ? criarServidorHttps() : http.createServer(app)

  let anunciado = false

  const anunciarSucesso = () => {
    if (anunciado) return
    anunciado = true
    logger.info(`Servidor ${https ? 'HTTPS' : 'HTTP'} do Serviço iniciado`, {
      success: true,
      information: {
        version: VERSION,
        database_version: databaseVersion.nome,
        port: PORT
      }
    })
  }

  server.on('error', err => {
    // Falha DEPOIS de o sucesso já ter saído: o processo continua morrendo, que
    // é o certo, mas o log diz que houve os dois, em vez de fingir que a
    // primeira linha não existiu.
    if (anunciado) {
      logger.error(
        'O servidor anunciou que subiu e falhou em seguida. O processo vai encerrar.',
        { error: err }
      )
      process.exit(1)
    }

    anunciado = true
    if (err.code === 'EADDRINUSE') {
      logger.error(`A porta ${PORT} já está em uso. Encerre o processo que a ocupa ou altere PORT no config.env`, { error: err })
    } else {
      logger.error('Erro ao iniciar o servidor', { error: err })
    }
    process.exit(1)
  })

  server.listen(PORT, anunciarSucesso)

  return server
}

module.exports = startServer
