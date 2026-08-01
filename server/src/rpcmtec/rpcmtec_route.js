'use strict'

// Rotas do RPCMTec, o relatório mensal da Divisão.
//
// GUARDA: `verifyAdmin`, e não `verifyPerfil`. O relatório cruza os TRÊS
// módulos numa peça só, e traz valor de crédito, de empenho e de liquidação. Um
// `verifyPerfil('consulta', 'acervo')` entregaria o orçamento inteiro a quem só
// cataloga carta; e não existe "perfil de RPCMTec", porque não existe módulo
// RPCMTec -- ele é rota de PLATAFORMA, como usuários e views materializadas
// (ver CLAUDE.md, modelo de autorização). Quem assina o relatório é o chefe, e
// quem o gera administra o sistema.

const express = require('express')

const { schemaValidation, asyncHandler, httpCode } = require('../utils')
const { verifyAdmin } = require('../login')

const rpcmtecCtrl = require('./rpcmtec_ctrl')
const edicaoCtrl = require('./rpcmtec_edicao_ctrl')
const rpcmtecDocx = require('./rpcmtec_docx')
const rpcmtecSchema = require('./rpcmtec_schema')
const anuarioCtrl = require('../mapoteca/anuario_ctrl')
const mapotecaRelatorioCtrl = require('../mapoteca/relatorio_ctrl')
const { gerarAnuarioOds } = require('./anuario_ods')
const { gerarRtmOds } = require('./rtm_ods')

const router = express.Router()

const doisDigitos = mes => String(mes).padStart(2, '0')

// ---------------------------------------------------------------------------
// Geração. Declarada ANTES das rotas com parâmetro, senão '/docx' seria
// capturado como um id pelo GET '/:id'.
// ---------------------------------------------------------------------------

// Prévia em tela: as MESMAS seções que vão para o arquivo, no envelope JSON
// padrão. A tela não recalcula nada: se ela e o DOCX divergirem, é defeito.
router.get(
  '/gerar',
  verifyAdmin,
  schemaValidation({ query: rpcmtecSchema.gerarQuery }),
  asyncHandler(async (req, res, next) => {
    const dados = await rpcmtecCtrl.gerar({
      ano: req.query.ano,
      mes: req.query.mes
    })

    return res.sendJsonAndLog(true, 'RPCMTec gerado com sucesso', httpCode.OK, dados)
  })
)

// Download binário do DOCX, fora do envelope JSON: envia o arquivo direto.
router.get(
  '/gerar/docx',
  verifyAdmin,
  schemaValidation({ query: rpcmtecSchema.gerarQuery }),
  asyncHandler(async (req, res, next) => {
    const { ano, mes } = req.query
    const dados = await rpcmtecCtrl.gerar({ ano, mes })
    const buffer = await rpcmtecDocx.montarDocumento(dados)

    const nome = `RPCMTec-${ano}-${doisDigitos(mes)}.docx`
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    )
    res.setHeader('Content-Disposition', `attachment; filename="${nome}"`)
    return res.send(buffer)
  })
)

// ---------------------------------------------------------------------------
// Anuário Estatístico (Tabela 5.4.9)
//
// Sai junto do RPCMTec porque é a MESMA tarefa mensal: os dois sobem para a DSG
// no mesmo envio, do mesmo mês. Ele não é uma subseção do relatório, e por isso
// tem rota própria em vez de entrar no DOCX -- o destino dele é uma aba de
// planilha, não um parágrafo.
//
// Os dados vêm de `mapoteca/anuario_ctrl`, que é onde a entrega é registrada; o
// que mudou em 2026-08-01 foi só o ARQUIVO, que passou a sair da planilha-
// semente da DSG em vez de ser redesenhado (ver rpcmtec/anuario_ods.js).
// ---------------------------------------------------------------------------

// Prévia em tela, no envelope JSON.
router.get(
  '/anuario',
  verifyAdmin,
  schemaValidation({ query: rpcmtecSchema.gerarQuery }),
  asyncHandler(async (req, res, next) => {
    const dados = await anuarioCtrl.getAnuarioEstatistico({
      ano: req.query.ano,
      mes: req.query.mes
    })

    return res.sendJsonAndLog(
      true, 'Anuário Estatístico gerado com sucesso', httpCode.OK, dados
    )
  })
)

