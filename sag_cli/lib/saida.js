'use strict'

// Formatacao da saida, igual em espirito a dos CLIs irmaos: padrao COMPACTO,
// porque o consumidor e um agente com janela finita. `--json` continua
// existindo e devolve tudo, para quem vai encadear.
//
// Diferenca de nascenca em relacao ao orcamento_cli: o SAG ja devolve valor
// formatado em pt-BR ("20.710,00") e data curta ("05/02/26"). Nao reformatamos
// o que ja chegou pronto; so alinhamos.

function celula (valor) {
  if (valor === null || valor === undefined || valor === '') return '-'
  if (typeof valor === 'boolean') return valor ? 'sim' : 'nao'
  if (typeof valor === 'object') return JSON.stringify(valor)
  return String(valor).replace(/[\t\n\r]+/g, ' ')
}

/** Corta texto longo na saida legivel. O historico de NC passa de 300 caracteres. */
function encurtar (texto, largura) {
  if (!largura || texto.length <= largura) return texto
  return texto.slice(0, largura - 1) + '…'
}

function escolherColunas (linhas, pedidas) {
  const presentes = []
  for (const l of linhas) {
    for (const k of Object.keys(l || {})) if (!presentes.includes(k)) presentes.push(k)
  }
  if (pedidas && pedidas.length) {
    const existem = pedidas.filter(c => presentes.includes(c))
    return { colunas: existem.length ? existem : presentes, faltam: pedidas.filter(c => !presentes.includes(c)) }
  }
  return { colunas: presentes, faltam: [] }
}

function tsv (linhas, colunas) {
  const saida = [colunas.join('\t')]
  for (const l of linhas) saida.push(colunas.map(c => celula(l[c])).join('\t'))
  return saida.join('\n')
}

function tabela (linhas, colunas, largura) {
  const corta = v => encurtar(celula(v), largura)
  const larguras = colunas.map(c =>
    Math.max(c.length, ...linhas.map(l => corta(l[c]).length))
  )
  const cabecalho = colunas.map((c, i) => c.padEnd(larguras[i])).join('  ')
  const regua = larguras.map(w => '-'.repeat(w)).join('  ')
  const corpo = linhas.map(l =>
    colunas.map((c, i) => corta(l[c]).padEnd(larguras[i])).join('  ')
  )
  return [cabecalho, regua, ...corpo].join('\n')
}

/**
 * Renderiza uma lista de registros.
 * @param {Array<Object>} dados
 * @param {{formato?: string, campos?: string[], largura?: number}} opcoes
 */
function lista (dados, opcoes = {}) {
  const avisos = []
  const formato = opcoes.formato || 'tsv'

  if (!Array.isArray(dados)) return { texto: JSON.stringify(dados, null, 2), avisos }

  // O formato decide antes de a lista vazia decidir: com --json, vazio sai como
  // `[]`, nunca como texto, para nao quebrar o JSON.parse de quem encadeia.
  if (!dados.length) {
    return { texto: formato === 'json' ? '[]' : '(nenhum registro)', avisos }
  }
  if (formato === 'json') return { texto: JSON.stringify(dados, null, 2), avisos }

  const { colunas, faltam } = escolherColunas(dados, opcoes.campos)
  if (faltam.length) avisos.push(`Colunas ausentes no resultado: ${faltam.join(', ')}.`)

  const texto = formato === 'tabela'
    ? tabela(dados, colunas, opcoes.largura || 40)
    : tsv(dados, colunas)
  return {
    texto: texto + `\n(${dados.length} registro${dados.length === 1 ? '' : 's'})`,
    avisos
  }
}

/** Renderiza um registro unico como pares chave: valor. */
function registro (dado, opcoes = {}) {
  // O FORMATO decide antes de tudo, pela mesma razao que em lista(): com
  // `--json`, registro ausente sai como `null` e escalar sai como escalar JSON,
  // e nunca como `(vazio)`, que quebraria o `JSON.parse` de quem encadeia
  // justamente no caso mais comum, a consulta que nao achou nada.
  if ((opcoes.formato || 'tsv') === 'json') {
    return JSON.stringify(dado === undefined ? null : dado, null, 2)
  }
  if (dado === null || dado === undefined) return '(vazio)'
  if (typeof dado !== 'object') return String(dado)
  const chaves = Object.keys(dado)
  const largura = Math.max(...chaves.map(c => c.length))
  return chaves.map(c => `${c.padEnd(largura)}  ${celula(dado[c])}`).join('\n')
}

module.exports = { lista, registro, celula, encurtar, escolherColunas, tsv, tabela }
