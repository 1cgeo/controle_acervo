// Path: orcamento\pdr\pdr_route.js
'use strict'

// O PDR e o conjunto dos seus itens (amarrados no ano). Esta feature e um CRUD
// de itens do PDR; os totais (solicitado/autorizado por GND) sao calculados a
// partir deles no client. Perfil por modulo: ler e 'consulta', escrever e
// apagar e 'gerente', porque o PDR e o planejamento aprovado do ano e nao
// lancamento de rotina.

const express = require('express')

const { schemaValidation, asyncHandler, httpCode } = require('../utils')

const { verifyPerfil } = require('../../login')

const pdrCtrl = require('./pdr_ctrl')
const pdrSchema = require('./pdr_schema')

const router = express.Router()

router.get(
  '/',
  verifyPerfil('consulta', 'orcamento'),
  schemaValidation({ query: pdrSchema.listarQuery }),
  asyncHandler(async (req, res, next) => {
    const dados = await pdrCtrl.listar(req.query.ano)
    return res.sendJsonAndLog(true, 'Itens do PDR retornados com sucesso', httpCode.OK, dados)
  })
)

router.get(
  '/:id',
  verifyPerfil('consulta', 'orcamento'),
  schemaValidation({ params: pdrSchema.idParams }),
  asyncHandler(async (req, res, next) => {
    const dados = await pdrCtrl.getPorId(req.params.id)
    return res.sendJsonAndLog(true, 'Item do PDR retornado com sucesso', httpCode.OK, dados)
  })
)

router.post(
  '/',
  verifyPerfil('gerente', 'orcamento'),
  schemaValidation({ body: pdrSchema.criar }),
  asyncHandler(async (req, res, next) => {
    const dados = await pdrCtrl.criar(req.body, req.usuarioUuid)
    return res.sendJsonAndLog(true, 'Item do PDR criado com sucesso', httpCode.Created, dados)
  })
)

router.put(
  '/:id',
  verifyPerfil('gerente', 'orcamento'),
  schemaValidation({ params: pdrSchema.idParams, body: pdrSchema.atualizar }),
  asyncHandler(async (req, res, next) => {
    await pdrCtrl.atualizar(req.params.id, req.body, req.usuarioUuid)
    return res.sendJsonAndLog(true, 'Item do PDR atualizado com sucesso', httpCode.OK)
  })
)

router.delete(
  '/:id',
  verifyPerfil('gerente', 'orcamento'),
  schemaValidation({ params: pdrSchema.idParams }),
  asyncHandler(async (req, res, next) => {
    await pdrCtrl.deletar(req.params.id)
    return res.sendJsonAndLog(true, 'Item do PDR excluído com sucesso', httpCode.OK)
  })
)

module.exports = router
