'use strict'

// Formatacao da saida. O padrao e COMPACTO, porque o consumidor e um agente com
// janela de contexto finita: a listagem de usuarios traz nove colunas por
// pessoa, e o JSON cru de trinta pessoas e varias vezes o mesmo conteudo em TSV
// recortado.
//
// Regra de ouro: o --json continua existindo e devolve tudo, sem recorte. Quem
// vai encadear (ler um uuid e usar na proxima chamada) usa --json; quem vai LER
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

// Colunas que NUNCA se imprimem, nem truncadas.
//
// Este e o unico CLI cujas respostas encostam em credencial: o POST /login
// devolve `token`, e um corpo de criacao carrega `senha`. A saida de um CLI de
// agente vai para transcricao, log e, com sorte, so para o terminal -- entao o
// valor e substituido aqui, no formatador, e nao em cada chamador. Deixar a
// decisao para o chamador foi o que ja permitiu, noutros lugares, quatro
// acertarem e um esquecer.
// A lista e NOMEADA, e nao um `/^senha/`: `senha_definida` e um booleano
// derivado que a listagem devolve de proposito (false = a pessoa nao consegue
// entrar), e mascarar justamente ele esconderia a resposta em vez do segredo.
const EH_SEGREDO = /^(senha|senha_atual|senha_nova|token)$|_senha$|_token$/

// Colunas tratadas como grandeza numerica na saida legivel.
const EH_CONTAGEM = /^(logins|total|usuarios_ativos|logins_hoje|logins_30_dias)$/

/**
 * Objeto raso de escalares vira `chave=valor;chave=valor`.
 *
 * Existe pelo `perfis`, que e um mapa modulo -> nivel ({ acervo: 1 }) e nao uma
 * coluna por modulo (a escolha e do servidor, para a tela nao mudar quando
 * surgir modulo novo). Renderizado como "{2}", ele diria quantos modulos a
 * pessoa alcanca e nenhum dos nomes -- que e justamente a pergunta.
 */
function objetoRaso (valor) {
  const chaves = Object.keys(valor)
  if (!chaves.length) return '-'
  const raso = chaves.every(k => valor[k] === null || typeof valor[k] !== 'object')
  if (!raso) return `{${chaves.length}}`
  return chaves.map(k => `${k}=${valor[k] === null ? 'null' : valor[k]}`).join(';')
}

function celula (chave, valor) {
  if (EH_SEGREDO.test(chave)) return valor === null || valor === undefined ? '-' : '***'
  if (valor === null || valor === undefined) return '-'
  if (valor === '') return '-'
  if (typeof valor === 'boolean') return valor ? 'sim' : 'nao'
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
  // Instante ISO vira dia + hora curta: `ultimo_login` e a coluna do painel de
  // logados, e ali a HORA e a informacao (ao contrario do acervo, onde a coluna
  // e sempre 00:00 e a hora so custa espaco).
  const iso = texto.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/)
  return iso ? `${iso[1]} ${iso[2]}` : texto
}

/**
 * Decide quais colunas mostrar.
 * Prioridade: --campos explicito > colunas padrao do recurso > todas as chaves.
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
  if (!dados.length) {
    return { texto: '(nenhum registro)', avisos }
  }

  const formato = opcoes.formato || 'tsv'
  if (formato === 'json') {
    return { texto: JSON.stringify(dados, null, 2), avisos }
  }

  const { colunas, faltam } = escolherColunas(dados, opcoes.campos, opcoes.padrao)
  if (faltam.length) {
    avisos.push(
      `Colunas inexistentes neste recurso, ignoradas: ${faltam.join(', ')}. ` +
      'Veja as colunas disponiveis com --json.'
    )
  }

  const texto = formato === 'tabela' ? tabela(dados, colunas) : tsv(dados, colunas)
  const rodape = `\n(${dados.length} registro${dados.length === 1 ? '' : 's'}` +
    `, ${colunas.length} de ${new Set(dados.flatMap(d => Object.keys(d))).size} colunas)`
  return { texto: texto + rodape, avisos }
}

/** Renderiza um registro unico como pares chave: valor. */
function registro (dado, opcoes = {}) {
  if (dado === null || dado === undefined) return '(vazio)'
  if (typeof dado !== 'object') return String(dado)
  if ((opcoes.formato || 'tsv') === 'json') return JSON.stringify(dado, null, 2)

  const chaves = opcoes.campos && opcoes.campos.length
    ? opcoes.campos.filter(c => c in dado)
    : Object.keys(dado)
  if (!chaves.length) return '(vazio)'
  const largura = Math.max(...chaves.map(c => c.length))
  return chaves.map(c => `${c.padEnd(largura)}  ${celula(c, dado[c])}`).join('\n')
}

module.exports = { lista, registro, numero, celula, escolherColunas, tsv, tabela, objetoRaso }
