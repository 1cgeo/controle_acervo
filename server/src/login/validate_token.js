'use strict'

const jwt = require('jsonwebtoken')

const { AppError, httpCode } = require('../utils')

const { JWT_SECRET } = require('../config')

/**
 * A AUDIÊNCIA DO TOKEN: para QUE ele serve, e não só quem ele é.
 *
 * Existe desde 2026-08-09, e a razão é um vazamento real: o token de sessão
 * inteiro viajava na query string da tile (`?token=`), o middleware de log do
 * `server/app.js` gravava a URL com ele em `logs/combined.log`, e a rota
 * `/logs` publica esse arquivo sem guarda nenhuma. Quem lesse o log saía com uma
 * credencial de OITO HORAS, aceita por todas as guardas do sistema.
 *
 * A rota `/logs` continua aberta, e isso é decisão registrada. O que mudou foi a
 * CREDENCIAL que passa por ali: a tile deixou de andar com o token de sessão e
 * passou a ter um token PRÓPRIO, de vida curta, que não abre mais nada.
 *
 * A CONFERÊNCIA É CENTRALIZADA AQUI, e não distribuída pelas guardas. São seis
 * guardas (`verify_login`, `verify_login_tile`, `verify_perfil`,
 * `verify_acesso`, `verify_admin`, `verify_gerente`) e todas as seis decodificam
 * o token por esta função. Distribuir a checagem custaria seis cópias da mesma
 * frase, e a guarda nova que alguém escrevesse amanhã nasceria SEM ela -- ou
 * seja, aceitando o token de tile, que é exatamente o buraco que este arquivo
 * fecha. Aqui o default protege quem esquecer: quem não pede audiência nenhuma
 * recebe a de SESSÃO, que recusa o token de tile.
 *
 * O TOKEN JÁ EMITIDO NÃO TEM `aud`, e ele continua valendo nas guardas normais.
 * A alternativa seria exigir o claim em todo mundo, e isso deslogaria na hora do
 * deploy toda sessão aberta e todo CLI com token em cache (`~/.sca`). A regra é
 * assimétrica de propósito:
 *
 *   audiência SESSÃO  aceita o token SEM `aud` (o legado) e o `aud: 'sessao'`.
 *                     Recusa qualquer outra audiência.
 *   audiência TILE    exige `aud: 'tile'`, e ponto. Token sem `aud` NÃO serve,
 *                     senão o bearer comum continuaria abrindo a tile e o
 *                     vazamento voltaria pela mesma porta.
 *
 * O lado frouxo é o que já existia; o lado restrito é o novo. Nenhuma sessão cai
 * no deploy, e o token que sobra no log não abre nada além de tiles, por poucos
 * minutos.
 */
const AUDIENCIA = {
  SESSAO: 'sessao',
  TILE: 'tile'
}

const decodeJwt = (token, secret) => {
  return new Promise((resolve, reject) => {
    jwt.verify(token, secret, (err, decoded) => {
      if (err) {
        return reject(
          new AppError('Falha ao autenticar token', httpCode.Unauthorized, err)
        )
      }
      resolve(decoded)
    })
  })
}

/**
 * Confere a audiência do token já decodificado.
 *
 * `aud` pode chegar como ARRANJO (é o que o padrão do JWT permite), e a
 * comparação por igualdade recusa o arranjo nos dois ramos. É o lado seguro:
 * ninguém assina token aqui com `aud` composto, então arranjo é coisa que este
 * sistema não emitiu.
 */
const conferirAudiencia = (decoded, audiencia) => {
  const aud = decoded ? decoded.aud : undefined

  if (audiencia === AUDIENCIA.SESSAO) {
    // Token anterior a 2026-08-09 não tem o claim, e continua valendo.
    if (aud === undefined || aud === null || aud === AUDIENCIA.SESSAO) return

    throw new AppError(
      'Token não vale para esta rota',
      httpCode.Unauthorized
    )
  }

  if (aud !== audiencia) {
    throw new AppError(
      'Token não vale para esta rota',
      httpCode.Unauthorized
    )
  }
}

/**
 * Decodifica e confere o token, aceitando o prefixo 'Bearer '.
 *
 * O SEGUNDO ARGUMENTO É A AUDIÊNCIA QUE A GUARDA ACEITA, e o default é a de
 * SESSÃO: guarda que não disser nada recusa o token de tile, que é o
 * comportamento que se quer por omissão.
 *
 * O TOKEN QUE NÃO É STRING RESPONDE 401, E NÃO 500. `?token[]=x` faz o Express
 * entregar um ARRANJO em `req.query.token`, e até 2026-08-09 o `.startsWith`
 * logo abaixo lançava `TypeError` -- que o `asyncHandler` empurrava para o
 * errorHandler e virava 500. Uma query malformada é credencial inválida, e a
 * resposta certa para credencial inválida é 401.
 *
 * @param {string} token - o cabeçalho `Authorization` ou o `?token=` da tile
 * @param {string} [audiencia] - `AUDIENCIA.SESSAO` (default) ou `AUDIENCIA.TILE`
 * @returns {Promise<object>} o payload do JWT
 */
const validateToken = async (token, audiencia = AUDIENCIA.SESSAO) => {
  if (!token) {
    throw new AppError('Nenhum token fornecido', httpCode.Unauthorized)
  }
  if (typeof token !== 'string') {
    throw new AppError('Token em formato inválido', httpCode.Unauthorized)
  }
  if (token.startsWith('Bearer ')) {
    token = token.slice(7, token.length)
  }

  const decoded = await decodeJwt(token, JWT_SECRET)

  conferirAudiencia(decoded, audiencia)

  return decoded
}

module.exports = validateToken
module.exports.AUDIENCIA = AUDIENCIA
