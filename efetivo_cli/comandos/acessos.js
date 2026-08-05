'use strict'

// `efetivo acessos ...` - o historico de acesso (dgeo.login), so leitura.
//
//   efetivo acessos resumo
//   efetivo acessos logados
//   efetivo acessos logins dia       [--total 14]
//   efetivo acessos logins mes       [--total 12]
//   efetivo acessos logins usuarios  [--total 30] [--max 10]
//   efetivo acessos logins clientes  [--total 30]
//
// Duas decisoes valem explicar:
//
// 1. `total` e `max` sao validados LOCALMENTE contra o Joi de acessos_schema.js
//    antes de sair da maquina. O default e o teto de cada rota vivem SO la (o
//    servidor nao os repete no controlador, de proposito), entao le-los daqui e
//    o que permite dizer "o teto de dias e 366" sem copiar o numero.
//
// 2. Nao ha teto proprio no CLI. Se o schema afrouxar ou apertar, a mensagem
//    daqui muda no mesmo commit.

const { obter, obterOperacao } = require('../lib/recursos')
const esquema = require('../lib/schema')
const saida = require('../lib/saida')
const http = require('../lib/http')
const argsLib = require('../lib/args')

// Os recortes de `logins`, na ordem em que a tela os mostra. São os MESMOS que
// a tela usa, de propósito: a série mensal e a série por cliente existiam só
// aqui, ninguém as pedia, e uma leitura que nenhuma tela mostra envelhece sem
// que ninguém perceba.
const SERIES = {
  dia: 'logins-dia',
  usuarios: 'logins-usuarios'
}

function resolverOperacao (args) {
  const acao = args._[1]

  if (!acao) return null

  if (acao === 'logins') {
    const serie = args._[2]
    if (!serie) {
      throw new Error(
        'efetivo acessos logins exige o recorte: ' + Object.keys(SERIES).join(', ') + '.\n' +
        '  ex.: efetivo acessos logins dia --total 30'
      )
    }
    const nome = SERIES[serie]
    if (!nome) {
      throw new Error(
        `Recorte desconhecido "${serie}". Use: ${Object.keys(SERIES).join(', ')}.`
      )
    }
    return nome
  }

  return acao
}

async function executar (args, cfg) {
  const flags = args.flags
  const rec = obter('acessos')
  const modulo = rec.schema()

  const nome = resolverOperacao(args)
  if (!nome) {
    return {
      texto: [
        'acessos - ' + rec.nome,
        '',
        'operacoes:',
        '  resumo                       usuarios ativos, logins de hoje e dos 30 dias',
        '  logados                      quem entrou HOJE, por usuario e cliente',
        '  logins dia       [--total]   um ponto por dia (dia sem login sai zero)',
        '  logins mes       [--total]   um ponto por mes',
        '  logins usuarios  [--total] [--max]   quem mais entrou',
        '  logins clientes  [--total]   web contra QGIS',
        '',
        'Todas exigem ADMINISTRADOR: isto e rota de plataforma, nao de modulo.',
        'contrato completo: efetivo schema acessos'
      ].join('\n')
    }
  }

  const { operacao } = obterOperacao('acessos', nome)

  const opcoesSaida = {
    formato: flags.json ? 'json' : (flags.formato || 'tsv'),
    campos: argsLib.lista(flags.campos),
    padrao: operacao.colunas
  }

  // ---- query -------------------------------------------------------------
  let sufixo = ''
  const avisos = []
  if (operacao.query) {
    const aceitos = esquema.camposDe(modulo[operacao.query]).map(c => c.nome)
    const params = {}
    for (const chave of aceitos) {
      if (flags[chave] !== undefined && flags[chave] !== true) params[chave] = flags[chave]
    }

    const r = esquema.validarQuery(modulo[operacao.query], params)
    if (!r.ok) {
      const erro = new Error(esquema.explicarErro(
        modulo[operacao.query], r.erros,
        `filtros aceitos: ${aceitos.join(', ')}   (contrato: efetivo schema acessos)`,
        'Filtro de query invalido'
      ))
      erro.jaFormatado = true
      throw erro
    }

    // Reenvia so o que foi passado: o default do Joi ja e aplicado no servidor,
    // e mandar tudo poluiria a URL sem mudar a resposta.
    const enviar = {}
    for (const chave of Object.keys(params)) enviar[chave] = r.valor[chave]
    sufixo = http.query(enviar)
  } else if (flags.total !== undefined || flags.max !== undefined) {
    avisos.push(`${nome} nao aceita --total nem --max; foram ignorados.`)
  }

  const caminho = operacao.caminho + sufixo

  if (flags['dry-run']) {
    return { texto: `[dry-run] nada foi enviado. Seria: GET /api${caminho}   (exige ADMINISTRADOR)`, avisos }
  }

  const r = await http.autenticada(cfg, 'GET', caminho)

  if (operacao.envelope === 'registro') {
    return { texto: saida.registro(r.dados, { ...opcoesSaida, padrao: null }), avisos }
  }
  const out = saida.lista(r.dados, opcoesSaida)
  return { texto: out.texto, avisos: [...avisos, ...out.avisos] }
}

/**
 * `efetivo acessos` sozinho lista as operacoes, e errar o nome do recorte tambem se
 * responde sem sair da maquina: os dois sao conhecimento do repo e nao podem
 * exigir SCA_URL. Pedir configuracao para dizer "esse recorte nao existe" seria
 * trocar uma resposta util por uma exigencia. O --dry-run idem, porque a query
 * ja foi validada contra o Joi local.
 */
function precisaServidor (args) {
  if (args.flags['dry-run'] === true) return false
  if (!args._[1]) return false
  try {
    obterOperacao('acessos', resolverOperacao(args))
  } catch (e) {
    return false
  }
  return true
}

module.exports = { executar, precisaServidor }
