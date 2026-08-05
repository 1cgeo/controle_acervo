'use strict'

const express = require('express')

const { schemaValidation, asyncHandler, httpCode, AppError } = require('../utils')
const { verifyPerfil } = require('../../login')

const arquivoCtrl = require('./arquivo_ctrl')
const arquivoSchema = require('./arquivo_schema')
const uploadArquivo = require('./arquivo_upload')

const router = express.Router()

// Lista os anexos de um vinculo (?nota_credito_id= | ?dfd_id= | ?pdr_ano=).
router.get(
  '/',
  verifyPerfil('consulta', 'orcamento'),
  schemaValidation({ query: arquivoSchema.vinculoQuery }),
  asyncHandler(async (req, res, next) => {
    const dados = await arquivoCtrl.listarPorVinculo(req.query)

    const msg = 'Arquivos retornados com sucesso'

    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

// Anexa um arquivo a um vinculo. O vinculo vem na query; o arquivo no campo
// multipart "arquivo". Ordem: auth -> valida query -> multer -> handler.
router.post(
  '/',
  verifyPerfil('operador', 'orcamento'),
  schemaValidation({ query: arquivoSchema.vinculoQuery }),
  uploadArquivo,
  asyncHandler(async (req, res, next) => {
    if (!req.file) {
      throw new AppError(
        'Nenhum arquivo enviado (campo "arquivo")',
        httpCode.BadRequest
      )
    }

    const dados = await arquivoCtrl.criar(req.file, req.query, req.usuarioUuid, req.contexto)

    const msg = 'Arquivo anexado com sucesso'

    return res.sendJsonAndLog(true, msg, httpCode.Created, dados)
  })
)

// Baixa o arquivo (bytes do banco) com o nome original no Content-Disposition.
router.get(
  '/:id/download',
  verifyPerfil('consulta', 'orcamento'),
  schemaValidation({ params: arquivoSchema.idParams }),
  asyncHandler(async (req, res, next) => {
    const arquivo = await arquivoCtrl.getParaDownload(req.params.id)

    res.setHeader(
      'Content-Type',
      arquivo.mimetype || 'application/octet-stream'
    )
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(arquivo.nome_original)}`
    )

    return res.send(arquivo.conteudo)
  })
)

// Remove o anexo. Nao ha arquivo em disco: os bytes moram na coluna `conteudo`
// (BYTEA), entao apagar a linha apaga o arquivo.
router.delete(
  '/:id',
  verifyPerfil('gerente', 'orcamento'),
  schemaValidation({ params: arquivoSchema.idParams }),
  asyncHandler(async (req, res, next) => {
    await arquivoCtrl.deletar(req.params.id, req.usuarioUuid, req.contexto)

    const msg = 'Arquivo excluido com sucesso'

    return res.sendJsonAndLog(true, msg, httpCode.OK)
  })
)

module.exports = router
