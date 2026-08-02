'use strict'

// Parser de argumentos proprio, sem dependencia externa. O CLI nao instala
// node_modules: ele so precisa do Node e do server/ (de onde vem o Joi, via os
// arquivos de schema). Manter dependencia zero e o que permite rodar o auth
// num clone recem-baixado sem npm install.
//
// Gramatica aceita:
//   auth <comando> [subcomando] [posicionais...] [--flag valor] [--booleana]
//   --flag=valor tambem e aceito
//   --flag repetida acumula em array (o --conceder do verbo perfis depende disso)
//   -- encerra as flags (tudo depois vira posicional)

// Flags que NAO consomem o proximo argumento (sao booleanas).
const BOOLEANAS = new Set([
  'dry-run',
  'json',
  'ajuda',
  'help',
  'insecure',
  'sem-cache',
  'versao'
])

/**
 * @param {string[]} argv normalmente process.argv.slice(2)
 * @returns {{_: string[], flags: Object<string, string|boolean|string[]>}}
 */
function parse (argv) {
  const posicionais = []
  const flags = {}
  let soPosicional = false

  // Flag repetida vira array em vez de sobrescrever. Sem isto, um
  // `--conceder acervo=2 --conceder mapoteca=1` perderia o primeiro par em
  // silencio, que e a classe de erro mais cara num comando que mexe em acesso.
  const guardar = (nome, valor) => {
    if (!(nome in flags)) {
      flags[nome] = valor
      return
    }
    if (Array.isArray(flags[nome])) flags[nome].push(valor)
    else flags[nome] = [flags[nome], valor]
  }

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
        guardar(corpo.slice(0, igual), corpo.slice(igual + 1))
        continue
      }

      if (BOOLEANAS.has(corpo)) {
        flags[corpo] = true
        continue
      }

      const proximo = argv[i + 1]
      if (proximo === undefined || proximo.startsWith('--')) {
        // Flag desconhecida sem valor: trata como booleana em vez de engolir
        // a proxima flag, que seria um erro silencioso e dificil de achar.
        flags[corpo] = true
        continue
      }

      guardar(corpo, proximo)
      i++
      continue
    }

    posicionais.push(arg)
  }

  return { _: posicionais, flags }
}

/**
 * Le uma flag exigindo valor de texto. Erro claro quando falta, em vez de
 * deixar `true` (booleano) vazar para dentro de uma URL ou de um corpo JSON.
 */
function exigir (flags, nome, contexto) {
  const valor = flags[nome]
  if (valor === undefined || valor === true || valor === '') {
    throw new Error(`Falta --${nome}${contexto ? ` (${contexto})` : ''}.`)
  }
  if (Array.isArray(valor)) {
    throw new Error(`--${nome} foi passada mais de uma vez; use uma so.`)
  }
  return valor
}

/** Le uma flag numerica opcional; devolve `padrao` quando ausente. */
function numero (flags, nome, padrao) {
  const valor = flags[nome]
  if (valor === undefined || valor === true) return padrao
  const n = Number(valor)
  if (!Number.isFinite(n)) {
    throw new Error(`--${nome} precisa ser um numero (recebi "${valor}").`)
  }
  return n
}

/** Divide "a,b,c" em ['a','b','c'], ignorando espacos e itens vazios. */
function lista (valor) {
  if (valor === undefined || valor === true) return null
  const bruto = Array.isArray(valor) ? valor.join(',') : String(valor)
  return bruto
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
}

/** Sempre um array, para flags repetiveis (--conceder, --revogar). */
function repetida (flags, nome) {
  const valor = flags[nome]
  if (valor === undefined || valor === true) return []
  return Array.isArray(valor) ? valor : [valor]
}

module.exports = { parse, exigir, numero, lista, repetida, BOOLEANAS }
