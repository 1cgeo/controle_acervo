'use strict'

// Middleware de upload (multer) da MINIATURA FORNECIDA de uma versao: um arquivo
// no campo "arquivo". Os bytes ficam em memoria, o controller normaliza pelo
// mesmo `finalizar` da miniatura renderizada e grava em
// `acervo.miniatura_versao.conteudo` (BYTEA). Mesmo padrao do simbolo da
// instituicao.
//
// POR QUE ESTE CAMINHO EXISTE. A miniatura do acervo e GERADA, renderizando um
// `pdf`, `tif`, `tiff`, `img` ou `ecw` da versao. Modelo 3D e Panoramica 360 nao
// tem nenhum desses: os arquivos deles sao `.3dtiles`, `.db` e `.zip`, e por
// isso as 140 versoes desses dois tipos tinham ZERO miniatura em 2026-08-31,
// enquanto o acervo tinha 4.905. A imagem desses produtos so pode vir de uma
// captura feita por gente, e faltava a porta de entrada.

const multer = require('multer')
const path = require('path')

const { AppError, httpCode } = require('../utils')

// So IMAGEM. SVG fica de fora pela mesma razao do simbolo da instituicao: ele e
// XML, executa script e resolve referencia externa dentro do navegador de quem
// abre a ficha do produto.
const EXT_PERMITIDAS = ['.png', '.jpg', '.jpeg', '.webp', '.gif']
const MIME_PERMITIDOS = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']

// 8 MB. O teto e maior que o do simbolo (2 MB) porque aqui entra captura de
// tela de modelo 3D, e nao brasao: a maior das 136 capturas do EBGeo media
// 943 KB, e o teto existe para barrar o engano de subir a imagem original de
// camera, nao para apertar o caso normal. O que sai gravado e sempre a reducao
// do `finalizar`, entao o tamanho de entrada nao vira tamanho no banco.
const MAX_BYTES = 8 * 1024 * 1024

const storage = multer.memoryStorage()

const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase()
  // Extensao e mimetype declarado vem os dois do cliente, e nenhum e prova: o
  // controller ainda confere a ASSINATURA dos primeiros bytes antes de gravar.
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

const uploadMiniatura = (req, res, next) => {
  upload(req, res, err => {
    if (!err) return next()
    if (err instanceof multer.MulterError) {
      const msg =
        err.code === 'LIMIT_FILE_SIZE'
          ? 'A imagem excede o tamanho máximo de 8 MB'
          : `Erro no upload da imagem: ${err.message}`
      return next(new AppError(msg, httpCode.BadRequest, err))
    }
    return next(err)
  })
}

module.exports = uploadMiniatura
