'use strict'

const { AppError, asyncHandler, httpCode } = require('../utils')

const { db } = require('../database')

const validateToken = require('../login/validate_token')
const { montarContexto } = require('../login/contexto')

/**
 * Guarda da tela de RASTREABILIDADE, que nao e nenhum dos tres que ja existem.
 *
 * POR QUE NAO `verifyPerfil`. Ele le o perfil de UM modulo por vez -- o
 * `moduloId` entra na consulta (verify_perfil.js:55) --, e esta tela mistura os
 * tres numa pagina so. Precisaria de tres guardas encadeados, e o resultado
 * ainda seria "passa se tiver perfil em algum", que nao e a pergunta: a pergunta
 * e QUAIS modulos a pessoa pode ver.
 *
 * POR QUE NAO `verifyLogin`. Ele le `administrador` do TOKEN
 * (verify_login.js:17), que envelhece por ate 8 horas (JWT_EXPIRACAO). Rebaixar
 * alguem nao tiraria a tela dele hoje, e esta e a tela que mostra quem promoveu
 * quem: e a ultima em que faz sentido confiar numa foto velha.
 *
 * O QUE ELE FAZ. Le `dgeo.usuario` e TODAS as linhas de `dgeo.usuario_perfil` do
 * BANCO, na requisicao, e devolve o RECORTE em `req.rastreabilidade`:
 *
 *   { administrador: true,  modulos: null }        ve tudo
 *   { administrador: false, modulos: ['mapoteca'] } ve so a mapoteca
 *
 * `modulos: null` quer dizer "sem recorte", e nao "nenhum modulo": os dois se
 * confundiriam num array vazio, e o array vazio e justamente quem NAO entra.
 *
 * O RECORTE E DO SERVIDOR, e nao do combo da tela. Recorte de cliente e
 * sugestao: a rota devolveria os outros modulos a quem soubesse chama-la.
 *
 * QUEM ENTRA. Administrador global (tudo) e GERENTE de algum modulo (o modulo
 * dele). Operador e consulta nao entram: para eles a tela seria uma varredura do
 * modulo inteiro, e o recorte natural do trabalho deles e o historico das fichas
 * que ja leem, que segue aberto pela outra rota.
 */

// 3 = gerente, em dominio.tipo_perfil. A tela de varredura e de quem responde
// pelo modulo, e nao de quem opera nele.
const PERFIL_GERENTE = 3

const verifyRastreabilidade = asyncHandler(async (req, res, next) => {
  const decoded = await validateToken(req.headers.authorization)

  if (!('uuid' in decoded && decoded.uuid)) {
    throw new AppError('Falta informação de usuário', httpCode.Unauthorized)
  }

  const usuario = await db.conn.oneOrNone(
    'SELECT id, administrador FROM dgeo.usuario WHERE uuid = $<uuid> AND ativo IS TRUE',
    { uuid: decoded.uuid }
  )

  if (!usuario) {
    throw new AppError('Usuário não encontrado ou inativo', httpCode.Forbidden)
  }

  req.usuarioUuid = decoded.uuid
  req.usuarioId = usuario.id
  req.administrador = usuario.administrador
  montarContexto(req, decoded)

  if (usuario.administrador) {
    // Administrador global ve tudo, inclusive 'plataforma', que e onde moram os
    // eventos de usuario, de perfil e de senha.
    req.rastreabilidade = { administrador: true, modulos: null }
    return next()
  }

  const perfis = await db.conn.any(
    `SELECT m.nome_abrev AS modulo
       FROM dgeo.usuario_perfil AS up
       INNER JOIN dominio.modulo AS m ON m.code = up.modulo_id
      WHERE up.usuario_id = $<usuarioId> AND up.perfil_id >= $<gerente>`,
    { usuarioId: usuario.id, gerente: PERFIL_GERENTE }
  )

  if (!perfis.length) {
    throw new AppError(
      'Esta tela é do administrador global e dos gerentes de módulo.',
      httpCode.Forbidden
    )
  }

  req.rastreabilidade = {
    administrador: false,
    modulos: perfis.map(p => p.modulo)
  }

  return next()
})

module.exports = verifyRastreabilidade
