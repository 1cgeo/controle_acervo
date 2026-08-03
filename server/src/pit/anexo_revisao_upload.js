'use strict'

// Middleware de upload (multer) para o arquivo de uma revisão do PIT, no campo
// "arquivo". Os bytes ficam em memória e o controller grava no banco (coluna
// `conteudo` BYTEA), no mesmo padrão do anexo do pedido da mapoteca.
//
// A LISTA DE EXTENSÕES É MENOR que a do anexo do pedido, e de propósito: ali
// chega o que o cliente mandou junto do DIEx (ZIP de SHP, KMZ, imagem); aqui
// chega o PIT assinado e o de impressão, que são PDF e planilha. Aceitar ZIP
// convidaria a guardar um pacote inteiro no banco.

const multer = require('multer')
const path = require('path')

const { AppError, httpCode } = require('../utils')

const EXT_PERMITIDAS = [
  '.pdf', '.odt', '.doc', '.docx', '.ods', '.xls', '.xlsx', '.csv', '.p7s'
]

// O R0 de 2026 tem 292 KB e o R1 tem 291 KB. Vinte megabytes cobrem o documento
// assinado com folga e ainda barram o engano de subir um pacote.
const MAX_BYTES = 20 * 1024 * 1024

const storage = multer.memoryStorage()

const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase()
  if (!EXT_PERMITIDAS.includes(ext)) {
    return cb(
      new AppError(
        `Tipo de arquivo não permitido (${ext || 'sem extensão'}). ` +
        `Aceitos: ${EXT_PERMITIDAS.join(', ')}`,
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

// Traduz MulterError (arquivo grande demais) numa AppError 400 amigável; erro do
// fileFilter já é AppError e passa direto.
const uploadAnexoRevisao = (req, res, next) => {
  upload(req, res, err => {
    if (!err) return next()
    if (err instanceof multer.MulterError) {
      const msg =
        err.code === 'LIMIT_FILE_SIZE'
          ? 'Arquivo excede o tamanho máximo de 20 MB'
          : `Erro no upload do arquivo: ${err.message}`
      return next(new AppError(msg, httpCode.BadRequest, err))
    }
    return next(err)
  })
}

module.exports = uploadAnexoRevisao
