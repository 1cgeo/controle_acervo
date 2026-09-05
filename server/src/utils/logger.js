'use strict'

const { createLogger, format, transports } = require('winston')
const DailyRotateFile = require('winston-daily-rotate-file')

const fs = require('fs')
const path = require('path')
const logDir = path.join(__dirname, '..', '..', 'logs')

if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir)
}

const rotateTransport = new DailyRotateFile({
  format: format.combine(format.timestamp(), format.json()),
  filename: path.join(logDir, '/%DATE%-application.log'),
  datePattern: 'YYYY-MM-DD',
  maxSize: '20m',
  maxFiles: '14d'
})

// UMA LINHA POR EVENTO, e é isso que o `replace` protege.
//
// O `combined.log` é lido de volta por `/logs` (`server/app.js`), que o parte
// por `\n` e publica os três últimos dias SEM autenticação, por decisão
// registrada. Dos três campos, só o terceiro passa por `JSON.stringify`: a
// MENSAGEM entra crua. Onde ela carrega texto vindo do corpo da requisição, uma
// quebra de linha deixava de ser texto e virava uma LINHA NOVA do log público,
// com data e mensagem à escolha de quem enviou -- o oposto do que uma trilha
// serve para fazer. Dois caminhos reais: o nome de módulo desconhecido em
// `perfis` (`usuario_ctrl.js`, de administrador) e o `campo desconhecido
// "<caminho>"` de `utils/schema_validation_estrito.js`, de qualquer pessoa
// autenticada.
//
// Exportado para o teste alcançar o formato sem subir transporte nenhum.
const linhaDoCombined = info => {
  const date = new Date(Date.now())
  const mensagem = String(info.message).replace(/[\r\n]+/g, ' ')
  return `${date}|${mensagem}|${JSON.stringify(info)}`
}

const combinedTransport = new transports.File({
  format: format.printf(linhaDoCombined),
  filename: path.join(logDir, 'combined.log'),
  // Sem limite o combined.log cresce para sempre (e /logs o carrega em memória)
  maxsize: 20 * 1024 * 1024,
  maxFiles: 3,
  tailable: true
})

const consoleTransport = new transports.Console({
  format: format.combine(format.colorize(), format.timestamp(), format.simple())
})

const logger = createLogger({
  transports: [consoleTransport, rotateTransport, combinedTransport]
})

// O formato do `combined.log` viaja junto do logger, e não como módulo à parte:
// ele não tem uso fora daqui, e quem o testa quer justamente o que o transporte
// usa, e não uma cópia.
logger.linhaDoCombined = linhaDoCombined

module.exports = logger
