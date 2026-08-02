'use strict'

const express = require('express')

const { schemaValidation, asyncHandler, httpCode } = require('../utils')

const { verifyPerfil } = require('../../login')

const rpnpCtrl = require('./rpnp_ctrl')

const rpnpSchema = require('./rpnp_schema')

const router = express.Router()

router.get(
  '/',
  verifyPerfil('consulta', 'orcamento'),
  schemaValidation({ query: rpnpSchema.listarQuery }),
  asyncHandler(async (req, res, next) => {
    const dados = await rpnpCtrl.listar({
      ano: req.query.ano
    })

    const msg = 'RPNP retornados com sucesso'

    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.get(
  '/:id',
  verifyPerfil('consulta', 'orcamento'),
  schemaValidation({ params: rpnpSchema.idParams }),
  asyncHandler(async (req, res, next) => {
    const dados = await rpnpCtrl.getPorId(req.params.id)

    const msg = 'RPNP retornado com sucesso'

    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.post(
  '/',
  verifyPerfil('operador', 'orcamento'),
  schemaValidation({ body: rpnpSchema.criar }),
  asyncHandler(async (req, res, next) => {
    const dados = await rpnpCtrl.criar(req.body, req.usuarioUuid, req.contexto)

    const msg = 'RPNP criado com sucesso'

    return res.sendJsonAndLog(true, msg, httpCode.Created, dados)
  })
)

router.put(
  '/:id',
  verifyPerfil('operador', 'orcamento'),
  schemaValidation({
    body: rpnpSchema.atualizar,
    params: rpnpSchema.idParams
  }),
  asyncHandler(async (req, res, next) => {
    await rpnpCtrl.atualizar(req.params.id, req.body, req.usuarioUuid, req.contexto)

    const msg = 'RPNP atualizado com sucesso'

    return res.sendJsonAndLog(true, msg, httpCode.OK)
  })
)

router.delete(
  '/:id',
  verifyPerfil('gerente', 'orcamento'),
  schemaValidation({ params: rpnpSchema.idParams }),
  asyncHandler(async (req, res, next) => {
    await rpnpCtrl.deletar(req.params.id, req.usuarioUuid, req.contexto)

    const msg = 'RPNP excluido com sucesso'

    return res.sendJsonAndLog(true, msg, httpCode.OK)
  })
)

module.exports = router
