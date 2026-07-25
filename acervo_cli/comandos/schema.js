// Path: comandos\schema.js
'use strict'

// `acervo schema [recurso]` - imprime o contrato de um recurso direto do Joi vivo.
//
// E o comando que substitui a leitura preventiva de documentacao. Sem ele, um
// agente que vai corrigir uma data_edicao precisa abrir tres arquivos do server/
// para descobrir os treze campos que o PUT exige. Com ele, le so o recurso que
// vai usar, e sem gastar rede nem credencial.

const { RECURSOS, obter } = require('../lib/recursos')
const esquema = require('../lib/schema')
const { GERAL } = require('../lib/regras')

function executar (args) {
  const chave = args._[1]

  if (!chave) {
    const linhas = [
      'Recursos do SCA. Detalhe de um deles: acervo schema <recurso>',
      '',
      esquema.indice(RECURSOS),
      '',
      'geral',
      ...GERAL.map(l => (l ? '  ' + l : ''))
    ]
    return { texto: linhas.join('\n') }
  }

  const recurso = obter(chave)
  return { texto: esquema.contrato(chave, recurso) }
}

module.exports = { executar, precisaServidor: false }
