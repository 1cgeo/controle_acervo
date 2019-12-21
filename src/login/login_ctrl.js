'use strict'

const jwt = require('jsonwebtoken')

const { db } = require('../database')

const {
  AppError,
  httpCode,
  config: { JWT_SECRET }
} = require('../utils')

const { authenticateUser } = require('../authentication')

const controller = {}

const gravaLogin = async usuarioId => {
  await db.sapConn.any(
    `
      INSERT INTO dgeo.login(usuario_id, data_login) VALUES($<usuarioId>, now())
      `,
    { usuarioId }
  )
}

const signJWT = (data, secret) => {
  return new Promise((resolve, reject) => {
    jwt.sign(
      data,
      secret,
      {
        expiresIn: '10h'
      },
      (err, token) => {
        if (err) {
          reject(new AppError('Erro durante a assinatura do token', null, err))
        }
        resolve(token)
      }
    )
  })
}

controller.login = async (usuario, senha) => {
  const usuarioDb = await db.sapConn.oneOrNone(
    'SELECT id, administrador FROM dgeo.usuario WHERE login = $<usuario> and ativo IS TRUE',
    { usuario }
  )
  if (!usuarioDb) {
    throw new AppError(
      'Usuário não autorizado para utilizar o SCA',
      httpCode.Unauthorized
    )
  }

  const verifyAuthentication = await authenticateUser(usuario, senha)
  if (!verifyAuthentication) {
    throw new AppError('Usuário ou senha inválida', httpCode.Unauthorized)
  }

  const { id, administrador } = usuarioDb

  const token = await signJWT({ id, administrador }, JWT_SECRET)

  await gravaLogin(id)

  return { token, administrador }
}

module.exports = controller
