'use strict'

// `producao schema [recurso]` - imprime o contrato de um recurso direto do Joi
// vivo do server/.
//
// E o comando que substitui a leitura preventiva de documentacao. Sem ele, um
// agente que vai lancar a execucao de um mes precisa abrir dois arquivos do
// server/ para descobrir que omitir um campo e "nao mexer" e mandar nulo e
// "apagar", e ainda perderia a guarda, que muda de rota para rota dentro do
// proprio /api/metas.

const { RECURSOS, obter } = require('../lib/recursos')
const esquema = require('../lib/schema')
const { GERAL } = require('../lib/regras')

function executar (args) {
  const chave = args._[1]

  if (!chave) {
    const linhas = [
      'PIT e RPCMTec do SCA. Detalhe de um recurso: producao schema <recurso>',
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
