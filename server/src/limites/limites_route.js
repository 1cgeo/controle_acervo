// Path: limites\limites_route.js
'use strict'

const express = require('express')

const { asyncHandler, httpCode, schemaValidation } = require('../utils')

const { verifyPerfil } = require('../login')

const limitesCtrl = require('./limites_ctrl')
const limitesSchema = require('./limites_schema')

const router = express.Router()

/**
 * Contorno de um estado ou municipio, para a tela DESTACAR o lugar filtrado e
 * dar zoom nele (chefe, 2026-07-29).
 *
 * Rota propria, e nao mais um endpoint do acervo ou do ponto de controle: o
 * schema `limites` e dado de REFERENCIA, que os dois consultam e nenhum e dono.
 * Pendurada em um deles, a outra tela teria de chamar a rota do vizinho.
 *
 * Perfil de consulta do ACERVO, o mesmo das duas telas que a usam. Nao ha o que
 * proteger a mais aqui: e a malha do IBGE, publica.
 */
router.get(
  '/:tipo/:id',
  verifyPerfil('consulta', 'acervo'),
  schemaValidation({ params: limitesSchema.limiteParams }),
  asyncHandler(async (req, res, next) => {
    const dados = await limitesCtrl.getLimite(
      req.params.tipo,
      Number(req.params.id)
    )
    const msg = 'Limite retornado com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

module.exports = router
