// Path: server\app.js
'use strict'

const express = require('express')
const path = require('path')
const fs = require('fs')
const cors = require('cors')
const helmet = require('helmet')
const hpp = require('hpp')
const rateLimit = require('express-rate-limit')
const swaggerUi = require('swagger-ui-express')
const swaggerJSDoc = require('swagger-jsdoc')
const noCache = require('nocache')

const appRoutes = require('../routes')
const swaggerOptions = require('./swagger_options')

const swaggerSpec = swaggerJSDoc(swaggerOptions)

const {
  AppError,
  httpCode,
  logger,
  errorHandler,
  sendJsonAndLogMiddleware
} = require('../utils')

const app = express()

// Add sendJsonAndLog to res object
app.use(sendJsonAndLogMiddleware)

// CORS antes do rate limit: respostas 429 também precisam dos headers CORS
app.use(cors())

const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 200
})

// Rate limit antes do body parser: requisição acima do limite não paga o parse de 50mb
app.use(limiter)

app.use(express.json({ limit: '50mb' })) // parsear POST em JSON
app.use(hpp()) // protection against parameter polution

// Helmet Protection (CSP desabilitado: o Express serve o client SPA e o Swagger UI,
// que usam scripts/estilos inline; aplicação de intranet)
app.use(helmet({ contentSecurityPolicy: false }))
app.use(noCache())

app.use((req, res, next) => {
  const url = req.protocol + '://' + req.get('host') + req.originalUrl

  logger.info(`${req.method} request`, {
    url,
    ip: req.ip
  })
  return next()
})

// All routes used by the App
app.use('/api', appRoutes)

app.use('/logs', (req, res) => {
  const logFile = path.join(__dirname, '..', '..', 'logs/combined.log')
  const daysToShow = 3
  const cutofftimestamp = new Date(Date.now() - daysToShow * 24 * 60 * 60 * 1000)
  // Ler apenas o fim do arquivo (5 MB) em vez do arquivo inteiro em memória
  const maxBytes = 5 * 1024 * 1024

  fs.stat(logFile, (statErr, stats) => {
    if (statErr) {
      return res.status(500).send('Error reading log file')
    }

    const start = Math.max(0, stats.size - maxBytes)
    const stream = fs.createReadStream(logFile, { start, encoding: 'utf8' })
    let data = ''
    stream.on('data', chunk => { data += chunk })
    stream.on('error', () => res.status(500).send('Error reading log file'))
    stream.on('end', () => {
      const logData = data.split('\n').filter(entry => {
        const logDate = new Date(entry.split('|')[0])
        return logDate > cutofftimestamp
      }).reverse().join('\n')

      res.setHeader('Content-Type', 'text/plain')
      res.send(logData)
    })
  })
})

// Serve SwaggerDoc
app.use('/api/api_docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec))

// JSON 404 for API routes — must come before static/SPA fallback
app.use('/api', (req, res, next) => {
  const err = new AppError(
    `URL não encontrada para o método ${req.method}`,
    httpCode.NotFound
  )
  return next(err)
})

// Serve Mapoteca Client (build em build/mapoteca, base /mapoteca/) - antes do acervo
app.use("/mapoteca", express.static(path.join(__dirname, "..", "build", "mapoteca")));

app.get("/mapoteca/{*path}", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "build", "mapoteca", "index.html"));
})

// Serve Client (acervo)
app.use(express.static(path.join(__dirname, "..", "build")));

app.get("/{*path}", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "build", "index.html"));
})

// Error handling
app.use((err, req, res, next) => {
  // Resposta já iniciada (ex: streaming): delega ao handler default do Express
  if (res.headersSent) {
    return next(err)
  }
  return errorHandler.log(err, res)
})

module.exports = app