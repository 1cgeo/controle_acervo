'use strict'

// O CONTRATO SAI DA PAGINA VIVA, e nao de uma tabela mantida aqui.
//
// Mesmo principio do orcamento_cli, que le o Joi do server/ em tempo de
// execucao: coluna, filtro e valor de dominio do SAG mudam quando o SAG muda, e
// uma copia neste repo comecaria a mentir no dia seguinte sem ninguem notar. O
// custo e uma ida a rede por consulta de contrato; o beneficio e que o CLI
// nunca oferece uma coluna que nao existe mais.
//
// O SAG monta cada tela de documento com a mesma anatomia:
//   <select id="coluna" name="coluna[]">   as colunas que a consulta pode trazer
//   <select name="ND[]"> ...               um seletor por dimensao filtravel
//   <input name="DATAINI"> ...             filtros de texto e de periodo
// Ler isso e ler o contrato.

// Acento como marca combinante. Com isto, `&Uacute;` vira 'U' + a marca de
// agudo, e o normalize('NFC') junta os dois em 'U com acento'. Uma linha por
// familia de acento resolve as 60 entidades nomeadas do latin-1, em vez de uma
// tabela de 60 entradas que alguem teria de manter.
const MARCA = {
  acute: '́',
  grave: '̀',
  circ: '̂',
  tilde: '̃',
  uml: '̈',
  ring: '̊',
  cedil: '̧'
}

// As que nao sao letra mais acento. `&ordm;` aparece em "1&ordm; CGEO", que e
// como o SAG escreve o nome da unidade.
const SOLTAS = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  ordm: 'º',
  ordf: 'ª',
  deg: '°',
  ccedil: 'ç',
  Ccedil: 'Ç'
}

/**
 * Entidades HTML dos rotulos do SAG.
 *
 * A tela costuma vir com o acento em byte literal (ISO-8859-1), e nesse caso
 * nada aqui se aplica. Mas parte dos rotulos usa entidade nomeada, e sem
 * decodificar o nome da coluna chegaria como "N&Uacute;MERO NC" na saida e, o
 * que e pior, dentro do campo que iria para o SCA.
 */
