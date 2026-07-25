// Path: comandos\schema.js
'use strict'

// `mapoteca schema [recurso]` - imprime o contrato de um recurso direto do Joi
// vivo do server/.
//
// E o comando que substitui a leitura preventiva de documentacao. Sem ele, um
// agente que vai cadastrar um pedido precisa carregar o catalogo inteiro de
// rotas para descobrir quais dos vinte campos sao obrigatorios. Com ele, le so o
// recurso que vai usar, e le a verdade de hoje.

const { RECURSOS, obter } = require('../lib/recursos')
const esquema = require('../lib/schema')
const { GERAL, REGRAS_VERBO } = require('../lib/regras')

function executar (args) {
  const chave = args._[1]

  if (!chave) {
    const linhas = [
      'Recursos da mapoteca. Detalhe de um deles: mapoteca schema <recurso>',
      '',
      esquema.indice(RECURSOS),
      '',
      'geral',
      ...GERAL.map(l => '  ' + l),
      '',
      'ao casar uma folha com o acervo (mapoteca resolver)',
      ...REGRAS_VERBO.resolver.map(l => '  ' + l),
      '',
      'ao cadastrar um pedido inteiro (mapoteca pedido cadastrar)',
      ...REGRAS_VERBO.cadastrar.map(l => '  ' + l)
    ]
    return { texto: linhas.join('\n') }
  }

  const recurso = obter(chave)
  return { texto: esquema.contrato(chave, recurso) }
}

module.exports = { executar, precisaServidor: false }
