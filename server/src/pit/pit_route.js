'use strict'

const express = require('express')

const { asyncHandler, httpCode, AppError } = require('../utils')

// Validacao ESTRITA, e nao a padrao da plataforma: chave desconhecida no corpo
// vira 400 com sugestao, em vez de sumir no stripUnknown. E o contrato que esta
// rota ja tinha quando morava no modulo orcamento, e a escrita aqui vem de CLI e
// de carga, onde um nome de campo errado descartado em silencio grava meia meta.
const schemaValidation = require('../utils/schema_validation_estrito')

const { verifyLogin, verifyAdmin } = require('../login')

const pitCtrl = require('./pit_ctrl')

const pitSchema = require('./pit_schema')

const router = express.Router()

// Metas do PIT: rota de PLATAFORMA, sem prefixo de modulo, como /usuarios.
//
// LER e de qualquer pessoa logada (verifyLogin), e nao de um perfil no
// orcamento. Todo modulo precisa oferecer a lista: o orcamento amarra a NC e o
// item do PDR a meta que financiam, e a mapoteca amarra o pedido de impressao a
// meta que ele cumpre. Exigir perfil no orcamento deixava a mapoteca de fora, e
// foi por isso que o pedido guardou o codigo da meta como texto livre ate
// 2026-07-31.
//
// ESCREVER e do administrador global (verifyAdmin). O PIT muda uma vez por ano,
// vem de documento assinado, e errar nele contamina os tres modulos. Decisao do
// chefe, 2026-07-31.

router.get(
  '/',
  verifyLogin,
  schemaValidation({ query: pitSchema.listarQuery }),
  asyncHandler(async (req, res, next) => {
    const dados = await pitCtrl.listar(req.query.ano)

    return res.sendJsonAndLog(true, 'Metas do PIT retornadas com sucesso', httpCode.OK, dados)
  })
)

// Antes de '/:id', senao 'anos' cai na rota do id e reprova na validacao.
router.get(
  '/anos',
  verifyLogin,
  asyncHandler(async (req, res, next) => {
    const dados = await pitCtrl.anos()

    return res.sendJsonAndLog(true, 'Anos com meta cadastrada retornados com sucesso', httpCode.OK, dados)
  })
)

router.get(
  '/:id',
  verifyLogin,
  schemaValidation({ params: pitSchema.idParams }),
  asyncHandler(async (req, res, next) => {
    const dados = await pitCtrl.getPorId(req.params.id)

    if (!dados) {
      throw new AppError('Meta do PIT não encontrada', httpCode.NotFound)
    }

    return res.sendJsonAndLog(true, 'Meta do PIT retornada com sucesso', httpCode.OK, dados)
  })
)

router.post(
  '/',
  verifyAdmin,
  schemaValidation({ body: pitSchema.criar }),
  asyncHandler(async (req, res, next) => {
    const dados = await pitCtrl.criar(req.body, req.usuarioUuid, req.contexto)

    return res.sendJsonAndLog(true, 'Meta do PIT criada com sucesso', httpCode.Created, dados)
  })
)

router.put(
  '/:id',
  verifyAdmin,
  schemaValidation({
    params: pitSchema.idParams,
    body: pitSchema.atualizar
  }),
  asyncHandler(async (req, res, next) => {
    const dados = await pitCtrl.atualizar(
      req.params.id, req.body, req.usuarioUuid, req.contexto
    )

    return res.sendJsonAndLog(true, 'Meta do PIT atualizada com sucesso', httpCode.OK, dados)
  })
)

router.delete(
  '/:id',
  verifyAdmin,
  schemaValidation({ params: pitSchema.idParams }),
  asyncHandler(async (req, res, next) => {
    await pitCtrl.deletar(req.params.id, req.usuarioUuid, req.contexto)

    return res.sendJsonAndLog(true, 'Meta do PIT excluída com sucesso', httpCode.OK)
  })
)

module.exports = router
