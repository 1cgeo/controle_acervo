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
      error: error ? (error.message || String(error)) : null,
      ...metadata
    }

    // Campo com nome errado é descartado pelo schemaValidation (stripUnknown).
    // Sem este aviso o cliente recebe 200 e acredita ter gravado algo que o
    // servidor nunca viu. O aviso só aparece quando houve descarte, então não
    // muda o envelope de nenhuma resposta correta.
    if (req.camposDescartados && req.camposDescartados.length > 0) {
      jsonData.avisos = [
        `Campos ignorados por não existirem no contrato desta rota: ${req.camposDescartados.join(', ')}. Esses valores NÃO foram gravados; confira o nome do campo.`
      ]
    }

    return res.status(status).json(jsonData)
  }

  next()
}

module.exports = sendJsonAndLogMiddleware
