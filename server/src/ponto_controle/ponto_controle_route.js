// Path: ponto_controle\ponto_controle_route.js
'use strict'

const express = require('express')
const fs = require('fs').promises
const fsClassic = require('fs')

const {
  AppError, asyncHandler, httpCode, schemaValidation, csvExport
} = require('../utils')

const { verifyPerfil } = require('../login')

const pontoControleCtrl = require('./ponto_controle_ctrl')
const dashboardCtrl = require('./dashboard_ctrl')
const uploadCtrl = require('./upload_ctrl')
const pontoControleSchema = require('./ponto_controle_schema')

const router = express.Router()

// O perfil e o do modulo ACERVO: ponto de controle e uma tela do acervo, e nao
// um modulo proprio. Quem tem consulta no acervo ve os pontos.
router.get(
  '/dominios',
  verifyPerfil('consulta', 'acervo'),
  asyncHandler(async (req, res, next) => {
    const dados = await pontoControleCtrl.getDominios()
    const msg = 'Domínios de ponto de controle retornados com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

// Opções dos filtros COM o quantitativo de cada uma. Só aparece quem tem ponto,
// e cada lista aplica os OUTROS filtros e nunca o próprio: escolher um projeto
// não pode zerar a lista de lotes daquele projeto.
router.get(
  '/facetas',
  verifyPerfil('consulta', 'acervo'),
  schemaValidation({ query: pontoControleSchema.facetasQuery }),
  asyncHandler(async (req, res, next) => {
    const dados = await pontoControleCtrl.getFacetas(req.query)
    const msg = 'Facetas de ponto de controle retornadas com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

// Posição de TODOS os pontos do filtro, sem paginação, para o mapa. A lista
// pagina porque ninguém lê 500 cartões; o mapa não pode paginar, senão afirma
// visualmente que a missão tem só o que está na página.
router.get(
  '/posicoes',
  verifyPerfil('consulta', 'acervo'),
  schemaValidation({ query: pontoControleSchema.posicoesQuery }),
  asyncHandler(async (req, res, next) => {
    const dados = await pontoControleCtrl.getPosicoes(req.query)
    const msg = 'Posições dos pontos retornadas com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.get(
  '/csv',
  verifyPerfil('consulta', 'acervo'),
  schemaValidation({ query: pontoControleSchema.csvQuery }),
  asyncHandler(async (req, res, next) => {
    const filtros = { ...req.query }
    if (typeof filtros.ids === 'string') {
      filtros.ids = filtros.ids.split(',').map(Number)
    }
    const dados = await pontoControleCtrl.getCsv(filtros)
    return csvExport.sendReport(res, 'csv', 'CSV gerado', dados, {
      filename: 'pontos-de-controle.csv'
    })
  })
)

// Números da aba de ponto de controle no dashboard do acervo.
router.get(
  '/dashboard',
  verifyPerfil('consulta', 'acervo'),
  asyncHandler(async (req, res, next) => {
    const dados = await dashboardCtrl.getResumo()
    const msg = 'Resumo de ponto de controle retornado com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.get(
  '/',
  verifyPerfil('consulta', 'acervo'),
  schemaValidation({ query: pontoControleSchema.listaQuery }),
  asyncHandler(async (req, res, next) => {
    const dados = await pontoControleCtrl.getPontos(req.query)
    const msg = 'Pontos de controle retornados com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

// --- Importação da missão, em duas fases -------------------------------------
//
// O mesmo desenho do upload do acervo (server/src/arquivo/arquivo_route.js), e
// pela mesma razão: o conteúdo dos arquivos não passa pela API. Uma missão de
// 100 pontos passa de 300 MB.
//
//   1. prepare-upload/missao -> confere tudo, abre a sessão e devolve, por
//      arquivo, PARA ONDE copiá-lo. Nenhum ponto é gravado ainda.
//   2. quem importa transfere os arquivos ao volume.
//   3. confirm-upload -> o servidor RELÊ cada arquivo no volume, recalcula o
//      SHA-256 e só então grava. É o passo que separa "o cliente disse" de
//      "está no destino".
//
// Substituir ponto que já existe é ato EXPLÍCITO (substituir=true), e não o
// padrão: cod_ponto é identidade global, e sobrescrever calado apagaria a
// medição de outra missão.
router.post(
  '/prepare-upload/missao',
  verifyPerfil('gerente', 'acervo'),
  schemaValidation({ body: pontoControleSchema.prepararMissao }),
  asyncHandler(async (req, res, next) => {
    const dados = await uploadCtrl.prepararMissao(req.body, req.usuarioUuid)
    const msg =
      'Importação preparada. Copie os arquivos para os caminhos indicados e ' +
      'chame confirm-upload.'
    return res.sendJsonAndLog(true, msg, httpCode.Created, dados)
  })
)

router.post(
  '/confirm-upload',
  verifyPerfil('gerente', 'acervo'),
  schemaValidation({ body: pontoControleSchema.confirmarMissao }),
  asyncHandler(async (req, res, next) => {
    const relatorio = await uploadCtrl.confirmarMissao(
      req.body.session_uuid,
      req.usuarioUuid
    )

    // success=false com 200, como o confirm-upload do acervo: a conferência que
    // reprova não é erro de requisição, é o RESULTADO da importação, e o
    // relatório por arquivo é a parte útil da resposta.
    const ok = relatorio.status === 'completed'
    const msg = ok
      ? `Importação concluída: ${relatorio.inseridos.length} inserido(s), ` +
        `${relatorio.substituidos.length} substituído(s), ` +
        `${relatorio.arquivos_novos} arquivo(s) registrado(s)`
      : `Importação não concluída: ${relatorio.error_message}`

    return res.sendJsonAndLog(ok, msg, httpCode.OK, relatorio)
  })
)

router.get(
  '/upload-sessions',
  verifyPerfil('gerente', 'acervo'),
  asyncHandler(async (req, res, next) => {
    const dados = await uploadCtrl.getSessoes()
    const msg = 'Sessões de importação retornadas com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.post(
  '/cancel-upload',
  verifyPerfil('gerente', 'acervo'),
  schemaValidation({ body: pontoControleSchema.confirmarMissao }),
  asyncHandler(async (req, res, next) => {
    await uploadCtrl.cancelarSessao(req.body.session_uuid, req.usuarioUuid)
    const msg = 'Sessão de importação cancelada'
    return res.sendJsonAndLog(true, msg, httpCode.OK)
  })
)

// Download dos DOIS arquivos do ponto: o pacote e a monografia.
//
// Entrega os BYTES, e não um caminho de rede como o acervo faz. O acervo pode
// devolver caminho porque quem baixa é o plugin QGIS, que enxerga o share; a
// tela do navegador não enxerga.
//
// O tipo vai na URL como PALAVRA, e não como código: '/pacote' e '/monografia'
// se leem no log e num link mandado por DIEx. A tradução para o código do
// domínio fica aqui, num lugar só.
const TIPO_POR_NOME = { pacote: 1, monografia: 2 }

router.get(
  '/:cod_ponto/download/:tipo',
  verifyPerfil('consulta', 'acervo'),
  schemaValidation({ params: pontoControleSchema.downloadParams }),
  asyncHandler(async (req, res, next) => {
    const tipoId = TIPO_POR_NOME[req.params.tipo]
    const arquivo = await pontoControleCtrl.getArquivoParaDownload(
      req.params.cod_ponto,
      tipoId
    )

    // O registro diz que o arquivo existe; o VOLUME é que decide. Sem esta
    // conferência o streaming falharia no meio, com cabeçalho já enviado e
    // um download truncado que parece completo.
    try {
      await fs.access(arquivo.caminho)
    } catch {
      throw new AppError(
        `O arquivo está registrado mas não foi encontrado no volume: ${arquivo.nome}`,
        httpCode.NotFound
      )
    }

    res.setHeader('Content-Type', 'application/octet-stream')
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${arquivo.nome}"`
    )
    // O checksum vai no cabeçalho para quem baixa poder conferir o que chegou.
    res.setHeader('X-Checksum-SHA256', arquivo.checksum)

    const fluxo = fsClassic.createReadStream(arquivo.caminho)
    fluxo.on('error', () => res.destroy())
    fluxo.pipe(res)
  })
)

// POR ÚLTIMO, e não junto das outras GET: '/:cod_ponto' casa com QUALQUER
// segmento. Declarada antes, ela engoliria '/dominios' e '/upload-sessions', e
// o erro apareceria como um 400 de código de ponto inválido, que não diz nada a
// quem chamou. Mesma disciplina de '/api/mapoteca/dashboard' antes de
// '/api/mapoteca' em routes.js.
router.get(
  '/:cod_ponto',
  verifyPerfil('consulta', 'acervo'),
  schemaValidation({ params: pontoControleSchema.codPontoParams }),
  asyncHandler(async (req, res, next) => {
    const dados = await pontoControleCtrl.getPonto(req.params.cod_ponto)
    const msg = 'Ponto de controle retornado com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

module.exports = router
