'use strict'

// Aproveitamento do efetivo: quem esteve na Divisão, quando, e o que o impediu.
//
// ROTA DE PLATAFORMA, sob `/api/efetivo`, e não de módulo: o efetivo não é dado
// de acervo, de mapoteca nem de orçamento. Ela alimenta a subseção 6.1 do
// RPCMTec, mas não mora sob `/api/rpcmtec` porque "quem esteve na Divisão" não
// existe por causa do relatório -- o relatório é um leitor.
//
// GUARDA: `verifyAdmin` em tudo, inclusive na leitura. A tela mostra licença de
// saúde e função acumulada de cada militar, nominalmente, e isso é dado de
// pessoal. É a mesma régua de `/api/acessos`.

const express = require('express')

const { schemaValidation, asyncHandler, httpCode } = require('../utils')
const { verifyAdmin } = require('../login')

const efetivoCtrl = require('./efetivo_ctrl')
const efetivoSchema = require('./efetivo_schema')

const router = express.Router()

// ---------------------------------------------------------------------------
// Leitura agregada. As três saem da MESMA base por dia, agregada de três
// jeitos: o mapa por semana, o fechamento por ano e a 6.1 por mês.
// ---------------------------------------------------------------------------

router.get(
  '/mapa',
  verifyAdmin,
  schemaValidation({ query: efetivoSchema.anoObrigatorioQuery }),
  asyncHandler(async (req, res, next) => {
    const [semanas, anual] = await Promise.all([
      efetivoCtrl.mapaAnual(req.query.ano),
      efetivoCtrl.resumoAnual(req.query.ano)
    ])

    return res.sendJsonAndLog(
      true, 'Mapa do efetivo retornado com sucesso', httpCode.OK,
      { ano: Number(req.query.ano), semanas, anual }
    )
  })
)

router.get(
  '/mes',
  verifyAdmin,
  schemaValidation({ query: efetivoSchema.anoMesQuery }),
  asyncHandler(async (req, res, next) => {
    const dados = await efetivoCtrl.resumoMensal(req.query.ano, req.query.mes)

    return res.sendJsonAndLog(
      true, 'Efetivo do mês retornado com sucesso', httpCode.OK, dados
    )
  })
)

// ---------------------------------------------------------------------------
// Passagem pela DGEO
// ---------------------------------------------------------------------------

router.get(
  '/periodos',
  verifyAdmin,
  schemaValidation({ query: efetivoSchema.anoQuery }),
  asyncHandler(async (req, res, next) => {
    const dados = await efetivoCtrl.listarPeriodos(req.query.ano)

    return res.sendJsonAndLog(
      true, 'Passagens pela DGEO retornadas com sucesso', httpCode.OK, dados
    )
  })
)

router.post(
  '/periodos',
  verifyAdmin,
  schemaValidation({ body: efetivoSchema.criarPeriodo }),
  asyncHandler(async (req, res, next) => {
    const dados = await efetivoCtrl.criarPeriodo(
      req.body, req.usuarioUuid, req.contexto
    )

    return res.sendJsonAndLog(
      true, 'Passagem cadastrada com sucesso', httpCode.Created, dados
    )
  })
)

router.put(
  '/periodos/:id',
  verifyAdmin,
  schemaValidation({
    params: efetivoSchema.idParams,
    body: efetivoSchema.atualizarPeriodo
  }),
  asyncHandler(async (req, res, next) => {
    const dados = await efetivoCtrl.atualizarPeriodo(
      req.params.id, req.body, req.usuarioUuid, req.contexto
    )

    return res.sendJsonAndLog(
      true, 'Passagem atualizada com sucesso', httpCode.OK, dados
    )
  })
)

router.delete(
  '/periodos/:id',
  verifyAdmin,
  schemaValidation({ params: efetivoSchema.idParams }),
  asyncHandler(async (req, res, next) => {
    await efetivoCtrl.deletarPeriodo(req.params.id, req.usuarioUuid, req.contexto)

    return res.sendJsonAndLog(true, 'Passagem excluída com sucesso', httpCode.OK)
  })
)

// ---------------------------------------------------------------------------
// Impedimento
// ---------------------------------------------------------------------------

router.get(
  '/impedimentos',
  verifyAdmin,
  schemaValidation({ query: efetivoSchema.anoQuery }),
  asyncHandler(async (req, res, next) => {
    const dados = await efetivoCtrl.listarImpedimentos(req.query.ano)

    return res.sendJsonAndLog(
      true, 'Impedimentos retornados com sucesso', httpCode.OK, dados
    )
  })
)

router.post(
  '/impedimentos',
  verifyAdmin,
  schemaValidation({ body: efetivoSchema.criarImpedimento }),
  asyncHandler(async (req, res, next) => {
    const dados = await efetivoCtrl.criarImpedimento(
      req.body, req.usuarioUuid, req.contexto
    )

    return res.sendJsonAndLog(
      true, 'Impedimento cadastrado com sucesso', httpCode.Created, dados
    )
  })
)

router.put(
  '/impedimentos/:id',
  verifyAdmin,
  schemaValidation({
    params: efetivoSchema.idParams,
    body: efetivoSchema.atualizarImpedimento
  }),
  asyncHandler(async (req, res, next) => {
    const dados = await efetivoCtrl.atualizarImpedimento(
      req.params.id, req.body, req.usuarioUuid, req.contexto
    )

    return res.sendJsonAndLog(
      true, 'Impedimento atualizado com sucesso', httpCode.OK, dados
    )
  })
)

router.delete(
  '/impedimentos/:id',
  verifyAdmin,
  schemaValidation({ params: efetivoSchema.idParams }),
  asyncHandler(async (req, res, next) => {
    await efetivoCtrl.deletarImpedimento(req.params.id, req.usuarioUuid, req.contexto)

    return res.sendJsonAndLog(true, 'Impedimento excluído com sucesso', httpCode.OK)
  })
)

module.exports = router
