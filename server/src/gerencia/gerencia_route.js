'use strict'

const express = require('express')

const { schemaValidation, asyncHandler, httpCode } = require('../utils')

const { verifyAdmin } = require('../login')

const gerenciaCtrl = require('./gerencia_ctrl')
const gerenciaSchema = require('./gerencia_schema')

const router = express.Router()

module.exports = router
