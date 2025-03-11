// Path: gerencia\gerencia_route.js
'use strict'

const express = require('express')

const { schemaValidation, asyncHandler, httpCode } = require('../utils')

const { verifyLogin, verifyAdmin } = require('../login')

const gerenciaCtrl = require('./gerencia_ctrl')
const gerenciaSchema = require('./gerencia_schema')

const router = express.Router()


router.get(
  '/dominio/tipo_posto_grad',
  asyncHandler(async (req, res, next) => {
    const dados = await gerenciaCtrl.getTipoPostoGrad()

    const msg = 'Domínio Tipo Posto Graduação retornados com sucesso'

    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.get(
  '/dominio/tipo_produto',
  asyncHandler(async (req, res, next) => {
    const dados = await gerenciaCtrl.getTipoProduto()

    const msg = 'Domínio Tipos de produto retornados com sucesso'

    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.get(
  '/dominio/tipo_escala',
  asyncHandler(async (req, res, next) => {
    const dados = await gerenciaCtrl.getTipoEscala()

    const msg = 'Domínio Tipo Escala retornado com sucesso'

    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.get(
  '/dominio/subtipo_produto',
  asyncHandler(async (req, res, next) => {
    const dados = await gerenciaCtrl.getSubtipoProduto()

    const msg = 'Domínio Subtipo de Produto retornado com sucesso'

    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.get(
  '/dominio/situacao_carregamento',
  asyncHandler(async (req, res, next) => {
    const dados = await gerenciaCtrl.getSituacaoCarregamento()

    const msg = 'Domínio Situação de carregamento retornado com sucesso'

    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.get(
  '/dominio/tipo_arquivo',
  asyncHandler(async (req, res, next) => {
    const dados = await gerenciaCtrl.getTipoArquivo()

    const msg = 'Domínio Tipo de Arquivos retornado com sucesso'

    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.get(
  '/dominio/tipo_relacionamento',
  asyncHandler(async (req, res, next) => {
    const dados = await gerenciaCtrl.getTipoRelacionamento()

    const msg = 'Domínio Tipo de Relacionamento retornado com sucesso'

    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.get(
  '/dominio/tipo_status_arquivo',
  asyncHandler(async (req, res, next) => {
    const dados = await gerenciaCtrl.getTipoStatusArquivo()

    const msg = 'Domínio Tipo de Status do Arquivo retornado com sucesso'

    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.get(
  '/dominio/tipo_versao',
  asyncHandler(async (req, res, next) => {
    const dados = await gerenciaCtrl.getTipoVersao()

    const msg = 'Domínio Tipo de Versão retornado com sucesso'

    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.get(
  '/dominio/tipo_status_execucao',
  asyncHandler(async (req, res, next) => {
    const dados = await gerenciaCtrl.getTipoStatusExecucao()

    const msg = 'Domínio Tipo de Status de Execução retornado com sucesso'

    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.get(
  '/arquivos_deletados',
  verifyAdmin,
  asyncHandler(async (req, res, next) => {
    const dados = await gerenciaCtrl.getArquivosDeletados()

    const msg = 'Arquivos deletados retornados com sucesso'

    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.post(
  '/verificar_inconsistencias',
  verifyAdmin,
  asyncHandler(async (req, res, next) => {
    const resultados = await gerenciaCtrl.verificarConsistencia()

    const msg = 'Verificação de consistência concluída com sucesso'

    return res.sendJsonAndLog(true, msg, httpCode.OK, resultados)
  })
)

router.get(
  '/arquivos_incorretos',
  verifyAdmin,
  asyncHandler(async (req, res, next) => {
    const arquivosIncorretos = await gerenciaCtrl.getArquivosIncorretos()

    const msg = 'Arquivos incorretos recuperados com sucesso'

    return res.sendJsonAndLog(true, msg, httpCode.OK, arquivosIncorretos)
  })
)

module.exports = router
