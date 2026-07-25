// Path: comandos\dominio.js
'use strict'

// `mapoteca dominio [<sub>]` - as tabelas de dominio da mapoteca.
//
//   mapoteca dominio                     lista quais dominios existem
//   mapoteca dominio situacao_pedido     lista os codigos de um deles
//
// Sao os unicos GET publicos da mapoteca (servem para popular os selects do
// client web), entao a listagem funciona mesmo sem credencial. Nao ha CRUD: sao
// tabelas fixas, alteradas por migracao do banco, e um CLI que oferecesse
// "dominio criar" prometeria uma rota que nao existe.

const { DOMINIOS } = require('../lib/recursos')
const saida = require('../lib/saida')
const http = require('../lib/http')
const argsLib = require('../lib/args')

async function executar (args, cfg) {
  const sub = args._[1]
  const flags = args.flags

  if (!sub) {
    return {
      texto: [
        'Dominios da mapoteca (GET publico, sem login):',
        ...DOMINIOS.map(s => '  ' + s),
        '',
        'Listar um: mapoteca dominio situacao_pedido',
        '',
        'Os codigos destes dominios sao o que entra nos campos *_id do corpo:',
        'situacao_pedido_id, tipo_cliente_id, tipo_midia_id, forma_entrega_id,',
        'canal_recebimento_id e localizacao_id.'
      ].join('\n')
    }
  }

  if (!DOMINIOS.includes(sub)) {
    throw new Error(
      `Dominio desconhecido: "${sub}". Disponiveis: ${DOMINIOS.join(', ')}.`
    )
  }

  const opcoesSaida = {
    formato: flags.json ? 'json' : (flags.formato || 'tsv'),
    campos: argsLib.lista(flags.campos),
    padrao: ['code', 'nome']
  }

  // GET de dominio e publico: nao gasta login nem token.
  const r = await http.requisitar(cfg, 'GET', `/mapoteca/dominio/${sub}`)
  const out = saida.lista(r.dados, opcoesSaida)
  return { texto: out.texto, avisos: out.avisos }
}

// Sem argumento o comando so lista quais dominios existem, e isso ele sabe sem
// servidor: nao faz sentido exigir SCA_URL para responder.
module.exports = { executar, precisaServidor: args => !!args._[1] }
