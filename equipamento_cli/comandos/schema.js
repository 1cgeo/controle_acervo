'use strict'

// `equipamento schema [recurso]` - imprime o contrato de um recurso direto do
// Joi vivo do server/.
//
// E o comando que substitui a leitura preventiva de documentacao. Sem ele, um
// agente que vai lancar uma manutencao precisa carregar o catalogo inteiro de
// rotas para descobrir quais campos existem e quais sao obrigatorios. Com ele,
// le so o recurso que vai usar, e le a versao de HOJE do schema.
//
// Nao gasta rede nem credencial: o contrato e conhecimento estatico do repo.

const { RECURSOS, obter } = require('../lib/recursos')
const esquema = require('../lib/schema')
const { GERAL, REGRAS_VERBO } = require('../lib/regras')

function executar (args) {
  const chave = args._[1]

  if (!chave) {
    const linhas = [
      'Recursos do módulo equipamento do SCA. Detalhe de um deles: equipamento schema <recurso>',
      '',
      esquema.indice(RECURSOS),
      '',
      'geral',
      ...GERAL.map(l => '  ' + l),
      '',
      'fechar um lançamento',
      ...REGRAS_VERBO.fechar.map(l => '  ' + l),
      '',
      'dar baixa num bem',
      ...REGRAS_VERBO.baixar.map(l => '  ' + l)
    ]
    return { texto: linhas.join('\n') }
  }

  const recurso = obter(chave)
  return { texto: esquema.contrato(chave, recurso) }
}

module.exports = { executar, precisaServidor: false }
