'use strict'

// Middleware de upload (multer) do RPCMTec ASSINADO, no campo "arquivo". Os
// bytes ficam em memória e o controller grava no banco (coluna `conteudo`
// BYTEA), no mesmo padrão do anexo da revisão do PIT e do pedido da mapoteca.
//
// A LISTA É MENOR que a do anexo da revisão do PIT, e de propósito: lá chega o
// PIT assinado e a planilha de impressão; aqui chega UMA coisa, o relatório
// assinado. O sistema é quem emite o PDF, então aceitar .docx aqui reabriria a
// porta que a decisão de 2026-08-05 fechou -- o documento não passa mais pelo
// Word.
//
// O .p7s entra porque é como a assinatura digital destacada volta de alguns
// fluxos: o PDF vai junto, e o pacote é o que se guarda.

const multer = require('multer')
const path = require('path')

const { AppError, httpCode } = require('../utils')

const EXT_PERMITIDAS = ['.pdf', '.p7s']

// A edição de julho/2026 tem 8 páginas e pouco mais de 300 KB. Vinte megabytes
// cobrem o assinado com folga e ainda barram o engano de subir um pacote.
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

// Traduz MulterError (arquivo grande demais) numa AppError 400 amigável; erro
// do fileFilter já é AppError e passa direto.
const uploadAnexoEdicao = (req, res, next) => {
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

module.exports = uploadAnexoEdicao
