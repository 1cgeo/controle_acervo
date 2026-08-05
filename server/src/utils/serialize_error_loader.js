'use strict'

// `serialize-error` e ESM PURO desde a versao 9. Este modulo existe so para
// carrega-lo de dentro do nosso CommonJS, e tenta duas vias, nesta ordem:
//
//  1. `require()` sincrono, que o Node aceita para ESM sem flag desde a 22.12.
//     O pacote nao tem top-level await, entao a via sincrona vale.
//  2. `import()` dinamico, para Node anterior a 22.12, onde a via 1 estoura
//     ERR_REQUIRE_ESM.
//
// A ORDEM NAO E COSMETICA. O Jest executa o codigo num contexto de VM, e ali o
// `import()` so funciona com NODE_OPTIONS=--experimental-vm-modules; com a
// flag, o Jest 30 no Node 24 quebra antes, em ERR_VM_MODULE_NOT_MODULE. Com o
// `require()` na frente, o `import()` nunca e alcancado em teste.

let serializeError = null

/** Resolve quando o carregamento termina. `main.js` espera por ela no boot. */
let ready

try {
  serializeError = require('serialize-error').serializeError
  ready = Promise.resolve()
} catch (err) {
  if (err && err.code !== 'ERR_REQUIRE_ESM') throw err
  ready = import('serialize-error').then(module => {
    serializeError = module.serializeError
  })
}

// O fallback nao e decorativo: entre o boot e a resolucao do `import()`, na via
// 2, `serializeError` ainda e nulo, e um erro nesse intervalo precisa virar log
// mesmo assim.
function serialize (error) {
  if (serializeError) {
    return serializeError(error)
  }
  return { message: error.message, stack: error.stack }
}

module.exports = { serialize, ready }
