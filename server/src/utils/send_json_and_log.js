// Path: utils\send_json_and_log.js
'use strict'

const logger = require('./logger')
const { VERSION } = require('../config')

const truncate = dados => {
  if (!dados || typeof dados !== 'object') return dados
  if ('senha' in dados) {
    dados.senha = '*'
  }

  const MAX_LENGTH = 500

  for (const key in dados) {
    if (Object.prototype.toString.call(dados[key]) === '[object String]') {
      if (dados[key].length > MAX_LENGTH) {
        dados[key] = dados[key].substring(0, MAX_LENGTH)
      }
    }
  }
}
const sendJsonAndLogMiddleware = (req, res, next) => {
  res.sendJsonAndLog = (success, message, status, dados = null, error = null, metadata = {}) => {
    const url = req.protocol + '://' + req.get('host') + req.originalUrl

    logger.info(message, {
      url,
      information: truncate(req.body),
      status,
      success,
      error
    })

    const userMessage = status === 500 ? 'Erro no servidor' : message
    const jsonData = {
      version: VERSION,
      success: success,
      message: userMessage,
      dados,
      ...metadata
    }

    return res.status(status).json(jsonData)
  }

  next()
}

module.exports = sendJsonAndLogMiddleware