router.get(
  '/anuario/ods',
  verifyAdmin,
  schemaValidation({ query: rpcmtecSchema.gerarQuery }),
  asyncHandler(async (req, res, next) => {
    const { ano, mes } = req.query
    const anuario = await anuarioCtrl.getAnuarioEstatistico({ ano, mes })
    const buffer = gerarAnuarioOds(
      anuario,
      anuarioCtrl.COLUNAS_ANUARIO,
      anuarioCtrl.paraPlanilha(anuario)
    )

    // O nome segue o dos arquivos que já subiram para a DSG
    // (Anuario_Estatistico_1CGEO_06_Junho_2026.ods): número E nome do mês.
    const nome = `Anuario_Estatistico_1CGEO_${doisDigitos(mes)}_${anuarioCtrl.NOME_MES[mes - 1]}_${ano}.ods`
    res.setHeader('Content-Type', 'application/vnd.oasis.opendocument.spreadsheet')
    res.setHeader('Content-Disposition', `attachment; filename="${nome}"`)
    res.setHeader('Content-Length', String(buffer.length))
    return res.end(buffer)
  })
)

// ---------------------------------------------------------------------------
// RTM: a aba META4_DETALHADA
//
// Sai daqui pelo mesmo motivo do Anuário: é a MESMA tarefa mensal, e os três
// arquivos (RPCMTec, Anuário e RTM) sobem para a DSG no mesmo envio. O dado vem
// de `mapoteca/relatorio_ctrl`, que é onde a impressão é registrada; o que
// mudou em 2026-08-01 foi o ARQUIVO, que passou a sair da planilha-semente em
// vez de ser redesenhado (ver rpcmtec/rtm_ods.js).
//
// A aba é do ANO inteiro, e não do mês: ela é o detalhamento da Meta 4 do PIT,
// e quem a cola no RTM cola o ano corrente. Por isso o `mes` é ignorado aqui.
// ---------------------------------------------------------------------------

router.get(
  '/rtm/ods',
  verifyAdmin,
  schemaValidation({ query: rpcmtecSchema.gerarQuery }),
  asyncHandler(async (req, res, next) => {
    const { ano } = req.query
    const dados = await mapotecaRelatorioCtrl.getRelatorioPedidosDetalhado(ano)
    const buffer = gerarRtmOds(mapotecaRelatorioCtrl.paraAbaMeta4(dados))

    const nome = `META4_DETALHADA_${ano}.ods`
    res.setHeader('Content-Type', 'application/vnd.oasis.opendocument.spreadsheet')
    res.setHeader('Content-Disposition', `attachment; filename="${nome}"`)
    res.setHeader('Content-Length', String(buffer.length))
    return res.end(buffer)
  })
)

// ---------------------------------------------------------------------------
// CRUD da edição mensal (rpcmtec.edicao)
// ---------------------------------------------------------------------------

router.get(
  '/',
  verifyAdmin,
  schemaValidation({ query: rpcmtecSchema.listarQuery }),
  asyncHandler(async (req, res, next) => {
    const dados = await edicaoCtrl.listar({ ano: req.query.ano })

    return res.sendJsonAndLog(
      true, 'Edições do RPCMTec retornadas com sucesso', httpCode.OK, dados
    )
  })
)

router.get(
  '/:id',
  verifyAdmin,
  schemaValidation({ params: rpcmtecSchema.idParams }),
  asyncHandler(async (req, res, next) => {
    const dados = await edicaoCtrl.getPorId(req.params.id)

    return res.sendJsonAndLog(
      true, 'Edição do RPCMTec retornada com sucesso', httpCode.OK, dados
    )
  })
)

router.post(
  '/',
  verifyAdmin,
  schemaValidation({ body: rpcmtecSchema.criar }),
  asyncHandler(async (req, res, next) => {
    const dados = await edicaoCtrl.criar(req.body, req.usuarioUuid)

    return res.sendJsonAndLog(
      true, 'Edição do RPCMTec criada com sucesso', httpCode.Created, dados
    )
  })
)

router.put(
  '/:id',
  verifyAdmin,
  schemaValidation({
    body: rpcmtecSchema.atualizar,
    params: rpcmtecSchema.idParams
  }),
  asyncHandler(async (req, res, next) => {
    await edicaoCtrl.atualizar(req.params.id, req.body, req.usuarioUuid)

    return res.sendJsonAndLog(
      true, 'Edição do RPCMTec atualizada com sucesso', httpCode.OK
    )
  })
)

router.delete(
  '/:id',
  verifyAdmin,
  schemaValidation({ params: rpcmtecSchema.idParams }),
  asyncHandler(async (req, res, next) => {
    await edicaoCtrl.deletar(req.params.id)

    return res.sendJsonAndLog(
      true, 'Edição do RPCMTec excluída com sucesso', httpCode.OK
    )
  })
)

module.exports = router
