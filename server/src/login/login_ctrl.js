// Path: login\login_ctrl.js
'use strict'

const jwt = require('jsonwebtoken')

const { db } = require('../database')

const { AppError, httpCode } = require('../utils')

const { JWT_SECRET } = require('../config')

const { authenticateUser } = require('../authentication')

const controller = {}

const signJWT = (data, secret) => {
  return new Promise((resolve, reject) => {
    jwt.sign(
      data,
      secret,
      {
        expiresIn: '1h'
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

controller.login = async (login, senha, aplicacao) => {
  const usuarioDb = await db.conn.oneOrNone(
    'SELECT id, uuid, administrador FROM dgeo.usuario WHERE login = $<login> and ativo IS TRUE',
    { login }
  )
  if (!usuarioDb) {
    throw new AppError(
      'Usuário não autorizado para utilizar o Sistema de Controle do Acervo',
      httpCode.BadRequest
    )
  }

  const verifyAuthentication = await authenticateUser(login, senha, aplicacao)
  if (!verifyAuthentication) {
    throw new AppError('Usuário ou senha inválida', httpCode.BadRequest)
  }

  const { id, uuid, administrador } = usuarioDb

  // Perfil por modulo (acervo, mapoteca, orcamento), para o client saber o que
  // exibir. A lista sai de dominio.modulo, entao modulo novo entra sozinho. O
  // token NAO carrega isso de proposito: quem decide o que a pessoa pode e o
  // verifyPerfil, lendo o banco a cada requisicao, senao rebaixar perfil so
  // valeria quando o token expirasse.
  const perfisDb = await db.conn.any(
    `SELECT m.nome_abrev AS modulo, up.perfil_id
     FROM dgeo.usuario_perfil AS up
     INNER JOIN dominio.modulo AS m ON m.code = up.modulo_id
     WHERE up.usuario_id = $<id>`,
    { id }
  )

  const perfis = {}
  perfisDb.forEach(p => {
    perfis[p.modulo] = p.perfil_id
  })

  // Catalogo dos modulos, para o client montar o seletor com o NOME de cada um
  // em vez de decorar codigo ou rotulo. Vai aqui, e nao numa rota propria,
  // porque GET /usuarios/dominio/modulo e verifyAdmin: quem so tem perfil de
  // consulta tambem precisa saber como o modulo se chama.
  const modulos = await db.conn.any(
    'SELECT code, nome, nome_abrev FROM dominio.modulo ORDER BY code'
  )

  const token = await signJWT({ id, uuid, administrador }, JWT_SECRET)

  return { token, administrador, uuid, perfis, modulos }
}

module.exports = controller
