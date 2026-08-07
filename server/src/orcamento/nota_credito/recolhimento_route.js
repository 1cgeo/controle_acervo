'use strict'

const express = require('express')

const { schemaValidation, asyncHandler, httpCode } = require('../utils')

const { verifyPerfil } = require('../../login')

const recolhimentoCtrl = require('./recolhimento_ctrl')

const recolhimentoSchema = require('./recolhimento_schema')

const router = express.Router()

// O SEGUNDO ARGUMENTO de `verifyPerfil` e OBRIGATORIO aqui: o default dele e
// 'acervo', e uma rota do orcamento que o esqueca passa a cobrar perfil no
// modulo errado, sem erro visivel. O teste
// `__tests__/routes/orcamento/modulo_em_toda_rota.test.js` le este fonte e faz
// cumprir.

router.get(
  '/',
  verifyPerfil('consulta', 'orcamento'),
  schemaValidation({ query: recolhimentoSchema.listarQuery }),
  asyncHandler(async (req, res, next) => {
    const dados = await recolhimentoCtrl.listar({
      nota_credito_id: req.query.nota_credito_id,
      ano: req.query.ano
    })

    const msg = 'Recolhimentos retornados com sucesso'

    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.get(
  '/:id',
  verifyPerfil('consulta', 'orcamento'),
  schemaValidation({ params: recolhimentoSchema.idParams }),
  asyncHandler(async (req, res, next) => {
    const dados = await recolhimentoCtrl.getPorId(req.params.id)

    const msg = 'Recolhimento retornado com sucesso'

    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.post(
  '/',
  verifyPerfil('operador', 'orcamento'),
  schemaValidation({ body: recolhimentoSchema.criar }),
  asyncHandler(async (req, res, next) => {
    const dados = await recolhimentoCtrl.criar(
      req.body, req.usuarioUuid, req.contexto
    )

    const msg = 'Recolhimento criado com sucesso'

    return res.sendJsonAndLog(true, msg, httpCode.Created, dados)
  })
)

router.put(
  '/:id',
  verifyPerfil('operador', 'orcamento'),
  schemaValidation({
    body: recolhimentoSchema.atualizar,
    params: recolhimentoSchema.idParams
  }),
  asyncHandler(async (req, res, next) => {
    await recolhimentoCtrl.atualizar(
      req.params.id, req.body, req.usuarioUuid, req.contexto
    )

    const msg = 'Recolhimento atualizado com sucesso'

    return res.sendJsonAndLog(true, msg, httpCode.OK)
  })
)

router.delete(
  '/:id',
  verifyPerfil('gerente', 'orcamento'),
  schemaValidation({ params: recolhimentoSchema.idParams }),
  asyncHandler(async (req, res, next) => {
    await recolhimentoCtrl.deletar(
      req.params.id, req.usuarioUuid, req.contexto
    )

    const msg = 'Recolhimento excluido com sucesso'

    return res.sendJsonAndLog(true, msg, httpCode.OK)
  })
)

module.exports = router
