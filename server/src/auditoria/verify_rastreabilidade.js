'use strict'

const { AppError, asyncHandler, httpCode } = require('../utils')

const { db } = require('../database')

const validateToken = require('../login/validate_token')
const { montarContexto } = require('../login/contexto')
const { colunaCarimbo, conferirCarimbo } = require('../login/carimbo_da_senha')

const { MODULOS_VALIDOS } = require('./mapa')

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

/**
 * A FRASE DE QUEM E GERENTE SO DE `pit` OU SO DE `efetivo`.
 *
 * `dominio.modulo` tem SETE `nome_abrev`, e `auditoria.evento.modulo` so recebe
 * os de `MODULOS_VALIDOS` (`mapa/index.js`), que sao seis e nao incluem esses
 * dois: o que o PIT e o efetivo gravam e auditado sob 'plataforma', que e do
 * administrador global.
 *
 * ATE 2026-09-05 ESSA GERENCIA ENTRAVA NA TELA e recebia uma tela em branco POR
 * CONSTRUCAO: a lista rodava `a.modulo IN ('pit')`, que devolve zero, e
 * `opcoesDeFiltro` devolvia quatro listas vazias pelo mesmo recorte -- e
 * `auditoria_schema.js` nem aceita `pit` como filtro manual, entao nem tentando
 * a mao a pessoa chegaria a algum lugar. A leitura natural de uma tela assim e
 * "o sistema nao registra nada" ou "esta quebrado", e as duas sao falsas.
 *
 * O 403 QUE EXPLICA E MAIS HONESTO QUE O 200 MUDO, e e a unica coisa que muda
 * aqui. Quem e gerente de `pit` E de `acervo` continua entrando, recortado ao
 * acervo: a intersecao so recusa quando ela fica VAZIA.
 */
const SEM_MODULO_AUDITADO =
  'A rastreabilidade registra os módulos acervo, mapoteca, orçamento, ' +
  'equipamento e produção. O que o PIT e o efetivo gravam fica sob ' +
  "'plataforma', que é do administrador."

const verifyRastreabilidade = asyncHandler(async (req, res, next) => {
  const decoded = await validateToken(req.headers.authorization)

  if (!('uuid' in decoded && decoded.uuid)) {
    throw new AppError('Falta informação de usuário', httpCode.Unauthorized)
  }

  const usuario = await db.conn.oneOrNone(
    `SELECT id, administrador, ${colunaCarimbo()}
     FROM dgeo.usuario WHERE uuid = $<uuid> AND ativo IS TRUE`,
    { uuid: decoded.uuid }
  )

  if (!usuario) {
    throw new AppError('Usuário não encontrado ou inativo', httpCode.Forbidden)
  }

  // A SENHA MUDOU? O `carimbo` do token é derivado do hash que valia quando ele
  // foi emitido, e a coluna acima traz o do hash de HOJE. Divergiu, a sessão
  // acabou -- é o que faz a troca de senha (e o reset pelo administrador)
  // expulsar quem já estava dentro. Token sem o claim é legado e passa; ver
  // `carimbo_da_senha.js`.
  conferirCarimbo(decoded, usuario)

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

  // A INTERSECAO COM O QUE A TRILHA REGISTRA. `MODULOS_VALIDOS` e a lista que o
  // proprio mapa de auditoria cobra de cada entrada no carregamento, entao ela
  // nao pode divergir do que `auditoria.evento.modulo` guarda -- e por isso ela
  // vem de la, e nao de uma copia daqui.
  const modulos = perfis
    .map(p => p.modulo)
    .filter(modulo => MODULOS_VALIDOS.has(modulo))

  if (!modulos.length) {
    throw new AppError(SEM_MODULO_AUDITADO, httpCode.Forbidden)
  }

  req.rastreabilidade = {
    administrador: false,
    modulos
  }

  return next()
})

module.exports = verifyRastreabilidade
