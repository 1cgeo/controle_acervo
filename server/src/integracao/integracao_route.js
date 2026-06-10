// Path: integracao\integracao_route.js
'use strict'

// Rotas públicas de integração (read-only, SEM autenticação), consumidas pelo
// vault do Chefe da DGEO. A ausência de verifyLogin é intencional e segue a
// mesma postura do restante do projeto (intranet confiável; ver CLAUDE.md,
// "Intentional Design Decisions": CORS aberto, /logs e /dominio públicos).
// Expõem apenas dados de acervo (cobertura, produtos finalizados) e o agregado
// da mapoteca estritamente necessário ao RPCMTec (sem endereço/contato).

const express = require('express')

const { schemaValidation, asyncHandler, httpCode } = require('../utils')

const integracaoCtrl = require('./integracao_ctrl')
const integracaoSchema = require('./integracao_schema')

const router = express.Router()

// Cobertura do acervo por folha (substitui o site de produtos no roteamento de
// demanda). ?escala=25k|50k|100k|250k (default: todas), ?geom=true para incluir
// geometria, ?mi= / ?inom= (csv) para filtrar folhas.
router.get(
  '/acervo/situacao_geral',
  schemaValidation({
    query: integracaoSchema.situacaoGeralQuery
  }),
  asyncHandler(async (req, res, next) => {
    const dados = await integracaoCtrl.getSituacaoGeral(req.query)
    const msg = 'Situação geral do acervo retornada com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

// Produtos finalizados no mês (RPCMTec 2.2). Critério = data_edicao
// (finalização), não data de cadastro. ?ano= &mes= &cumulativo= (default true)
// &tipo_produto_id= &tipo_escala_id=.
router.get(
  '/acervo/produtos_finalizados',
  schemaValidation({
    query: integracaoSchema.produtosFinalizadosQuery
  }),
  asyncHandler(async (req, res, next) => {
    const dados = await integracaoCtrl.getProdutosFinalizados(req.query)
    const msg = 'Produtos finalizados no período retornados com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

// Atendimentos da mapoteca no mês (RPCMTec 2.4 militar e 2.7 civil/LAI).
// ?ano= &mes= &cumulativo= (default true).
router.get(
  '/mapoteca/atendimentos',
  schemaValidation({
    query: integracaoSchema.atendimentosQuery
  }),
  asyncHandler(async (req, res, next) => {
    const dados = await integracaoCtrl.getMapotecaAtendimentos(req.query)
    const msg = 'Atendimentos da mapoteca no período retornados com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

module.exports = router