function decodificar (texto) {
  return String(texto)
    .replace(/&([A-Za-z])(acute|grave|circ|tilde|uml|ring|cedil);/g,
      (inteiro, letra, tipo) => (letra + MARCA[tipo]).normalize('NFC'))
    .replace(/&([A-Za-z]+);/g, (inteiro, nome) =>
      Object.prototype.hasOwnProperty.call(SOLTAS, nome) ? SOLTAS[nome] : inteiro)
    .replace(/&#0?39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .trim()
}

/** Tira marcacao de uma celula. O SAG devolve botao dentro do valor. */
function semTags (texto) {
  return decodificar(String(texto).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
}

/** Recorta o conteudo de cada <select>, com id, name e multiple. */
function selects (html) {
  const achados = []
  const re = /<select\b([^>]*)>([\s\S]*?)<\/select>/gi
  let m
  while ((m = re.exec(html)) !== null) {
    const atributos = m[1]
    const pegar = nome => {
      const a = new RegExp(nome + '\\s*=\\s*["\']([^"\']*)["\']', 'i').exec(atributos)
      return a ? a[1] : null
    }
    achados.push({
      id: pegar('id'),
      name: pegar('name'),
      multiplo: /\bmultiple\b/i.test(atributos),
      interior: m[2]
    })
  }
  return achados
}

/** Opcoes de um <select>: valor, rotulo e se ja vem marcada. */
function opcoes (interior) {
  const saida = []
  const re = /<option\b([^>]*)>([\s\S]*?)(?:<\/option>|(?=<option)|$)/gi
  let m
  while ((m = re.exec(interior)) !== null) {
    const atributos = m[1]
    const valor = /value\s*=\s*["']([^"']*)["']/i.exec(atributos)
    if (!valor) continue
    saida.push({
      valor: valor[1],
      rotulo: semTags(m[2]),
      marcada: /\bselected\b/i.test(atributos)
    })
  }
  return saida
}

/** Campos de texto do formulario de filtro. */
function inputs (html) {
  const saida = []
  const re = /<input\b([^>]*)>/gi
  let m
  while ((m = re.exec(html)) !== null) {
    const atributos = m[1]
    const pegar = nome => {
      const a = new RegExp(nome + '\\s*=\\s*["\']([^"\']*)["\']', 'i').exec(atributos)
      return a ? a[1] : null
    }
    const name = pegar('name')
    const tipo = (pegar('type') || 'text').toLowerCase()
    if (!name || tipo === 'hidden' || tipo === 'checkbox' || tipo === 'radio') continue
    // O campo de busca da propria tela nao e filtro da consulta.
    if (name === 'searchInput' || pegar('id') === 'searchInput') continue
    saida.push({
      nome: name,
      rotulo: decodificar(pegar('placeholder') || name),
      obrigatorio: /\brequired\b/i.test(atributos)
    })
  }
  return saida
}

/**
 * Le o contrato de uma tela de documento.
 *
 * @param {string} html a pagina /php/<pagina>.php ja decodificada
 * @returns {{colunas: Array, filtros: Array, textos: Array, padraoDaPagina: string[]}}
 */
function ler (html) {
  const todos = selects(html)
  const seletorColuna = todos.find(s => s.id === 'coluna' || s.name === 'coluna[]')

  if (!seletorColuna) {
    throw new Error(
      'Esta tela do SAG nao tem o seletor de colunas que as telas de documento tem. ' +
      'Ou a pagina mudou, ou este nao e um documento consultavel por este CLI.'
    )
  }

  const colunas = opcoes(seletorColuna.interior).map(o => ({
    campo: o.valor,
    rotulo: o.rotulo,
    marcada: o.marcada
  }))

  const filtros = todos
    .filter(s => s !== seletorColuna && s.name && s.name !== 'filtro[]')
    .map(s => {
      const lista = opcoes(s.interior).filter(o => o.valor !== '')
      return {
        // O name vem como "ND[]"; o campo e "ND".
        campo: s.name.replace(/\[\]$/, ''),
        multiplo: s.multiplo,
        valores: lista.map(o => ({ valor: o.valor, rotulo: o.rotulo }))
      }
    })
    .filter(f => f.valores.length)

  return {
    colunas,
    filtros,
    textos: inputs(html),
    padraoDaPagina: colunas.filter(c => c.marcada).map(c => c.campo)
  }
}

/**
 * Confere os campos pedidos contra o contrato e devolve o que sobra.
 * Campo inexistente vira ERRO, e nao coluna vazia: uma consulta que devolve
 * coluna em branco parece dado ausente no SAG, e nao erro de digitacao.
 */
function conferirColunas (contrato, pedidas) {
  const existem = new Set(contrato.colunas.map(c => c.campo))
  const faltam = pedidas.filter(c => !existem.has(c))
  if (faltam.length) {
    throw new Error(
      `Coluna inexistente nesta tela do SAG: ${faltam.join(', ')}.\n` +
      `Disponiveis: ${[...existem].join(', ')}`
    )
  }
  return pedidas
}

/** Mesma conferencia para os filtros, com o detalhe de aceitar campo de texto. */
function conferirFiltros (contrato, filtros) {
  const seletores = new Map(contrato.filtros.map(f => [f.campo, f]))
  const textos = new Set(contrato.textos.map(t => t.nome))
  const avisos = []

  for (const [campo, valores] of Object.entries(filtros)) {
    if (textos.has(campo)) continue
    const seletor = seletores.get(campo)
    if (!seletor) {
      throw new Error(
        `Filtro inexistente nesta tela do SAG: "${campo}".\n` +
        `Seletores: ${[...seletores.keys()].join(', ')}\n` +
        `Campos de texto: ${[...textos].join(', ')}`
      )
    }
    const aceitos = new Set(seletor.valores.map(v => v.valor))
    const fora = valores.filter(v => !aceitos.has(v))
    if (fora.length) {
      // Aviso, e nao erro: o SAG as vezes aceita valor que a tela nao lista
      // (codigo antigo, de exercicio anterior). Barrar aqui esconderia dado
      // que existe. Mas passar calado esconderia o erro de digitacao.
      avisos.push(
        `O filtro ${campo} recebeu valor fora da lista da tela: ${fora.join(', ')}. ` +
        'Vai assim mesmo; se voltar vazio, foi por isto.'
      )
    }
  }
  return avisos
}

module.exports = { ler, opcoes, selects, inputs, semTags, decodificar, conferirColunas, conferirFiltros }
