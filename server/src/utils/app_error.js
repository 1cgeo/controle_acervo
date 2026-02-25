// Path: utils\app_error.js
'use strict'

let serializeError;
import('serialize-error').then(module => {
  serializeError = module.serializeError;
});

const httpCode = require('./http_code')

class AppError extends Error {
  constructor (message, status = httpCode.InternalError, errorTrace = null) {
    super(message)
    this.statusCode = status
    this.errorTrace =
      errorTrace instanceof Error
        ? (serializeError ? serializeError(errorTrace) : { message: errorTrace.message, stack: errorTrace.stack })
        : errorTrace
  }
}

module.exports = AppError
