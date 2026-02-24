'use strict'

// CJS shim for uuid v13+ (ESM-only) to work with Jest
// Node.js 19+ has crypto.randomUUID() built-in
const crypto = require('crypto')

module.exports = {
  v4: () => crypto.randomUUID(),
  v1: () => crypto.randomUUID(), // fallback
  validate: (str) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str)
}
