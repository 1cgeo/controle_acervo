'use strict'

const { AppError, asyncHandler, httpCode } = require('../utils')

const { db } = require('../database')

const validateToken = require('./validate_token')

const { montarContexto } = require('./contexto')

/**
 * A ÚNICA GUARDA DO SISTEMA QUE ACEITA O TOKEN NA QUERY STRING, e ela existe por
 * um motivo só: as camadas MVT.
 *
 * O QGIS e o MapLibre pedem tile por uma URL montada por eles
 * (`.../{z}/{x}/{y}.pbf`), dentro de um renderizador que NÃO deixa acrescentar
 * cabeçalho HTTP. Sem `?token=`, ou a camada de tiles fica pública, ou ela não
 * existe. Entre as duas, esta é a menos ruim -- e é o que o SAP 2.3.5 já fazia,
 * no próprio `verifyLogin` dele.
 *
 * POR QUE ELA É UM ARQUIVO SEPARADO, e não uma linha a mais no `verify_login.js`.
 * Token em query string é PIOR que token em cabeçalho, e não um pouco: ele entra
 * no log de acesso do servidor web, no histórico do navegador, no `Referer` de
 * toda requisição que a página disparar em seguida e no proxy que estiver no
 * caminho. O SAP pagava esse preço em TODAS as rotas dele, porque o `verifyLogin`
 * de lá lê `req.headers.authorization || req.query.token` e é a guarda de tudo.
 * Aqui o preço fica no punhado de rotas que não tem escolha, e
 * `__tests__/routes/login_tile_exclusivo.test.js` varre os `*_route.js` para
 * provar que ninguém mais o usa. Sem essa varredura, a porta larga vaza para o
 * resto do sistema no primeiro `require` distraído.
 *
 * O CABEÇALHO TEM PRECEDÊNCIA sobre a query: quem pode mandar cabeçalho manda,
 * e a query é o fallback.
 *
 * LÊ `ativo` DO BANCO, como os irmãos `verifyPerfil`, `verifyAcesso` e
 * `verifyGerente`: desativar uma conta tem de valer na hora, e uma camada de
 * tiles fica aberta na tela por horas com o mesmo token.
 *
 * NÃO SUBSTITUI `verifyPerfil`. Ela responde "quem é você" e "você está ativo",
 * e nada sobre módulo: rota de tile de um módulo encadeia o `verifyPerfil` dele
 * depois desta, ou usa esta sozinha só onde o dado for de plataforma.
 */
const verifyLoginTile = asyncHandler(async (req, res, next) => {
  const token = req.headers.authorization || (req.query && req.query.token)

  const decoded = await validateToken(token)

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

  // Origem, rota e lote da rastreabilidade, como nos outros guardas.
  montarContexto(req, decoded)

  next()
})

module.exports = verifyLoginTile
