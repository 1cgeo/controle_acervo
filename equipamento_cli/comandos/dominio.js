'use strict'

// `equipamento dominio [lista]` - os codigos que entram nos campos *_id.
//
// AQUI A ROTA E UMA SO. Ao contrario da mapoteca e do orcamento, que tem uma
// rota por dominio (<base>/<sub>), o equipamento devolve AS CINCO LISTAS numa
// resposta so: a tela de bens precisa das cinco para desenhar um formulario, e
// cinco requisicoes para cinco catalogos de duas a cinco linhas seria cinco
// vezes o custo pelo mesmo desenho.
//
// Logo, `equipamento dominio situacao` NAO gasta uma chamada a mais que
// `equipamento dominio`: ele recorta localmente o que ja veio.
//
// Nao ha CRUD: sao tabelas de code fixo, semeadas pelo er/ e alteradas por
// migracao. O TIPO DE EQUIPAMENTO nao esta aqui, porque e cadastro: sai em
// `equipamento tipo listar`.

const { DOMINIOS, CAMINHOS } = require('../lib/recursos')
const saida = require('../lib/saida')
const http = require('../lib/http')
const argsLib = require('../lib/args')

async function executar (args, cfg) {
  const lista = args._[1]
  const flags = args.flags

  if (lista && !DOMINIOS.includes(lista)) {
    throw new Error(
      `Domínio desconhecido: "${lista}". Disponíveis: ${DOMINIOS.join(', ')}.\n` +
      'Os tipos de equipamento não são domínio, são cadastro: equipamento tipo listar.'
    )
  }

  const formato = flags.json ? 'json' : (flags.formato || 'tsv')
  const opcoesSaida = {
    formato,
    campos: argsLib.lista(flags.campos)
  }

  const r = await http.autenticada(cfg, 'GET', CAMINHOS.dominio)
  const dados = r.dados || {}

  if (lista) {
    return { texto: saida.lista(dados[lista] || [], opcoesSaida).texto }
  }

  if (formato === 'json') {
    return { texto: JSON.stringify(dados, null, 2) }
  }

  const blocos = []
  for (const nome of DOMINIOS) {
    const linhas = dados[nome] || []
    blocos.push(nome)
    const out = saida.lista(linhas, { ...opcoesSaida, formato: 'tabela' })
    blocos.push(out.texto.split('\n').map(l => '  ' + l).join('\n'))
    blocos.push('')
  }
  blocos.push('A precedência da situação é a escada da situação DERIVADA: vale sempre o degrau')
  blocos.push('mais alto que se aplicar ao bem no dia. Ordene por ela, nunca pelo code.')
  return { texto: blocos.join('\n') }
}

module.exports = { executar, precisaServidor: true }
