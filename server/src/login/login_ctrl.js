'use strict'

const jwt = require('jsonwebtoken')

const { db } = require('../database')

const { AppError, httpCode } = require('../utils')

const { JWT_SECRET, JWT_EXPIRACAO } = require('../config')

const senhaUtils = require('./senha')

const controller = {}

const signJWT = (data, secret) => {
  return new Promise((resolve, reject) => {
    jwt.sign(
      data,
      secret,
      {
        expiresIn: JWT_EXPIRACAO
      },
      (err, token) => {
        if (err) {
          // `null` no lugar do status deixava `statusCode` nulo: o default do
          // AppError só vale para argumento AUSENTE, e quem salvava o 500 era o
          // `||` do errorHandler, dois arquivos adiante.
          return reject(
            new AppError(
              'Erro durante a assinatura do token',
              httpCode.InternalError,
              err
            )
          )
        }
        resolve(token)
      }
    )
  })
}

/**
 * Perfil por MODULO no formato que o client consome ({ acervo: 1, mapoteca: 2 }).
 *
 * A lista sai de dominio.modulo, entao modulo novo entra sozinho. Virou funcao
 * porque o login e a rota de sessao respondem a MESMA foto: duas copias da
 * consulta divergiriam na primeira coluna nova.
 */
const lerPerfis = async (t, usuarioId) => {
  const perfisDb = await t.any(
    `SELECT m.nome_abrev AS modulo, up.perfil_id
     FROM dgeo.usuario_perfil AS up
     INNER JOIN dominio.modulo AS m ON m.code = up.modulo_id
     WHERE up.usuario_id = $<usuarioId>`,
    { usuarioId }
  )

  const perfis = {}
  perfisDb.forEach(p => {
    perfis[p.modulo] = p.perfil_id
  })
  return perfis
}

/**
 * Catalogo dos modulos, para o client montar o seletor com o NOME de cada um em
 * vez de decorar codigo ou rotulo. Vai junto da sessao, e nao numa rota propria,
 * porque GET /usuarios/dominio/modulo e verifyAdmin: quem so tem perfil de
 * consulta tambem precisa saber como o modulo se chama.
 */
const lerModulos = async t =>
  t.any('SELECT code, nome, nome_abrev FROM dominio.modulo ORDER BY code')

/**
 * Autentica contra o próprio banco: o hash bcrypt mora em `dgeo.usuario.senha`.
 *
 * @param {string} login
 * @param {string} senha
 * @param {string} cliente - 'sca_web' ou 'sca_qgis' (o Joi já restringiu)
 */
controller.login = async (login, senha, cliente) => {
  return db.conn.tx(async t => {
    const usuarioDb = await t.oneOrNone(
      `SELECT id, uuid, administrador, senha
       FROM dgeo.usuario WHERE login = $<login> AND ativo IS TRUE`,
      { login }
    )
    if (!usuarioDb) {
      throw new AppError(
        'Usuário não autorizado para utilizar o Sistema de Controle do Acervo',
        httpCode.BadRequest
      )
    }

    // Senha nula e o estado de quem foi importado do Auth Server e ainda nao
    // teve o hash copiado por `scripts/copiar_usuarios_auth.js`. Responder
    // "usuário ou senha inválida" mandaria a pessoa tentar para sempre a senha
    // certa; a causa e administrativa, e a frase diz a quem recorrer.
    if (!usuarioDb.senha) {
      throw new AppError(
        'Usuário sem senha cadastrada no sistema. Procure um administrador.',
        httpCode.BadRequest
      )
    }

    const senhaConfere = await senhaUtils.conferir(senha, usuarioDb.senha)
    if (!senhaConfere) {
      throw new AppError('Usuário ou senha inválida', httpCode.BadRequest)
    }

    const { id, uuid, administrador } = usuarioDb

    // O token NAO carrega os perfis de proposito: quem decide o que a pessoa
    // pode e o verifyPerfil, lendo o banco a cada requisicao, senao rebaixar
    // perfil so valeria quando o token expirasse.
    const perfis = await lerPerfis(t, id)
    const modulos = await lerModulos(t)

    // O `cliente` alimenta a coluna `origem` da rastreabilidade, que separa a
    // carga em lote do plugin do trabalho feito na tela. Ele pode viajar no
    // token, ao contrário dos PERFIS, porque é imutável enquanto o token vive;
    // o perfil muda, e por isso o `verifyPerfil` o relê do banco a cada
    // requisição.
    const token = await signJWT({ id, uuid, administrador, cliente }, JWT_SECRET)

    // Historico de acesso, que alimenta a tela #/acessos. Fica DEPOIS da
    // assinatura do token e dentro da mesma transacao: gravar antes contaria
    // como acesso um login que terminasse em erro.
    await t.none(
      'INSERT INTO dgeo.login (usuario_id, cliente) VALUES ($<id>, $<cliente>)',
      { id, cliente }
    )

    return { token, administrador, uuid, perfis, modulos }
  })
}

/**
 * Perfil ATUAL de quem já está logado, sem trocar o token. O client reconfere a
 * foto no boot e sempre que leva um 403, e aí o que a tela oferece volta a bater
 * com o que o servidor aceita.
 *
 * Lê o BANCO, e nunca o próprio token: o `administrador` que viaja no token é do
 * momento do login e envelhece igual ao perfil. Usuário apagado ou inativo cai
 * em 401 de propósito, porque aí a sessão acabou mesmo e o client desloga.
 */
controller.sessao = async uuid => {
  return db.conn.task(async t => {
    const usuarioDb = await t.oneOrNone(
      'SELECT id, uuid, administrador FROM dgeo.usuario WHERE uuid = $<uuid> AND ativo IS TRUE',
      { uuid }
    )
    if (!usuarioDb) {
      throw new AppError(
        'Usuário não encontrado ou inativo',
        httpCode.Unauthorized
      )
    }

    const perfis = await lerPerfis(t, usuarioDb.id)
    const modulos = await lerModulos(t)

    return {
      administrador: usuarioDb.administrador,
      uuid: usuarioDb.uuid,
      perfis,
      modulos
    }
  })
}

/**
 * Confere a senha VIGENTE de quem ja esta logado.
 *
 * Existe para a troca de senha (`usuario_ctrl.atualizaSenhaPropria`) poder
 * exigi-la: sem isso, uma sessao esquecida aberta viraria uma conta tomada.
 * Mora aqui, e nao em usuario/, porque conferir senha e o que ESTA feature faz
 * -- assim ha um caminho unico de conferencia no sistema inteiro.
 *
 * O `executor` existe para a troca de senha poder conferir e gravar na MESMA
 * transacao. Com duas conexoes cabia outra requisicao no meio, e a segunda
 * gravaria por cima com a autorizacao da primeira. Ele e opcional e cai em
 * `db.conn` porque quem confere fora de transacao (o login) nao tem `t` nenhum.
 *
 * @param {string} uuid
 * @param {string} senha
 * @param {object} [executor] - a transacao de quem vai gravar em seguida
 */
controller.conferirSenha = async (uuid, senha, executor) => {
  const conexao = executor || db.conn
  const usuarioDb = await conexao.oneOrNone(
    'SELECT senha FROM dgeo.usuario WHERE uuid = $<uuid> AND ativo IS TRUE',
    { uuid }
  )
  if (!usuarioDb) {
    throw new AppError(
      'Usuário não encontrado ou inativo',
      httpCode.Unauthorized
    )
  }

  const confere = await senhaUtils.conferir(senha, usuarioDb.senha)
  if (!confere) {
    throw new AppError('Senha atual inválida', httpCode.BadRequest)
  }
}

module.exports = controller
