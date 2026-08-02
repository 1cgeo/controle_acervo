'use strict'

// `auth schema [recurso]` - imprime o contrato de um recurso direto do Joi vivo.
//
// E o comando que substitui a leitura preventiva de documentacao. Sem ele, um
// agente que vai criar um usuario precisa abrir dois arquivos do server/ para
// descobrir os oito campos que o POST exige, e ainda perderia o `perfis`, que e
// declarado por pattern e nao por chave.

const { RECURSOS, obter } = require('../lib/recursos')
const esquema = require('../lib/schema')
const { GERAL } = require('../lib/regras')

function executar (args) {
  const chave = args._[1]

  if (!chave) {
    const linhas = [
      'Recursos de identidade do SCA. Detalhe de um deles: auth schema <recurso>',
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
