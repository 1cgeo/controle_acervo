'use strict'

// Middleware de upload (multer) para o SIMBOLO da instituicao: um arquivo no
// campo "arquivo". Os bytes ficam em memoria e o controller grava no banco
// (dgeo.instituicao.simbolo BYTEA), no mesmo padrao do anexo do pedido.

const multer = require('multer')
const path = require('path')

const { AppError, httpCode } = require('../utils')

// So IMAGEM, e a lista e curta de proposito: este arquivo vai para dentro de uma
// tag <img> numa pagina PUBLICA. PDF e ofimatica nao servem ali, e aceita-los
// so criaria a chance de alguem subir um documento que a tela nao desenha.
//
// SVG FICA DE FORA, e essa e a decisao que importa. Ele e XML, executa script e
// resolve referencia externa dentro do navegador de quem abre a pagina: um SVG
// hostil no lugar do brasao viraria codigo rodando na sessao do visitante. O
// ganho (nitidez em qualquer tamanho) nao paga o risco numa tela sem login.
const EXT_PERMITIDAS = ['.png', '.jpg', '.jpeg', '.webp', '.gif']
const MIME_PERMITIDOS = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']

// 2 MB. Um brasao de tela cabe com folga em muito menos, e o teto existe para o
// campo nao virar deposito de imagem grande num registro que se le sempre.
const MAX_BYTES = 2 * 1024 * 1024

const storage = multer.memoryStorage()

const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase()
  // Confere a EXTENSAO e o mimetype declarado. Nenhum dos dois e prova (os dois
  // vem do cliente), e por isso o controller ainda confere a ASSINATURA dos
  // primeiros bytes antes de gravar.
  if (!EXT_PERMITIDAS.includes(ext) || !MIME_PERMITIDOS.includes(file.mimetype)) {
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

const uploadSimbolo = (req, res, next) => {
  upload(req, res, err => {
    if (!err) return next()
    if (err instanceof multer.MulterError) {
      const msg =
        err.code === 'LIMIT_FILE_SIZE'
          ? 'A imagem excede o tamanho máximo de 2 MB'
          : `Erro no upload da imagem: ${err.message}`
      return next(new AppError(msg, httpCode.BadRequest, err))
    }
    return next(err)
  })
}

module.exports = uploadSimbolo
