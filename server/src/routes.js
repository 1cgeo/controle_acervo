'use strict'
const express = require('express')

const { databaseVersion } = require('./database')
const {
  httpCode
} = require('./utils')

const { loginRoute } = require('./login')
const { acervoRoute } = require('./acervo')
const { tipoProdutoRoute } = require('./tipo_produto')
const { volumeRoute } = require('./volume')
const { usuarioRoute } = require('./usuario')

const router = express.Router()

router.get('/', (req, res, next) => {
  return res.sendJsonAndLog(
    true,
    'Sistema de Controle do Acervo operacional',
    httpCode.OK,
    {
      database_version: databaseVersion.nome
    }
  )
})

router.use('/login', loginRoute)

router.use('/acervo', acervoRoute)

router.use('/usuarios', usuarioRoute)

router.use('/tipos_produto', tipoProdutoRoute)

router.use('/volumes', volumeRoute)

module.exports = router
