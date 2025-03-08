// Path: server\swagger_options.js
'use strict'

const path = require('path');

const swaggerOptions = {
  swaggerDefinition: {
    openapi: '3.0.0',
    info: {
      title: 'Controle do Acervo',
      version: '1.0.0',
      description: 'API HTTP para utilização do Controle do Acervo'
    },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        }
      }
    },
    security: [{
      bearerAuth: []
    }]
  },
  apis: [path.join(__dirname, '../**/*.js')],
}


module.exports = swaggerOptions
