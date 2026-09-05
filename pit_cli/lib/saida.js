'use strict'

// Formatacao da saida. O padrao e COMPACTO, porque o consumidor e um agente com
// janela de contexto finita: a grade do PIT tem uma linha por meta e doze meses
// por linha, e o JSON cru dela e varias vezes o mesmo conteudo em TSV recortado.
//
// Regra de ouro: o --json continua existindo e devolve tudo, sem recorte. Quem
// vai encadear (ler um id e usar na proxima chamada) usa --json; quem vai LER
// usa o padrao.

/** Formata numero com separador de milhar pt-BR; devolve o resto intacto. */
function numero (v, casas = 0) {
  if (v === null || v === undefined || v === '') return '-'
  const n = Number(v)
  if (!Number.isFinite(n)) return String(v)
  const [inteiro, decimal] = Math.abs(n).toFixed(casas).split('.')
  const grupos = inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${n < 0 ? '-' : ''}${grupos}${decimal ? ',' + decimal : ''}`
}

// Colunas tratadas como contagem na saida legivel.
const EH_CONTAGEM = /^(quantidade|efetivo_capacitado|metas|revisoes|total|dias)/

/**
 * Objeto raso de escalares vira `chave=valor;chave=valor`.
 *
 * Existe pela celula da grade e pelo resumo do efetivo, que devolvem objetos
 * pequenos ({ planejado, realizado }). Renderizados como "{2}", eles diriam
 * quantas chaves ha e nenhum dos numeros, que e justamente a pergunta.
 */
function objetoRaso (valor) {
  const chaves = Object.keys(valor)
  if (!chaves.length) return '-'
  const raso = chaves.every(k => valor[k] === null || typeof valor[k] !== 'object')
  if (!raso) return `{${chaves.length}}`
  return chaves.map(k => `${k}=${valor[k] === null ? 'null' : valor[k]}`).join(';')
}

function celula (chave, valor) {
  if (valor === null || valor === undefined) return '-'
  if (valor === '') return '-'
  if (typeof valor === 'boolean') return valor ? 'sim' : 'não'
  if (EH_CONTAGEM.test(chave)) return numero(valor)
  // Array curto de escalares cabe inteiro; array de objetos vira so a contagem,
  // senao uma linha de TSV explode a janela.
  if (Array.isArray(valor)) {
    if (!valor.length) return '-'
    if (valor.every(v => v === null || typeof v !== 'object')) return valor.join(';')
    return `[${valor.length}]`
  }
  if (typeof valor === 'object') return objetoRaso(valor)
  const texto = String(valor)
  // Datas ISO com hora viram so a data: a hora nao ajuda a ler plano anual, e o
  // dia de calendario ja vem como texto puro das colunas ::text do servidor.
  const iso = texto.match(/^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}/)
  return iso ? iso[1] : texto
}

/**
 * Decide quais colunas mostrar.
 * Prioridade: --campos explicito > colunas padrao da operacao > todas as chaves.
 * Coluna pedida que nao existe no dado vira aviso, nunca coluna vazia silenciosa.
 */
function escolherColunas (linhas, pedidas, padrao) {
  const presentes = new Set()
  for (const l of linhas) {
    if (l && typeof l === 'object') Object.keys(l).forEach(k => presentes.add(k))
  }

  if (pedidas && pedidas.length) {
    const existem = pedidas.filter(c => presentes.has(c))
    const faltam = pedidas.filter(c => !presentes.has(c))
    return { colunas: existem.length ? existem : [...presentes], faltam }
  }

  if (padrao && padrao.length) {
    const existem = padrao.filter(c => presentes.has(c))
    if (existem.length) return { colunas: existem, faltam: [] }
  }

  return { colunas: [...presentes], faltam: [] }
}

/** TSV: uma linha de cabecalho e uma por registro. O formato mais barato que ainda e legivel. */
function tsv (linhas, colunas) {
  const saida = [colunas.join('\t')]
  for (const l of linhas) {
    saida.push(colunas.map(c => celula(c, l[c])).join('\t'))
  }
  return saida.join('\n')
}

/** Tabela alinhada por espacos: mais legivel para humano, um pouco mais cara. */
function tabela (linhas, colunas) {
  const larguras = colunas.map(c =>
    Math.max(c.length, ...linhas.map(l => celula(c, l[c]).length))
  )
  const cabecalho = colunas.map((c, i) => c.padEnd(larguras[i])).join('  ')
  const regua = larguras.map(w => '-'.repeat(w)).join('  ')
  const corpo = linhas.map(l =>
    colunas.map((c, i) => celula(c, l[c]).padEnd(larguras[i])).join('  ')
  )
  return [cabecalho, regua, ...corpo].join('\n')
}

/**
 * Renderiza uma lista de registros.
 * @param {Array<Object>} dados
 * @param {{formato?: string, campos?: string[], padrao?: string[]}} opcoes
 * @returns {{texto: string, avisos: string[]}}
 */
function lista (dados, opcoes = {}) {
  const avisos = []

  if (!Array.isArray(dados)) {
    return { texto: JSON.stringify(dados, null, 2), avisos }
  }

  // O FORMATO decide antes de a lista vazia decidir: com `--json`, resultado
  // vazio sai como `[]`, e nunca como `(nenhum registro)`, que quebraria o
  // `JSON.parse` de quem encadeia justamente no caso mais comum, a consulta que
  // nao achou nada.
  const formato = opcoes.formato || 'tsv'

  if (!dados.length) {
    return { texto: formato === 'json' ? '[]' : '(nenhum registro)', avisos }
  }

  if (formato === 'json') {
    return { texto: JSON.stringify(dados, null, 2), avisos }
  }

  // Lista de ESCALARES, e nao de registros: e o que as rotas /anos devolvem
  // (uma lista de anos). Sem este ramo, escolherColunas nao acharia chave
  // nenhuma e a saida sairia em branco, que e o pior jeito de dizer "tem dado".
  if (dados.every(d => d === null || typeof d !== 'object')) {
    return {
      texto: dados.join('\n') + `\n(${dados.length} valor${dados.length === 1 ? '' : 'es'})`,
      avisos
    }
  }

  const { colunas, faltam } = escolherColunas(dados, opcoes.campos, opcoes.padrao)
  if (faltam.length) {
    avisos.push(
      `Colunas inexistentes nesta resposta, ignoradas: ${faltam.join(', ')}. ` +
      'Veja as colunas disponíveis com --json.'
    )
  }

  const texto = formato === 'tabela' ? tabela(dados, colunas) : tsv(dados, colunas)
  const rodape = `\n(${dados.length} registro${dados.length === 1 ? '' : 's'}` +
    `, ${colunas.length} de ${new Set(dados.flatMap(d => Object.keys(d))).size} colunas)`
  return { texto: texto + rodape, avisos }
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

  const chaves = opcoes.campos && opcoes.campos.length
    ? opcoes.campos.filter(c => c in dado)
    : Object.keys(dado)
  if (!chaves.length) return '(vazio)'
  const largura = Math.max(...chaves.map(c => c.length))
  return chaves.map(c => `${c.padEnd(largura)}  ${celula(c, dado[c])}`).join('\n')
}

module.exports = { lista, registro, numero, celula, escolherColunas, tsv, tabela, objetoRaso }
