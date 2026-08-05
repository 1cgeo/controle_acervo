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

const { schemaValidation, asyncHandler, httpCode, AppError } = require('../utils')
const { verifyAdmin } = require('../login')

const edicaoCtrl = require('./rpcmtec_edicao_ctrl')
const subsecaoCtrl = require('./rpcmtec_subsecao_ctrl')
const capacitacaoCtrl = require('./rpcmtec_capacitacao_ctrl')
const rpcmtecPdf = require('./rpcmtec_pdf')
const uploadAnexoEdicao = require('./anexo_edicao_upload')
const rpcmtecSchema = require('./rpcmtec_schema')
const anuarioCtrl = require('../mapoteca/anuario_ctrl')
const mapotecaRelatorioCtrl = require('../mapoteca/relatorio_ctrl')
const { gerarAnuarioOds } = require('./anuario_ods')
const { gerarRtmOds } = require('./rtm_ods')

const router = express.Router()

const doisDigitos = mes => String(mes).padStart(2, '0')

// ---------------------------------------------------------------------------
// Anuário Estatístico (Tabela 5.4.9)
//
// Sai junto do RPCMTec porque é a MESMA tarefa mensal: os dois sobem para a DSG
// no mesmo envio, do mesmo mês. Ele não é uma subseção do relatório, e por isso
// tem rota própria em vez de entrar no DOCX -- o destino dele é uma aba de
// planilha, não um parágrafo.
//
// Os dados vêm de `mapoteca/anuario_ctrl`, que é onde a entrega é registrada, e
// o arquivo sai da planilha-semente da DSG (ver rpcmtec/anuario_ods.js).
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
// de `mapoteca/relatorio_ctrl`, que é onde a impressão é registrada, e o arquivo
// sai da planilha-semente (ver rpcmtec/rtm_ods.js).
//
// A aba é do ANO inteiro, e não do mês: ela é o detalhamento da Meta 4 do PIT,
// e quem a cola no RTM cola o ano corrente. Por isso o `mes` é ignorado aqui.
// ---------------------------------------------------------------------------

router.get(
  '/rtm/ods',
  verifyAdmin,
  schemaValidation({ query: rpcmtecSchema.gerarQuery }),
  asyncHandler(async (req, res, next) => {
    // O RTM e ACUMULADO ate o mes escolhido: 2026 com marco traz janeiro,
    // fevereiro e marco. E o unico download desta tela que acumula, e os outros
    // sao do MES.
    const { ano, mes } = req.query
    const dados = await mapotecaRelatorioCtrl.getRelatorioPedidosDetalhado(ano, mes)
    const buffer = gerarRtmOds(mapotecaRelatorioCtrl.paraAbaMeta4(dados))

    // O mes entra no NOME porque o conteudo depende dele: dois arquivos de 2026
    // com o mesmo nome e conteudo diferente e o jeito certo de mandar o errado
    // para a DSG.
    const nome = `META4_DETALHADA_${ano}_ate_${doisDigitos(mes)}.ods`
    res.setHeader('Content-Type', 'application/vnd.oasis.opendocument.spreadsheet')
    res.setHeader('Content-Disposition', `attachment; filename="${nome}"`)
    res.setHeader('Content-Length', String(buffer.length))
    return res.end(buffer)
  })
)

// ---------------------------------------------------------------------------
// Capacitação (2.6 ministrada, 6.2 recebida)
// ---------------------------------------------------------------------------

router.get(
  '/capacitacao',
  verifyAdmin,
  schemaValidation({ query: rpcmtecSchema.capacitacaoQuery }),
  asyncHandler(async (req, res, next) => {
    const dados = await capacitacaoCtrl.listar(req.query.ano, req.query.tipo_id)

    return res.sendJsonAndLog(
      true, 'Capacitações retornadas com sucesso', httpCode.OK, dados
    )
  })
)

// Antes de '/capacitacao/:id', senão 'anos' cai na rota do id.
router.get(
  '/capacitacao/anos',
  verifyAdmin,
  asyncHandler(async (req, res, next) => {
    const dados = await capacitacaoCtrl.anos()

    return res.sendJsonAndLog(
      true, 'Anos com capacitação retornados com sucesso', httpCode.OK, dados
    )
  })
)

router.get(
  '/capacitacao/:id',
  verifyAdmin,
  schemaValidation({ params: rpcmtecSchema.idParams }),
  asyncHandler(async (req, res, next) => {
    const dados = await capacitacaoCtrl.getPorId(req.params.id)

    if (!dados) {
      throw new AppError('Capacitação não encontrada', httpCode.NotFound)
    }

    return res.sendJsonAndLog(
      true, 'Capacitação retornada com sucesso', httpCode.OK, dados
    )
  })
)

