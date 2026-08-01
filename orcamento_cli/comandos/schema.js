'use strict'

// `orcamento schema [recurso]` - imprime o contrato de um recurso direto do Joi vivo.
//
// E o comando que substitui a leitura preventiva de documentacao. Sem ele, um
// agente que vai lancar uma NC precisa carregar o catalogo inteiro de rotas para
// descobrir cinco campos obrigatorios. Com ele, le so o recurso que vai usar.

const { RECURSOS, obter } = require('../lib/recursos')
const esquema = require('../lib/schema')
const { GERAL } = require('../lib/regras')

function executar (args) {
  const chave = args._[1]

  if (!chave) {
    const linhas = [
      'Recursos do modulo orcamento do SCA. Detalhe de um deles: orcamento schema <recurso>',
      '',
      esquema.indice(RECURSOS),
      '',
      'geral',
      ...GERAL.map(l => '  ' + l)
    ]
    return { texto: linhas.join('\n') }
  }

  const recurso = obter(chave)
  return { texto: esquema.contrato(chave, recurso) }
}

module.exports = { executar, precisaServidor: false }
