// Path: mapoteca\anexo_pedido_upload.js
'use strict'

// Middleware de upload (multer) para um único arquivo no campo "arquivo",
// anexado a um pedido da mapoteca. Os bytes ficam em memória (file.buffer) e o
// controller grava no banco (coluna conteudo BYTEA), no padrão do controle
// orçamentário. O pedido vem no parâmetro de rota (:id), já validado.
// Aceita os formatos usuais de documento de solicitação e seus anexos
// (PDF/imagem/planilha/compactado/vetor), com limite de tamanho.

const multer = require('multer')
const path = require('path')

const { AppError, httpCode } = require('../utils')

// Formatos aceitos para o documento de solicitação e seus anexos. Cobre o que
// costuma vir num pedido (DIEx em PDF, imagens, planilhas, ZIP de SHP, KML/KMZ).
const EXT_PERMITIDAS = [
  '.pdf', '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.tif', '.tiff',
  '.doc', '.docx', '.odt', '.xls', '.xlsx', '.ods', '.csv', '.txt', '.rtf',
  '.zip', '.rar', '.7z', '.kml', '.kmz', '.geojson', '.gpkg', '.dxf', '.dwg',
  '.xml', '.json', '.p7s'
]
const MAX_BYTES = 100 * 1024 * 1024 // 100 MB (anexos podem incluir ZIP de SHP)

// Os bytes ficam em memória; o controller os persiste no banco.
const storage = multer.memoryStorage()

const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase()
  if (!EXT_PERMITIDAS.includes(ext)) {
    return cb(
      new AppError(
        `Tipo de arquivo não permitido (${ext || 'sem extensão'}). Aceitos: ${EXT_PERMITIDAS.join(', ')}`,
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
// amigável; erros do fileFilter já são AppError e passam direto.
const uploadAnexoPedido = (req, res, next) => {
  upload(req, res, err => {
    if (!err) return next()
    if (err instanceof multer.MulterError) {
      const msg =
        err.code === 'LIMIT_FILE_SIZE'
          ? 'Arquivo excede o tamanho máximo de 100 MB'
          : `Erro no upload do arquivo: ${err.message}`
      return next(new AppError(msg, httpCode.BadRequest, err))
    }
    return next(err)
  })
}

module.exports = uploadAnexoPedido