router.post(
  '/capacitacao',
  verifyAdmin,
  schemaValidation({ body: rpcmtecSchema.criarCapacitacao }),
  asyncHandler(async (req, res, next) => {
    const dados = await capacitacaoCtrl.criar(req.body, req.usuarioUuid, req.contexto)

    return res.sendJsonAndLog(
      true, 'Capacitação criada com sucesso', httpCode.Created, dados
    )
  })
)

router.put(
  '/capacitacao/:id',
  verifyAdmin,
  schemaValidation({
    params: rpcmtecSchema.idParams,
    body: rpcmtecSchema.atualizarCapacitacao
  }),
  asyncHandler(async (req, res, next) => {
    const dados = await capacitacaoCtrl.atualizar(
      req.params.id, req.body, req.usuarioUuid, req.contexto
    )

    return res.sendJsonAndLog(
      true, 'Capacitação atualizada com sucesso', httpCode.OK, dados
    )
  })
)

router.delete(
  '/capacitacao/:id',
  verifyAdmin,
  schemaValidation({ params: rpcmtecSchema.idParams }),
  asyncHandler(async (req, res, next) => {
    await capacitacaoCtrl.deletar(req.params.id, req.usuarioUuid, req.contexto)

    return res.sendJsonAndLog(
      true, 'Capacitação excluída com sucesso', httpCode.OK
    )
  })
)

// ---------------------------------------------------------------------------
// A edição mensal (rpcmtec.edicao)
//
// A ORDEM IMPORTA: '/anos' e '/anexo/...' são declaradas antes de '/:id',
// senão 'anos' cairia na rota do id.
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
  '/anos',
  verifyAdmin,
  asyncHandler(async (req, res, next) => {
    const dados = await edicaoCtrl.anos()

    return res.sendJsonAndLog(
      true, 'Anos com edição retornados com sucesso', httpCode.OK, dados
    )
  })
)

// Download do RPCMTec assinado, fora do envelope JSON.
router.get(
  '/anexo/:anexoId/download',
  verifyAdmin,
  schemaValidation({ params: rpcmtecSchema.anexoIdParams }),
  asyncHandler(async (req, res, next) => {
    const arquivo = await edicaoCtrl.getAnexoParaDownload(req.params.anexoId)

    res.setHeader('Content-Type', arquivo.mimetype || 'application/octet-stream')
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(arquivo.nome_original)}"`
    )
    return res.end(arquivo.conteudo)
  })
)

