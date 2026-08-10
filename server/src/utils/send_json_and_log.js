'use strict'

const logger = require('./logger')
const httpCode = require('./http_code')
const { VERSION } = require('../config')
const redigirTokenDaUrl = require('../login/redigir_token_da_url')

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
    // REDIGIDA, e pelo mesmo motivo do middleware de `server/app.js`: o
    // `combined.log` sai por `/logs`, que não tem autenticação por decisão
    // registrada, e `req.originalUrl` traz a query. Este é o SEGUNDO caminho do
    // vazamento, e é o que passa despercebido: a requisição de tile que FALHA
    // (401, 403) responde pelo `errorHandler`, que responde por aqui, e gravaria
    // a query inteira. Redigir num ponto só não bastava.
    const url = redigirTokenDaUrl(
      req.protocol + '://' + req.get('host') + req.originalUrl
    )

    logger.info(message, {
      url,
      information: truncate(req.body),
      status,
      success,
      error
    })

    // O 500 esconde a causa DO CLIENTE, e o campo `error` tem de acompanhar a
    // mensagem. Sem isto a máscara não valia nada: o `errorHandler` entrega aqui
    // o erro já serializado, e a frase crua do PostgreSQL (nome de tabela, texto
    // da consulta) saía no envelope ao lado de "Erro no servidor". O trace
    // inteiro continua indo para o log do servidor, na chamada acima.
    const interno = status === httpCode.InternalError
    const userMessage = interno ? 'Erro no servidor' : message
    const jsonData = {
      version: VERSION,
      success: success,
      message: userMessage,
      dados,
      error: interno || !error ? null : (error.message || String(error)),
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
