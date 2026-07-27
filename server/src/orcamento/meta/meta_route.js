// Path: orcamento\meta\meta_route.js
'use strict'

const express = require('express')

const { schemaValidation, asyncHandler, httpCode, AppError } = require('../utils')

const { verifyPerfil } = require('../../login')

const metaCtrl = require('./meta_ctrl')

const metaSchema = require('./meta_schema')

const router = express.Router()

router.get(
  '/',
  verifyPerfil('consulta', 'orcamento'),
  schemaValidation({ query: metaSchema.listarQuery }),
  asyncHandler(async (req, res, next) => {
    const dados = await metaCtrl.listar(req.query.ano)

    return res.sendJsonAndLog(true, 'Metas do PIT retornadas com sucesso', httpCode.OK, dados)
  })
)

router.get(
  '/:id',
  verifyPerfil('consulta', 'orcamento'),
  schemaValidation({ params: metaSchema.idParams }),
  asyncHandler(async (req, res, next) => {
    const dados = await metaCtrl.getPorId(req.params.id)

    if (!dados) {
      throw new AppError('Meta do PIT não encontrada', httpCode.NotFound)
    }

    return res.sendJsonAndLog(true, 'Meta do PIT retornada com sucesso', httpCode.OK, dados)
  })
)

router.post(
  '/',
  verifyPerfil('operador', 'orcamento'),
  schemaValidation({ body: metaSchema.criar }),
  asyncHandler(async (req, res, next) => {
    const dados = await metaCtrl.criar(req.body, req.usuarioUuid)

    return res.sendJsonAndLog(true, 'Meta do PIT criada com sucesso', httpCode.Created, dados)
  })
)

router.put(
  '/:id',
  verifyPerfil('operador', 'orcamento'),
  schemaValidation({
    params: metaSchema.idParams,
    body: metaSchema.atualizar
  }),
  asyncHandler(async (req, res, next) => {
    const dados = await metaCtrl.atualizar(req.params.id, req.body, req.usuarioUuid)

    return res.sendJsonAndLog(true, 'Meta do PIT atualizada com sucesso', httpCode.OK, dados)
  })
)

router.delete(
  '/:id',
  verifyPerfil('gerente', 'orcamento'),
  schemaValidation({ params: metaSchema.idParams }),
  asyncHandler(async (req, res, next) => {
    await metaCtrl.deletar(req.params.id)

    return res.sendJsonAndLog(true, 'Meta do PIT excluída com sucesso', httpCode.OK)
  })
)

module.exports = router
