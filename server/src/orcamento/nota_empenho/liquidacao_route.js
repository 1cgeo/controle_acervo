'use strict'

const express = require('express')

const { schemaValidation, asyncHandler, httpCode } = require('../utils')

const { verifyPerfil } = require('../../login')

const liquidacaoCtrl = require('./liquidacao_ctrl')

const liquidacaoSchema = require('./liquidacao_schema')

const router = express.Router()

router.get(
  '/',
  verifyPerfil('consulta', 'orcamento'),
  schemaValidation({ query: liquidacaoSchema.listarQuery }),
  asyncHandler(async (req, res, next) => {
    const dados = await liquidacaoCtrl.listar({
      nota_empenho_id: req.query.nota_empenho_id
    })

    const msg = 'Liquidacoes retornadas com sucesso'

    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.get(
  '/:id',
  verifyPerfil('consulta', 'orcamento'),
  schemaValidation({ params: liquidacaoSchema.idParams }),
  asyncHandler(async (req, res, next) => {
    const dados = await liquidacaoCtrl.getPorId(req.params.id)

    const msg = 'Liquidacao retornada com sucesso'

    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.post(
  '/',
  verifyPerfil('operador', 'orcamento'),
  schemaValidation({ body: liquidacaoSchema.criar }),
  asyncHandler(async (req, res, next) => {
    const dados = await liquidacaoCtrl.criar(req.body, req.usuarioUuid, req.contexto)

    const msg = 'Liquidacao criada com sucesso'

    return res.sendJsonAndLog(true, msg, httpCode.Created, dados)
  })
)

router.put(
  '/:id',
  verifyPerfil('operador', 'orcamento'),
  schemaValidation({
    body: liquidacaoSchema.atualizar,
    params: liquidacaoSchema.idParams
  }),
  asyncHandler(async (req, res, next) => {
    await liquidacaoCtrl.atualizar(req.params.id, req.body, req.usuarioUuid, req.contexto)

    const msg = 'Liquidacao atualizada com sucesso'

    return res.sendJsonAndLog(true, msg, httpCode.OK)
  })
)

router.delete(
  '/:id',
  verifyPerfil('gerente', 'orcamento'),
  schemaValidation({ params: liquidacaoSchema.idParams }),
  asyncHandler(async (req, res, next) => {
    await liquidacaoCtrl.deletar(req.params.id, req.usuarioUuid, req.contexto)

    const msg = 'Liquidacao excluida com sucesso'

    return res.sendJsonAndLog(true, msg, httpCode.OK)
  })
)

module.exports = router
