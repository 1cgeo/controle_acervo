'use strict'

const { AppError, asyncHandler, httpCode } = require('../utils')

const { db } = require('../database')

const validateToken = require('./validate_token')

const { montarContexto } = require('./contexto')

/**
 * A guarda da PROPRIA CONTA: token valido e usuario ATIVO, sem perguntar por
 * modulo nenhum.
 *
 * QUEM A USA, e sao sete rotas: `GET /login/sessao`, `GET`/`PUT
 * /usuarios/perfil`, `PUT /usuarios/perfil/senha`, `GET
 * /usuarios/dominio/tipo_posto_grad` e, desde 2026-08-09, `GET /instituicao` e
 * `POST /login/tile`. As cinco primeiras sao exatamente as rotas que a pessoa
 * SEM perfil em modulo nenhum precisa alcancar -- trocar a guarda delas por
 * `verifyAcesso` a trancaria do lado de fora da propria conta.
 *
 * A SETIMA E O TOKEN DA TILE, e ela esta aqui porque faz a MESMA pergunta que a
 * guarda da ponta (`verifyLoginTile`): token valido e conta ativa, sem modulo
 * nenhum. Exigir mais para EMITIR do que para USAR nao protegeria coisa alguma.
 *
 * A SEXTA E A UNICA QUE NAO FALA DA PESSOA, e ela cabe aqui pela mesma frase: a
 * pagina de quem ainda nao tem perfil (`#/perfil`) e o cabecalho do sistema
 * mostram DE QUEM E a instalacao, e e ali que se le a quem pedir acesso. Cobrar
 * `verifyAcesso` deixaria sem nome de Centro justamente essa tela, e o que ela
 * mostra e o nome de uma OM.
 *
 * ELA LE O BANCO A CADA REQUISICAO desde 2026-08-09, e antes nao lia: o
 * `ativo`, o `id` e o `administrador` saiam todos do TOKEN, e o token vive
 * `JWT_EXPIRACAO` (8 horas por padrao). Quem fosse desativado continuava lendo e
 * ESCREVENDO o proprio cadastro por ate oito horas depois -- o
 * `PUT /usuarios/perfil` nao filtra `ativo`, e essa era a porta.
 *
 * O CUSTO FOI MEDIDO ANTES DE DECIDIR, e e o argumento inteiro: sao CINCO rotas,
 * todas de tela de perfil e de sessao, e uma busca por `uuid`, que e UNIQUE e
 * portanto indexado. As outras quatro guardas do sistema (`verifyPerfil`,
 * `verifyAcesso`, `verifyGerente`, `verifyAdmin`) ja fazem exatamente esta
 * consulta em TODAS as rotas do SCA; esta era a unica que confiava no token, e
 * a economia que ela representava era invisivel ao lado delas. O que a
 * inconsistencia custava era pior: uma regra de seguranca que valia em 99% do
 * sistema e nao valia justamente onde se troca a senha.
 *
 * O SAP 2.3.5 JA FAZIA ASSIM, e o `verify_login.js` de la e o irmao direto
 * deste. O que dele NAO veio e o `req.query.token`: aquele fallback existe pelas
 * camadas MVT, e aqui ele mora sozinho em `verify_login_tile.js`, longe das
 * rotas que nao precisam dele.
 */
const verifyLogin = asyncHandler(async (req, res, next) => {
  const decoded = await validateToken(req.headers.authorization)

  if (!('uuid' in decoded && decoded.uuid)) {
    throw new AppError('Falta informação de usuário', httpCode.Unauthorized)
  }

  // `id` e `administrador` saem DAQUI, e nao do token, pelo mesmo motivo do
  // `ativo`: os dois envelhecem dentro do JWT. E a politica que verifyAdmin,
  // verifyPerfil, verifyAcesso e verifyGerente ja seguem.
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

  // O `cliente` DO TOKEN, e não do banco: ele diz por qual porta a pessoa entrou
  // ('sap_web', 'sap_fp', ...) e é o que alimenta a `origem` da rastreabilidade.
  // Sai daqui para o `POST /login/tile` poder copiá-lo no token curto da tile:
  // sem ele, toda tile entraria no rastro como 'desconhecido'.
  req.clienteDoToken = decoded.cliente

  // Origem, rota e lote da rastreabilidade.
  montarContexto(req, decoded)

  // A TRAVA DE `usuario_uuid` FICA, e hoje ela nao alcanca rota nenhuma: nenhuma
  // das cinco rotas desta guarda recebe esse campo. Ela e a mesma que saiu de
  // `verify_perfil.js` em 2026-08-08, e a leitura de la explica por que la ela
  // barrava o lancamento LEGITIMO do gerente pelos outros. Aqui ela nao barra
  // nada, e fica como rede para o dia em que uma rota da propria conta passar a
  // aceitar o campo.
  const requestedUuid =
    (req.params && req.params.usuario_uuid) ||
    (req.body && req.body.usuario_uuid) ||
    (req.query && req.query.usuario_uuid)

  if (requestedUuid && decoded.uuid !== requestedUuid && !usuario.administrador) {
    throw new AppError(
      'Usuário só pode acessar sua própria informação',
      httpCode.Unauthorized
    )
  }

  next()
})

module.exports = verifyLogin
