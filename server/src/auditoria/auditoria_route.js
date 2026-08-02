'use strict'

const express = require('express')

const { schemaValidation, asyncHandler, httpCode, AppError } = require('../utils')

const { verifyPerfil, verifyAdmin } = require('../login')

const auditoriaCtrl = require('./auditoria_ctrl')
const { enriquecer } = require('./renderizar')
const auditoriaSchema = require('./auditoria_schema')

const verifyRastreabilidade = require('./verify_rastreabilidade')

const router = express.Router()

/**
 * A VARREDURA: `/api/auditoria?...`, a tela `#/rastreabilidade`.
 *
 * Declarada ANTES de `/:modulo/:entidade/:id` porque o Express casa na ordem, e
 * uma rota de tres segmentos nao colidiria com esta de zero -- mas a ordem
 * explicita evita a discussao no dia em que alguem acrescentar um caminho aqui.
 * E a mesma razao pela qual `PUT /perfil` vem antes de `PUT /:uuid` em usuario/.
 *
 * O recorte por modulo e do GUARDA, e nao do filtro: ver verify_rastreabilidade.js.
 */
router.get(
  '/',
  verifyRastreabilidade,
  schemaValidation({ query: auditoriaSchema.listagemQuery }),
  asyncHandler(async (req, res, next) => {
    const { modulos } = req.rastreabilidade

    const resultado = await auditoriaCtrl.listarGeral(req.query, modulos)
    const dados = await enriquecer(resultado.dados)

    const msg = 'Eventos de rastreabilidade retornados com sucesso'

    // O `pagination` sai AO LADO de `dados`, e nao dentro: e o envelope que o
    // `apiGetPaginado` e o `components/paginacao/` do cliente ja consomem.
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados, null, {
      pagination: resultado.pagination,
      // A tela precisa saber se pode oferecer o filtro de modulo. Vem do
      // servidor, e nao do `isAdmin()` do cliente, porque e o servidor que
      // decide o recorte: se os dois discordarem, quem manda e este.
      escopo: req.rastreabilidade
    })
  })
)

/**
 * As opcoes dos combos, recortadas pelo mesmo criterio.
 *
 * Rota propria porque a tela as pede UMA vez e a lista muda a cada filtro; junto
 * dos eventos, elas seriam recalculadas a cada pagina.
 */
router.get(
  '/filtros',
  verifyRastreabilidade,
  asyncHandler(async (req, res, next) => {
    const dados = await auditoriaCtrl.opcoesDeFiltro(req.rastreabilidade.modulos)

    const msg = 'Opções de filtro retornadas com sucesso'

    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

/**
 * Guarda do historico de UM registro.
 *
 * QUEM VE O HISTORICO DE UM REGISTRO E QUEM VE O REGISTRO. O historico nao mostra
 * nada que a ficha ja nao mostre: mostra QUANDO e POR QUEM. Fecha-lo num perfil
 * acima criaria o caso em que a pessoa le o valor atual e nao pode saber que ele
 * mudou ontem. E a regra que `GET /api/mapoteca/pedido/:id/auditoria` ja segue
 * desde 2026-07-30 (consulta), e aqui ela vira geral.
 *
 * 'plataforma' e a excecao, e por uma razao de conteudo: la moram os eventos de
 * usuario, de perfil e de senha, que so o administrador global ve na tela que os
 * origina (#/usuarios e verifyAdmin).
 *
 * ARMADILHA QUE ESTA REGRA EVITA: o default do `verifyPerfil` e 'acervo'. Uma
 * rota de historico que esquecesse o segundo argumento passaria a cobrar perfil
 * no ACERVO para ler o historico do orcamento, sem erro visivel. Aqui o modulo
 * vem do proprio caminho, entao o esquecimento nao tem por onde acontecer.
 */
const guardaDoHistorico = (req, res, next) => {
  const modulo = req.params.modulo

  if (modulo === 'plataforma') {
    return verifyAdmin(req, res, next)
  }
  if (modulo === 'acervo' || modulo === 'mapoteca' || modulo === 'orcamento') {
    return verifyPerfil('consulta', modulo)(req, res, next)
  }

  // O Joi tambem recusa, mas ele roda DEPOIS da guarda: sem isto, modulo
  // desconhecido cairia num `verifyPerfil` que lanca no carregamento.
  return next(new AppError('Módulo desconhecido', httpCode.BadRequest))
}

/**
 * Historico de uma ficha: `/api/auditoria/mapoteca/pedido/312`.
 *
 * Devolve os eventos do mais novo para o mais antigo, JA COM o diff renderizado
 * (`mudancas`) e o `resumo` de cada registro. O cliente nao traduz nada: ver o
 * cabecalho de `renderizar.js`.
 */
router.get(
  '/:modulo/:entidade/:id',
  guardaDoHistorico,
  schemaValidation({ params: auditoriaSchema.historicoParams }),
  asyncHandler(async (req, res, next) => {
    const { modulo, entidade, id } = req.params

    const eventos = await auditoriaCtrl.listarPorEntidade(modulo, entidade, id)
    const dados = await enriquecer(eventos)

    const msg = 'Histórico retornado com sucesso'

    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

module.exports = router
