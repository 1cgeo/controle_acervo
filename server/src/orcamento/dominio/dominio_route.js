'use strict'

// Rotas de dominio. Os GET populam selects no client e passaram a exigir perfil
// de consulta (antes eram publicos, sem guarda nenhuma). O CRUD de natureza de
// despesa, plano interno e UG e do administrador da plataforma (pagina
// Configuracao), nao do modulo.

const express = require('express')

const { schemaValidation, asyncHandler, httpCode } = require('../utils')

const { verifyAdmin, verifyPerfil } = require('../../login')

const dominioCtrl = require('./dominio_ctrl')
const dominioSchema = require('./dominio_schema')

const router = express.Router()

router.get(
  '/tipo_posto_grad',
  verifyPerfil('consulta', 'orcamento'),
  asyncHandler(async (req, res, next) => {
    const dados = await dominioCtrl.getTipoPostoGrad()
    return res.sendJsonAndLog(true, 'Domínio Tipo Posto Graduação retornado com sucesso', httpCode.OK, dados)
  })
)

router.get(
  '/natureza_despesa',
  verifyPerfil('consulta', 'orcamento'),
  asyncHandler(async (req, res, next) => {
    const dados = await dominioCtrl.getNaturezaDespesa()
    return res.sendJsonAndLog(true, 'Domínio Natureza de Despesa retornado com sucesso', httpCode.OK, dados)
  })
)

router.get(
  '/plano_interno',
  verifyPerfil('consulta', 'orcamento'),
  asyncHandler(async (req, res, next) => {
    const dados = await dominioCtrl.getPlanoInterno()
    return res.sendJsonAndLog(true, 'Domínio Plano Interno retornado com sucesso', httpCode.OK, dados)
  })
)

router.get(
  '/ug',
  verifyPerfil('consulta', 'orcamento'),
  asyncHandler(async (req, res, next) => {
    const dados = await dominioCtrl.getUg()
    return res.sendJsonAndLog(true, 'Domínio Unidade Gestora retornado com sucesso', httpCode.OK, dados)
  })
)

router.get(
  '/tipo_licitacao',
  verifyPerfil('consulta', 'orcamento'),
  asyncHandler(async (req, res, next) => {
    const dados = await dominioCtrl.getTipoLicitacao()
    return res.sendJsonAndLog(true, 'Domínio Tipo de Licitação retornado com sucesso', httpCode.OK, dados)
  })
)

router.get(
  '/classificacao_nc',
  verifyPerfil('consulta', 'orcamento'),
  asyncHandler(async (req, res, next) => {
    const dados = await dominioCtrl.getClassificacaoNc()
    return res.sendJsonAndLog(true, 'Domínio Classificação da NC retornado com sucesso', httpCode.OK, dados)
  })
)

router.get(
  '/tipo_item_dfd',
  verifyPerfil('consulta', 'orcamento'),
  asyncHandler(async (req, res, next) => {
    const dados = await dominioCtrl.getTipoItemDfd()
    return res.sendJsonAndLog(true, 'Domínio Tipo de Item do DFD retornado com sucesso', httpCode.OK, dados)
  })
)

router.get(
  '/grau_prioridade',
  verifyPerfil('consulta', 'orcamento'),
  asyncHandler(async (req, res, next) => {
    const dados = await dominioCtrl.getGrauPrioridade()
    return res.sendJsonAndLog(true, 'Domínio Grau de Prioridade retornado com sucesso', httpCode.OK, dados)
  })
)

// ---------------------------------------------------------------------------
// CRUD admin: natureza de despesa
// ---------------------------------------------------------------------------

router.post(
  '/natureza_despesa',
  verifyAdmin,
  schemaValidation({ body: dominioSchema.naturezaDespesaCriar }),
  asyncHandler(async (req, res, next) => {
    await dominioCtrl.criarNaturezaDespesa(req.body, req.usuarioUuid, req.contexto)
    return res.sendJsonAndLog(true, 'Natureza de despesa criada com sucesso', httpCode.Created)
  })
)

router.put(
  '/natureza_despesa/:code',
  verifyAdmin,
  schemaValidation({ params: dominioSchema.codeParams, body: dominioSchema.naturezaDespesaAtualizar }),
  asyncHandler(async (req, res, next) => {
    await dominioCtrl.atualizarNaturezaDespesa(req.params.code, req.body, req.usuarioUuid, req.contexto)
    return res.sendJsonAndLog(true, 'Natureza de despesa atualizada com sucesso', httpCode.OK)
  })
)

router.delete(
  '/natureza_despesa/:code',
  verifyAdmin,
  schemaValidation({ params: dominioSchema.codeParams }),
  asyncHandler(async (req, res, next) => {
    await dominioCtrl.deletarNaturezaDespesa(req.params.code, req.usuarioUuid, req.contexto)
    return res.sendJsonAndLog(true, 'Natureza de despesa excluída com sucesso', httpCode.OK)
  })
)

// ---------------------------------------------------------------------------
// CRUD admin: plano interno
// ---------------------------------------------------------------------------

router.post(
  '/plano_interno',
  verifyAdmin,
  schemaValidation({ body: dominioSchema.planoInternoCriar }),
  asyncHandler(async (req, res, next) => {
    await dominioCtrl.criarPlanoInterno(req.body, req.usuarioUuid, req.contexto)
    return res.sendJsonAndLog(true, 'Plano interno criado com sucesso', httpCode.Created)
  })
)

router.put(
  '/plano_interno/:code',
  verifyAdmin,
  schemaValidation({ params: dominioSchema.codeParams, body: dominioSchema.planoInternoAtualizar }),
  asyncHandler(async (req, res, next) => {
    await dominioCtrl.atualizarPlanoInterno(req.params.code, req.body, req.usuarioUuid, req.contexto)
    return res.sendJsonAndLog(true, 'Plano interno atualizado com sucesso', httpCode.OK)
  })
)

router.delete(
  '/plano_interno/:code',
  verifyAdmin,
  schemaValidation({ params: dominioSchema.codeParams }),
  asyncHandler(async (req, res, next) => {
    await dominioCtrl.deletarPlanoInterno(req.params.code, req.usuarioUuid, req.contexto)
    return res.sendJsonAndLog(true, 'Plano interno excluído com sucesso', httpCode.OK)
  })
)

// ---------------------------------------------------------------------------
// CRUD admin: UG emitente
// ---------------------------------------------------------------------------

router.post(
  '/ug',
  verifyAdmin,
  schemaValidation({ body: dominioSchema.ugCriar }),
  asyncHandler(async (req, res, next) => {
    await dominioCtrl.criarUg(req.body, req.usuarioUuid, req.contexto)
    return res.sendJsonAndLog(true, 'Unidade gestora criada com sucesso', httpCode.Created)
  })
)

router.put(
  '/ug/:code',
  verifyAdmin,
  schemaValidation({ params: dominioSchema.codeParams, body: dominioSchema.ugAtualizar }),
  asyncHandler(async (req, res, next) => {
    await dominioCtrl.atualizarUg(req.params.code, req.body, req.usuarioUuid, req.contexto)
    return res.sendJsonAndLog(true, 'Unidade gestora atualizada com sucesso', httpCode.OK)
  })
)

router.delete(
  '/ug/:code',
  verifyAdmin,
  schemaValidation({ params: dominioSchema.codeParams }),
  asyncHandler(async (req, res, next) => {
    await dominioCtrl.deletarUg(req.params.code, req.usuarioUuid, req.contexto)
    return res.sendJsonAndLog(true, 'Unidade gestora excluída com sucesso', httpCode.OK)
  })
)

module.exports = router
