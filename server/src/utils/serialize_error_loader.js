// Path: utils\serialize_error_loader.js
'use strict'

let serializeError = null

const ready = import('serialize-error').then(module => {
  serializeError = module.serializeError
})

function serialize (error) {
  if (serializeError) {
    return serializeError(error)
  }
  return { message: error.message, stack: error.stack }
}

module.exports = { serialize, ready }
