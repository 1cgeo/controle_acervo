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
 * existe.
 *
 * ELA EXIGE UM TOKEN DE AUDIÊNCIA `tile`, desde 2026-08-09, e o bearer comum da
 * sessão NÃO serve mais aqui. Essa é a mudança inteira, e o motivo dela é o
 * caminho completo que a credencial percorria:
 *
 *   1. o client punha o token de SESSÃO na URL da tile (8 horas de vida, aceito
 *      por todas as guardas);
 *   2. o middleware de log do `server/app.js` grava `req.originalUrl`, ou seja a
 *      URL COM a query string, em `logs/combined.log`;
 *   3. a rota `/logs` publica os últimos três dias desse arquivo, sem guarda
 *      nenhuma.
 *
 * Somando os três, uma credencial completa ficava legível a quem abrisse
 * `/logs`. O `/logs` CONTINUA ABERTO, e isso é decisão registrada em
 * `docs/decisoes.md`; o que se tirou de circulação foi a credencial. Hoje o
 * `app.js` ainda redige o valor (`token=[REDIGIDO]`, ver
 * `login/redigir_token_da_url.js`), mas as duas defesas são independentes de
 * propósito: a redação vale para o log DESTE serviço, e não alcança o log de
 * acesso do servidor web, o histórico do navegador, o `Referer` nem o proxy do
 * caminho -- que continuam vendo a URL inteira. Só o escopo curto alcança todos
 * eles.
 *
 * O QUE O TOKEN DE TILE ABRE, e é todo o ganho: só esta guarda. Ele sai de
 * `POST /api/login/tile` (ver `login_ctrl.tokenDeTile`), vive minutos em vez de
 * horas, e `validate_token.js` faz as outras cinco guardas o RECUSAREM. Um token
 * que sobre num log agora compra tiles de recorte de folha por alguns minutos, e
 * nada mais.
 *
 * POR QUE ELA É UM ARQUIVO SEPARADO, e não uma linha a mais no `verify_login.js`.
 * Mesmo com escopo curto, token em query string é pior que token em cabeçalho, e
 * o preço tem de ficar onde não há escolha. O SAP 2.3.5 pagava esse preço em
 * TODAS as rotas dele, porque o `verifyLogin` de lá lê
 * `req.headers.authorization || req.query.token` e é a guarda de tudo. Aqui ele
 * fica no punhado de rotas que não tem escolha, e
 * `__tests__/routes/login_tile_exclusivo.test.js` varre os `*_route.js` para
 * provar que ninguém mais o usa. Sem essa varredura, a porta larga vaza para o
 * resto do sistema no primeiro `require` distraído.
 *
 * O CABEÇALHO TEM PRECEDÊNCIA sobre a query: quem pode mandar cabeçalho manda,
 * e a query é o fallback. Nos dois canais a audiência cobrada é a mesma: o
 * cabeçalho não é uma porta mais confiável, é só um lugar melhor de guardar.
 *
 * LÊ `ativo` DO BANCO, como os irmãos `verifyPerfil`, `verifyAcesso` e
 * `verifyGerente`: desativar uma conta tem de valer na hora, e uma camada de
 * tiles fica aberta na tela por horas -- renovando o token curto a cada vez que
 * ele vence.
 *
 * NÃO SUBSTITUI `verifyPerfil`. Ela responde "quem é você" e "você está ativo",
 * e nada sobre módulo: rota de tile de um módulo encadeia o `verifyPerfil` dele
 * depois desta, ou usa esta sozinha só onde o dado for de plataforma.
 */
const verifyLoginTile = asyncHandler(async (req, res, next) => {
  const token = req.headers.authorization || (req.query && req.query.token)

  // `?token[]=x` chega como ARRANJO, e quem responde 401 a isso é o
  // `validateToken`: antes de 2026-08-09 o `.startsWith` de lá lançava
  // TypeError, e uma query malformada virava 500.
  const decoded = await validateToken(token, validateToken.AUDIENCIA.TILE)

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
