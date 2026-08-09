'use strict'

const path = require('path');

// A versão do Swagger é a do SERVIÇO, lida de `config.js`, e não um número
// digitado aqui. Ela ficou em '1.0.0' enquanto o serviço andava, pelo mesmo
// motivo que `VERSION` ficou em 1.38.0: nada a ligava a nada.
const { VERSION } = require('../config');

const swaggerOptions = {
  swaggerDefinition: {
    openapi: '3.0.0',
    info: {
      title: 'SAP',
      version: VERSION,
      description: 'API HTTP do Sistema de Apoio à Produção (SAP)'
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
