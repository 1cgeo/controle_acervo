'use strict'

// Parser de argumentos proprio, sem dependencia externa. O CLI nao instala
// node_modules: ele so precisa do Node e do server/ (de onde vem o Joi, atraves
// do proprio arquivo de schema). Manter dependencia zero e o que permite rodar o
// equipamento num clone recem-baixado, sem npm install na pasta do CLI.
//
// Gramatica aceita:
//   equipamento <comando> [subcomando] [posicionais...] [--flag valor] [--booleana]
//   --flag=valor tambem e aceito
//   -- encerra as flags (tudo depois vira posicional)

// Flags que NAO consomem o proximo argumento (sao booleanas de verdade).
//
// `--ativo`, `--aberta`, `--transferido_siafi` e as outras booleanas do SCHEMA
// ficam FORA desta lista de proposito: elas aceitam valor (`--ativo false`) e o
// tipo delas nao mora aqui, mora no Joi. Sem valor, o parser ja as devolve como
// `true`, e quem traduz esse `true` para o corpo e o `valorDeFlag` abaixo, que
// consulta o tipo declarado no schema.
//
// `--para` tambem fica fora: ela leva o nome do arquivo de destino.
const BOOLEANAS = new Set([
  'dry-run',
  'json',
  'ajuda',
  'help',
  'insecure',
  'sem-cache'
])

/**
 * @param {string[]} argv normalmente process.argv.slice(2)
 * @returns {{_: string[], flags: Object<string, string|boolean>}}
 */
function parse (argv) {
  const posicionais = []
  const flags = {}
  let soPosicional = false

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]

    if (soPosicional) {
      posicionais.push(arg)
      continue
    }

    if (arg === '--') {
      soPosicional = true
      continue
    }

    if (arg.startsWith('--')) {
      const corpo = arg.slice(2)
      const igual = corpo.indexOf('=')

      if (igual !== -1) {
        // --flag=valor: o valor vem colado, nunca consome o proximo argumento.
        flags[corpo.slice(0, igual)] = corpo.slice(igual + 1)
        continue
      }

      if (BOOLEANAS.has(corpo)) {
        flags[corpo] = true
        continue
      }

      const proximo = argv[i + 1]
      if (proximo === undefined || proximo.startsWith('--')) {
        // Flag desconhecida sem valor: trata como booleana em vez de engolir a
        // proxima flag, que seria um erro silencioso e dificil de achar.
        flags[corpo] = true
        continue
      }

      flags[corpo] = proximo
      i++
      continue
    }

    posicionais.push(arg)
  }

  return { _: posicionais, flags }
}

/**
 * Le uma flag exigindo valor de texto. Erro claro quando falta, em vez de deixar
 * `true` (booleano) vazar para dentro de uma URL ou de um corpo JSON.
 */
function exigir (flags, nome, contexto) {
  const valor = flags[nome]
  if (valor === undefined || valor === true || valor === '') {
    throw new Error(`Falta --${nome}${contexto ? ` (${contexto})` : ''}.`)
  }
  return valor
}

/** Le uma flag numerica opcional; devolve `padrao` quando ausente. */
function numero (flags, nome, padrao) {
  const valor = flags[nome]
  if (valor === undefined || valor === true) return padrao
  const n = Number(valor)
  if (!Number.isFinite(n)) {
    throw new Error(`--${nome} precisa ser um número (recebi "${valor}").`)
  }
  return n
}

/** Divide "a,b,c" em ['a','b','c'], ignorando espacos e itens vazios. */
function lista (valor) {
  if (valor === undefined || valor === true) return null
  return String(valor)
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
}

/** Le uma flag de texto opcional; devolve `padrao` quando ausente ou booleana. */
function texto (flags, nome, padrao = null) {
  const valor = flags[nome]
  if (valor === undefined || valor === true || valor === '') return padrao
  return String(valor)
}

/**
 * Traduz o valor cru de uma flag para o valor que vai no corpo ou na query,
 * usando o TIPO declarado no Joi.
 *
 * Existe por causa de um caso unico e frequente: `--ativo` e `--aberta` sozinhas.
 * O parser as devolve como `true` booleano, e um CLI que so aceitasse texto as
 * descartaria em silencio, deixando a lista sem o filtro que quem digitou
 * acreditava ter posto. Como o tipo vem do schema, um campo booleano novo passa
 * a se comportar assim sem tocar neste arquivo.
 *
 * @param {string|boolean} valor
 * @param {string} tipo notacao curta de lib/schema.js ('bool', 'int>0', ...)
 * @returns {string|boolean|undefined} undefined quando nao ha o que enviar
 */
function valorDeFlag (valor, tipo) {
  if (valor === undefined) return undefined
  if (valor === true) {
    // Flag sozinha: so faz sentido em campo booleano, e ali quer dizer `true`.
    return String(tipo || '').startsWith('bool') ? true : undefined
  }
  return valor
}

module.exports = { parse, exigir, numero, lista, texto, valorDeFlag, BOOLEANAS }
