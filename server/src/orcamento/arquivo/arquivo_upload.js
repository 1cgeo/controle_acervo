'use strict'

// Middleware de upload (multer) para um unico arquivo no campo "arquivo".
// O vinculo vem na query (nota_credito_id | dfd_id | pdr_ano | recolhimento_id),
// ja validado e coercido pelo schemaValidation que roda antes deste middleware.
// A extensao aceita depende do tipo de vinculo: NC, DFD e recolhimento aceitam
// so PDF (o extrato do SIAFI e o DIEx sao PDF); o PDR aceita PDF e planilhas.
// Os bytes ficam em memoria (file.buffer) e o controller grava no banco (coluna
// conteudo BYTEA); o nome original do usuario fica nos metadados.

const multer = require('multer')
const path = require('path')

const { AppError, httpCode } = require('../utils')

const EXT_PDF = ['.pdf']
const EXT_PDR = ['.pdf', '.xlsx', '.xls', '.csv', '.ods']
const MAX_BYTES = 50 * 1024 * 1024 // 50 MB

const tipoDaQuery = query => {
  if (query.nota_credito_id != null) return 'nota_credito'
  if (query.dfd_id != null) return 'dfd'
  if (query.pdr_ano != null) return 'pdr'
  if (query.recolhimento_id != null) return 'recolhimento'
  return null
}

const extensoesPermitidas = tipo => (tipo === 'pdr' ? EXT_PDR : EXT_PDF)

// Os bytes ficam em memoria; o controller os persiste no banco.
const storage = multer.memoryStorage()

const fileFilter = (req, file, cb) => {
  const tipo = tipoDaQuery(req.query)
  const ext = path.extname(file.originalname).toLowerCase()
  const permitidas = extensoesPermitidas(tipo)
  if (!permitidas.includes(ext)) {
    return cb(
      new AppError(
        `Tipo de arquivo não permitido para este anexo (${ext || 'sem extensão'}). Aceitos: ${permitidas.join(', ')}`,
        httpCode.BadRequest
      )
    )
  }
  cb(null, true)
}

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_BYTES }
}).single('arquivo')

// Wrapper: traduz MulterError (ex.: arquivo grande demais) numa AppError 400
// amigavel; erros do fileFilter ja sao AppError e passam direto.
const uploadArquivo = (req, res, next) => {
  upload(req, res, err => {
    if (!err) return next()
    if (err instanceof multer.MulterError) {
      const msg =
        err.code === 'LIMIT_FILE_SIZE'
          ? 'Arquivo excede o tamanho máximo de 50 MB'
          : `Erro no upload do arquivo: ${err.message}`
      return next(new AppError(msg, httpCode.BadRequest, err))
    }
    return next(err)
  })
}

module.exports = uploadArquivo
