'use strict'

const logger = require('./logger')
const httpCode = require('./http_code')
const { VERSION } = require('../config')
const redigirTokenDaUrl = require('../login/redigir_token_da_url')

// O LOG DE RESPOSTA NÃO CARREGA O CORPO DA REQUISIÇÃO, e a ausência é a
// decisão -- não é esquecimento nem defeito.
//
// Até 2026-09-05 este arquivo tinha uma função `truncate(req.body)` que redigia
// as chaves de senha, cortava as strings em 500 caracteres e era passada ao
// logger no campo `information`. Ela nunca chegou a logar nada (caía no fim sem
// `return`, então `information` saía `undefined` em toda linha), e o conserto
// óbvio -- devolver a cópia -- é que era o defeito: `logs/combined.log` é
// publicado por `GET /logs` SEM autenticação, por decisão registrada em
// `docs/decisoes.md`. Com o `return`, o corpo de TODA escrita do sistema ficaria
// legível naquela rota anônima: número de NUP, nome de OM, o texto do motivo de
// auditoria, o endereço de entrega da mapoteca. Redigir `senha`, `senha_atual` e
// `senha_nova` não cobria nada disso.
//
// Então o parâmetro saiu inteiro, e não há o que redigir porque não há o que
// logar. Quem precisar depurar "o que o cliente mandou" faz isso no ambiente de
// desenvolvimento, e não no log que o mundo lê. Devolver o corpo ao log só faz
// sentido junto de FECHAR o `/logs`, e as duas coisas andam no mesmo commit.
//
// O que continua no log: a mensagem, a URL (com o `token=` redigido), o status,
// o `success` e o erro. Nada vindo do corpo.

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