router.delete(
  '/anexo/:anexoId',
  verifyAdmin,
  schemaValidation({ params: rpcmtecSchema.anexoIdParams }),
  asyncHandler(async (req, res, next) => {
    await edicaoCtrl.deletarAnexo(
      req.params.anexoId, req.usuarioUuid, req.contexto
    )

    return res.sendJsonAndLog(true, 'Anexo excluído com sucesso', httpCode.OK)
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

// O DOCUMENTO INTEIRO: os 34 blocos, com o calculado do banco (edição aberta)
// ou o congelado (edição fechada). É o que a tela desenha e o que vira PDF, do
// mesmo objeto -- com a tela lendo de um lugar e o arquivo de outro, os dois
// divergiriam e quem confere veria diferença onde não há.
router.get(
  '/:id/documento',
  verifyAdmin,
  schemaValidation({ params: rpcmtecSchema.idParams }),
  asyncHandler(async (req, res, next) => {
    const dados = await edicaoCtrl.montar(req.params.id)

    return res.sendJsonAndLog(
      true, 'Documento do RPCMTec montado com sucesso', httpCode.OK, dados
    )
  })
)

// Download binário do PDF, fora do envelope JSON.
router.get(
  '/:id/pdf',
  verifyAdmin,
  schemaValidation({ params: rpcmtecSchema.idParams }),
  asyncHandler(async (req, res, next) => {
    const edicao = await edicaoCtrl.montar(req.params.id)
    const buffer = await rpcmtecPdf.montarDocumento(edicao)

    const nome = `RPCMTec-${edicao.ano}-${doisDigitos(edicao.mes)}.pdf`
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="${nome}"`)
    res.setHeader('Content-Length', String(buffer.length))
    return res.end(buffer)
  })
)

// O que o banco diria HOJE, ao lado do congelado. Só em edição fechada.
router.get(
  '/:id/conferir',
  verifyAdmin,
  schemaValidation({ params: rpcmtecSchema.idParams }),
  asyncHandler(async (req, res, next) => {
    const dados = await edicaoCtrl.conferirHoje(req.params.id)

    return res.sendJsonAndLog(
      true, 'Conferência realizada com sucesso', httpCode.OK, dados
    )
  })
)

router.post(
  '/',
  verifyAdmin,
  schemaValidation({ body: rpcmtecSchema.criar }),
  asyncHandler(async (req, res, next) => {
    const dados = await edicaoCtrl.criar(req.body, req.usuarioUuid, req.contexto)

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
    await edicaoCtrl.atualizar(
      req.params.id, req.body, req.usuarioUuid, req.contexto
    )

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
    await edicaoCtrl.deletar(req.params.id, req.usuarioUuid, req.contexto)

    return res.sendJsonAndLog(
      true, 'Edição do RPCMTec excluída com sucesso', httpCode.OK
    )
  })
)

// ---------------------------------------------------------------------------
// Fechamento e reabertura
//
// POST, e não PUT: fechar e reabrir são ATOS, e não a gravação de um campo. O
// fechamento congela os 34 blocos e recusa a edição com subseção por
// preencher; a reabertura descongela e preserva o digitado.
// ---------------------------------------------------------------------------

router.post(
  '/:id/fechar',
  verifyAdmin,
  schemaValidation({ params: rpcmtecSchema.idParams }),
  asyncHandler(async (req, res, next) => {
    const dados = await edicaoCtrl.fechar(
      req.params.id, req.usuarioUuid, req.contexto
    )

    return res.sendJsonAndLog(
      true, 'Edição fechada e congelada com sucesso', httpCode.OK, dados
    )
  })
)

router.post(
  '/:id/reabrir',
  verifyAdmin,
  schemaValidation({ params: rpcmtecSchema.idParams }),
  asyncHandler(async (req, res, next) => {
    const dados = await edicaoCtrl.reabrir(
      req.params.id, req.usuarioUuid, req.contexto
    )

    return res.sendJsonAndLog(
      true, 'Edição reaberta com sucesso', httpCode.OK, dados
    )
  })
)

// ---------------------------------------------------------------------------
// Subseções digitadas
// ---------------------------------------------------------------------------

router.put(
  '/:id/subsecao/:numero',
  verifyAdmin,
  schemaValidation({
    params: rpcmtecSchema.subsecaoParams,
    body: rpcmtecSchema.gravarSubsecao
  }),
  asyncHandler(async (req, res, next) => {
    const dados = await subsecaoCtrl.gravar(
      req.params.id, req.params.numero, req.body, req.usuarioUuid, req.contexto
    )

    return res.sendJsonAndLog(
      true, 'Subseção gravada com sucesso', httpCode.OK, dados
    )
  })
)

// Apaga o conteúdo digitado. A subseção volta a NÃO EXISTIR, que não é o mesmo
// que ficar vazia: o fechamento a cobra de novo.
router.delete(
  '/:id/subsecao/:numero',
  verifyAdmin,
  schemaValidation({ params: rpcmtecSchema.subsecaoParams }),
  asyncHandler(async (req, res, next) => {
    const dados = await subsecaoCtrl.limpar(
      req.params.id, req.params.numero, req.usuarioUuid, req.contexto
    )

    return res.sendJsonAndLog(
      true, 'Subseção limpa com sucesso', httpCode.OK, dados
    )
  })
)

router.post(
  '/:id/copiar-mes-anterior',
  verifyAdmin,
  schemaValidation({
    params: rpcmtecSchema.idParams,
    body: rpcmtecSchema.copiarMesAnterior
  }),
  asyncHandler(async (req, res, next) => {
    const dados = await subsecaoCtrl.copiarDoMesAnterior(
      req.params.id, req.body.numero || null, req.usuarioUuid, req.contexto
    )

    return res.sendJsonAndLog(
      true, 'Conteúdo copiado do mês anterior', httpCode.OK, dados
    )
  })
)

// ---------------------------------------------------------------------------
// Anexo: o RPCMTec assinado
// ---------------------------------------------------------------------------

router.get(
  '/:id/anexos',
  verifyAdmin,
  schemaValidation({ params: rpcmtecSchema.idParams }),
  asyncHandler(async (req, res, next) => {
    const dados = await edicaoCtrl.listarAnexos(req.params.id)

    return res.sendJsonAndLog(
      true, 'Anexos retornados com sucesso', httpCode.OK, dados
    )
  })
)

// O multer vem ANTES da validação do corpo: sem ele, `req.body` do multipart
// chega vazio. Mesma ordem do anexo da revisão do PIT.
router.post(
  '/:id/anexos',
  verifyAdmin,
  schemaValidation({ params: rpcmtecSchema.idParams }),
  uploadAnexoEdicao,
  schemaValidation({ body: rpcmtecSchema.anexoUploadBody }),
  asyncHandler(async (req, res, next) => {
    const dados = await edicaoCtrl.criarAnexo(
      req.params.id, req.file, req.body, req.usuarioUuid, req.contexto
    )

    return res.sendJsonAndLog(
      true, 'RPCMTec assinado anexado com sucesso', httpCode.Created, dados
    )
  })
)

module.exports = router
