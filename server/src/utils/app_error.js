// Path: utils\app_error.js
'use strict'

const { serialize } = require('./serialize_error_loader')
const httpCode = require('./http_code')

class AppError extends Error {
  constructor (message, status = httpCode.InternalError, errorTrace = null) {
    super(message)
    this.statusCode = status
    this.errorTrace =
      errorTrace instanceof Error
        ? serialize(errorTrace)
        : errorTrace
  }
}

module.exports = AppError
