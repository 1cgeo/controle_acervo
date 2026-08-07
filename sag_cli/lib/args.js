'use strict'

// Parser de argumentos proprio, sem dependencia externa, igual ao dos CLIs
// irmaos. O sag_cli nao instala node_modules: ele so precisa do Node.
//
// Gramatica aceita:
//   sag <comando> [subcomando] [posicionais...] [--flag valor] [--booleana]
//   --flag=valor tambem e aceito
//   --filtro ND=339015 pode repetir; os valores se acumulam
//   -- encerra as flags (tudo depois vira posicional)

// Flags que NAO consomem o proximo argumento (sao booleanas).
const BOOLEANAS = new Set([
  'json',
  'ajuda',
  'help',
  'insecure',
  'sem-cache',
  'todas',
  'so-diferencas'
])

// Flags que podem REPETIR e viram lista. `--filtro` e a unica: uma consulta
// costuma cruzar mais de um seletor (ND e PI, por exemplo), e sobrescrever a
// primeira ocorrencia perderia metade do filtro sem avisar.
const REPETIVEIS = new Set(['filtro'])

/**
 * @param {string[]} argv normalmente process.argv.slice(2)
 * @returns {{_: string[], flags: Object<string, string|boolean|string[]>}}
 */
function parse (argv) {
  const posicionais = []
  const flags = {}
  let soPosicional = false

  const guardar = (nome, valor) => {
    if (!REPETIVEIS.has(nome)) {
      flags[nome] = valor
      return
    }
    if (!Array.isArray(flags[nome])) flags[nome] = []
    flags[nome].push(valor)
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
 * deixar `true` (booleano) vazar para dentro de uma URL.
 */
function exigir (flags, nome, contexto) {
  const valor = flags[nome]
  if (valor === undefined || valor === true || valor === '') {
    throw new Error(`Falta --${nome}${contexto ? ` (${contexto})` : ''}.`)
  }
  return Array.isArray(valor) ? valor[valor.length - 1] : valor
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
  return bruto.split(',').map(s => s.trim()).filter(Boolean)
}

/**
 * Le os `--filtro CAMPO=valor` em { CAMPO: [valores] }.
 *
 * O mesmo CAMPO pode aparecer duas vezes (`--filtro ND=339015 --filtro
 * ND=339030`): no SAG os seletores sao multiplos, e o backend espera
 * `ND[]=x&ND[]=y`. Valor com virgula tambem vira lista, que e como o humano
 * escreve.
 */
function filtros (flags) {
  const bruto = flags.filtro
  if (bruto === undefined || bruto === true) return {}
  const pares = Array.isArray(bruto) ? bruto : [bruto]
  const saida = {}
  for (const par of pares) {
    const igual = String(par).indexOf('=')
    if (igual === -1) {
      throw new Error(
        `--filtro precisa do formato CAMPO=valor (recebi "${par}"). ` +
        'Veja os campos com: sag schema <documento>.'
      )
    }
    const campo = String(par).slice(0, igual).trim()
    const valores = String(par).slice(igual + 1).split(',').map(s => s.trim()).filter(Boolean)
    if (!campo || !valores.length) {
      throw new Error(`--filtro "${par}" nao tem campo ou valor.`)
    }
    if (!saida[campo]) saida[campo] = []
    saida[campo].push(...valores)
  }
  return saida
}

module.exports = { parse, exigir, numero, lista, filtros, BOOLEANAS, REPETIVEIS }
