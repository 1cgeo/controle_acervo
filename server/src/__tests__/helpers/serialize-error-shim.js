'use strict'

// Dublê CJS de `serialize-error` (ESM puro desde a versão 9) para o Jest.
//
// POR QUE EXISTE: o Jest carrega o código do servidor como CommonJS, e ali um
// pacote ESM puro não entra de jeito nenhum. Pelo `import()` dinâmico ele exige
// NODE_OPTIONS=--experimental-vm-modules, e com essa flag o Jest 30 no Node 24
// quebra antes, em ERR_VM_MODULE_NOT_MODULE. Sem saída pelos dois lados, a
// suíte inteira falhava no `require` de utils/app_error.js, antes de rodar
// teste nenhum. Mapeado em jest.config.js, como já era feito com o `uuid`.
//
// EM PRODUÇÃO NADA DISSO VALE: lá o loader faz `require('serialize-error')` e
// carrega a biblioteca de verdade. Este arquivo só existe dentro do Jest.
//
// A divergência é aceitável porque `serialize` é usado em DOIS lugares
// (utils/app_error.js e utils/error_handler.js), sempre para virar log, e
// vários testes unitários já dublavam o loader com exatamente
// `{ message, stack }` antes deste arquivo existir. O que ele acrescenta a esse
// dublê ad hoc é o `cause`, as propriedades próprias e o corte de ciclo, que é
// o que separa um log útil de um RangeError dentro do tratador de erro.

/** Igual ao original: valor que não é Error passa direto, sem inventar campo. */
function ehErro (valor) {
  return Boolean(valor) && typeof valor === 'object' &&
    typeof valor.message === 'string' && typeof valor.name === 'string'
}

function serializeError (valor, vistos = new WeakSet()) {
  if (!ehErro(valor)) return valor

  // Erro que se referencia (err.cause = err) faria a recursão não terminar.
  if (vistos.has(valor)) return '[Circular]'
  vistos.add(valor)

  const saida = {
    name: valor.name,
    message: valor.message,
    stack: valor.stack
  }

  // Propriedades próprias (o `code` de um erro do pg, por exemplo) são metade
  // do valor do log: sem elas fica só a mensagem.
  for (const chave of Object.keys(valor)) {
    if (chave in saida) continue
    const item = valor[chave]
    saida[chave] = ehErro(item) ? serializeError(item, vistos) : item
  }

  if (valor.cause !== undefined) {
    saida.cause = serializeError(valor.cause, vistos)
  }

  return saida
}

module.exports = { serializeError }
