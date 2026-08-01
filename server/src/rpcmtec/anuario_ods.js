// Path: rpcmtec\anuario_ods.js
'use strict'

// O Anuário Estatístico (Tabela 5.4.9) gerado A PARTIR DA PLANILHA-SEMENTE que
// a DSG recebe, e não redesenhado.
//
// O PROBLEMA que isto resolve. Até 2026-08-01 o .ods era montado do zero, por um
// construtor em `utils/ods_export`: cabeçalho de coluna nosso, largura de coluna
// nossa, formato de número nosso. O resultado tinha os números certos e não era
// o arquivo da DSG -- e o destino dele é uma aba de uma planilha que já existe,
// conferida linha a linha por quem recebe. "Parecido" ali não serve.
//
// COMO FUNCIONA. `modelos/anuario_estatistico_5_4_9.ods` é o arquivo real de
// junho de 2026, versionado como SEMENTE. Gerar é abrir esse ZIP, trocar SÓ o
// texto e o valor das células da matriz dentro de `content.xml`, e reescrever o
// resto byte a byte. Estilo, largura de coluna, célula mesclada, fonte, nota de
// rodapé e o formato numérico que mostra zero como '-' continuam sendo os do
// arquivo original, porque nunca são tocados.
//
// TODA célula de valor da matriz é reescrita, inclusive as que dão zero. Não é
// zelo: deixar de escrever uma célula deixaria ali o número de JUNHO DE 2026, a
// semente, num relatório de outro mês. É o modo de falhar mais perigoso deste
// arquivo, e a única defesa é escrever todas.
//
// O CASAMENTO É POR RÓTULO, e o número de linhas é conferido. Casar por posição
// faria uma linha a mais na semente deslocar a matriz inteira em silêncio, com
// o número da 1:50.000 indo para a linha da 1:25.000.
//
// AS FÓRMULAS DA SEMENTE SÃO SUBSTITUÍDAS POR VALOR, e é deliberado. A planilha
// da DSG traz `=SUM(...)` nas duas linhas de total e, em várias linhas de dado,
// um `Exército = SUM(RM:EE)` na coluna B. As duas coisas assumem que RM e EE
// estão preenchidas, e são justamente as duas colunas que o SCA não sabe
// preencher: mantida, a fórmula zeraria a coluna Exército de toda linha que
// tivesse entrega. Quem preenche o arquivo à mão já digita por cima dessas
// fórmulas (na edição de junho de 2026, toda linha com número tem literal, e só
// as zeradas mantiveram o `=SUM`), então escrever valor é o que a Seção faz.
//
// O QUE ISSO CUSTA, e é real: o arquivo entregue fica todo literal, então
// corrigir uma linha à mão depois NÃO atualiza a linha de total. Quem corrigir
// uma célula corrige o total também.

const fs = require('fs')
const path = require('path')

const { AppError, httpCode } = require('../utils')
const { desziparParaMapa, reescreverOds } = require('../utils/ods_export')

const CAMINHO_SEMENTE = path.join(__dirname, 'modelos', 'anuario_estatistico_5_4_9.ods')

// A primeira coluna é o rótulo; as sete seguintes são os valores, na ordem de
// `anuario_ctrl.COLUNAS_ANUARIO` (Exército, RM, EE do Exército, Outras Forças,
// Órgão Público, Empresa Privada, Prof. Autônomo).
const PRIMEIRA_COLUNA_VALOR = 1
const ULTIMA_COLUNA_VALOR = 7

// --------------------------------------------------------------------------
// XML: leitura e escrita de célula
// --------------------------------------------------------------------------

const escaparXml = texto => String(texto)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')

// O texto visível de uma célula: o conteúdo dos <text:p>, sem marcação.
const textoDaCelula = xml => {
  const paragrafos = xml.match(/<text:p[^>]*>([\s\S]*?)<\/text:p>/g) || []
  return paragrafos
    .map(p => p.replace(/<[^>]+>/g, ''))
    .join(' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim()
}

const estiloDaCelula = xml => {
  const achado = xml.match(/table:style-name="([^"]*)"/)
  return achado ? achado[1] : null
}

/**
 * Uma célula nova, herdando o ESTILO da que estava no lugar.
 *
 * Número vira célula float, e é ela que o formato da semente renderiza (um zero
 * aparece como '-' porque o estilo manda, não porque escrevemos '-').
 *
 * `null` é o valor que o SCA declara NÃO SABER (as colunas RM e EE do Exército,
 * que o cadastro de cliente não separa). Vira célula de TEXTO com '-': na tela
 * fica idêntica ao zero formatado da semente, e no conteúdo não afirma um zero
 * que ninguém apurou.
 */
const montarCelula = (estilo, valor) => {
  const atributoEstilo = estilo ? ` table:style-name="${estilo}"` : ''

  if (valor == null) {
    return `<table:table-cell${atributoEstilo}><text:p>-</text:p></table:table-cell>`
  }

  const numero = Number(valor)
  return `<table:table-cell${atributoEstilo} office:value-type="float" ` +
    `office:value="${numero}" calcext:value-type="float">` +
    `<text:p>${escaparXml(numero)}</text:p></table:table-cell>`
}

// --------------------------------------------------------------------------
// XML: a linha
// --------------------------------------------------------------------------

// Quebra o conteúdo de uma <table:table-row> na lista de células, na ordem.
// Célula não aninha célula, então o casamento não ambíguo abaixo basta; ele
// cobre tanto a forma vazia (<table:table-cell/>) quanto a com conteúdo.
const CELULA = /<(table:table-cell|table:covered-table-cell)\b([^>]*?)(\/>|>[\s\S]*?<\/\1>)/g

const REPETICAO = /\s*table:number-columns-repeated="(\d+)"/

const fatiarCelulas = xmlDaLinha => {
  const celulas = []
  let ultimoFim = 0
  let achado

  CELULA.lastIndex = 0
  while ((achado = CELULA.exec(xmlDaLinha)) !== null) {
    if (achado.index > ultimoFim) {
      // Texto entre células (espaço em branco): guardado para sair igual.
      celulas.push({ literal: xmlDaLinha.slice(ultimoFim, achado.index) })
    }
    const xml = achado[0]
    const repeticao = xml.match(REPETICAO)
    celulas.push({ xml, repeticao: repeticao ? parseInt(repeticao[1], 10) : 1 })
    ultimoFim = achado.index + xml.length
  }
  if (ultimoFim < xmlDaLinha.length) {
    celulas.push({ literal: xmlDaLinha.slice(ultimoFim) })
  }
  return celulas
}

/**
 * Reescreve as colunas de valor de uma linha, preservando tudo o mais.
 *
 * Uma célula com `number-columns-repeated` que cai DENTRO da faixa de valores é
 * desdobrada em células individuais, senão trocar a coluna 3 mudaria também a 4
 * e a 5. O desdobramento para na última coluna de valor: a repetição gigante do
 * fim da linha (a que preenche as mil colunas restantes) sai intacta, e é o que
 * impede o arquivo de inchar.
 *
 * @param {string} xmlDaLinha - o conteúdo interno de <table:table-row>
 * @param {Array<number|null>} valores - um por coluna de valor, na ordem
 * @returns {string}
 */
const reescreverLinha = (xmlDaLinha, valores) => {
  const partes = []
  let coluna = 0

  for (const pedaco of fatiarCelulas(xmlDaLinha)) {
    if (pedaco.literal != null) {
      partes.push(pedaco.literal)
      continue
    }

    const inicio = coluna
    const fim = coluna + pedaco.repeticao - 1
    coluna += pedaco.repeticao

    const intersecta = fim >= PRIMEIRA_COLUNA_VALOR && inicio <= ULTIMA_COLUNA_VALOR
    if (!intersecta) {
      partes.push(pedaco.xml)
      continue
    }

    const estilo = estiloDaCelula(pedaco.xml)
    const semRepeticao = pedaco.xml.replace(REPETICAO, '')

    for (let c = inicio; c <= fim; c++) {
      if (c < PRIMEIRA_COLUNA_VALOR) {
        partes.push(semRepeticao)
      } else if (c <= ULTIMA_COLUNA_VALOR) {
        partes.push(montarCelula(estilo, valores[c - PRIMEIRA_COLUNA_VALOR]))
      } else {
        // O resto da repetição volta como uma repetição só.
        const quantas = fim - c + 1
        partes.push(quantas > 1
          ? semRepeticao.replace(/(<table:(?:covered-)?table-cell\b)/, `$1 table:number-columns-repeated="${quantas}"`)
          : semRepeticao)
        break
      }
    }
  }

  return partes.join('')
}

// --------------------------------------------------------------------------
// A planilha
// --------------------------------------------------------------------------

const LINHA = /<table:table-row\b([^>]*)>([\s\S]*?)<\/table:table-row>/g

/**
 * Gera o .ods do Anuário a partir da semente.
 *
 * @param {Object} anuario - o que anuario_ctrl.getAnuarioEstatistico devolve
 * @param {Array<{key:string}>} colunas - COLUNAS_ANUARIO, na ordem da planilha
 * @param {Array<Object>} linhas - as linhas na ordem da planilha (paraPlanilha)
 * @returns {Buffer}
 */
const gerarAnuarioOds = (anuario, colunas, linhas) => {
  const semente = fs.readFileSync(CAMINHO_SEMENTE)
  const conteudo = desziparParaMapa(semente).get('content.xml').toString('utf8')

  // Uma fila por rótulo: a semente repete "Escala 1:250 000" nos dois blocos
  // (Convencional e Digital), e casar pelo rótulo sozinho jogaria os dois
  // valores na primeira ocorrência. Consumindo em ordem, a primeira vez que o
  // rótulo aparece recebe a linha do bloco Convencional e a segunda a do
  // Digital, que é a ordem em que `paraPlanilha` os entrega.
  const pendentes = new Map()
  for (const linha of linhas) {
    if (!pendentes.has(linha.rotulo)) pendentes.set(linha.rotulo, [])
    pendentes.get(linha.rotulo).push(linha)
  }

  // O título traz o ANO por extenso, duas vezes ("O Exército em Números 2026
  // ... em 2026."), e a semente é a de junho de 2026. Sem esta troca, o Anuário
  // de 2027 sairia anunciando 2026 no cabeçalho. O texto que o controller monta
  // é palavra por palavra o da semente, mudando só o ano.
  const tituloDaSemente = conteudo.match(/<text:p>(O Exército em Números[^<]*)<\/text:p>/)
  if (!tituloDaSemente) {
    throw new AppError(
      'A planilha-semente do Anuário não tem a linha de título esperada',
      httpCode.InternalServerError
    )
  }
  const comTitulo = conteudo.replace(
    tituloDaSemente[0],
    `<text:p>${escaparXml(anuario.titulo)}</text:p>`
  )

  let escritas = 0
  LINHA.lastIndex = 0
  const novoConteudo = comTitulo.replace(LINHA, (inteiro, atributos, interno) => {
    const celulas = fatiarCelulas(interno).filter(p => p.literal == null)
    if (celulas.length === 0) return inteiro

    const rotulo = textoDaCelula(celulas[0].xml)
    const fila = pendentes.get(rotulo)
    if (!fila || fila.length === 0) return inteiro

    const linha = fila.shift()
    escritas += 1
    const valores = colunas.map(coluna => linha[coluna.key])
    return `<table:table-row${atributos}>${reescreverLinha(interno, valores)}</table:table-row>`
  })

  // A semente TEM de ter uma linha para cada rótulo. Sem esta conferência, uma
  // semente trocada por engano (ou uma linha renomeada pela DSG) geraria um
  // arquivo silenciosamente incompleto, com o mês anterior em algumas linhas.
  const faltantes = [...pendentes.entries()]
    .filter(([, fila]) => fila.length > 0)
    .map(([rotulo, fila]) => `${rotulo} (${fila.length}x)`)

  if (faltantes.length > 0) {
    throw new AppError(
      'A planilha-semente do Anuário não tem todas as linhas esperadas: ' +
      faltantes.join(', '),
      httpCode.InternalServerError
    )
  }
  if (escritas !== linhas.length) {
    throw new AppError(
      `O Anuário escreveu ${escritas} linhas para ${linhas.length} esperadas`,
      httpCode.InternalServerError
    )
  }

  return reescreverOds(semente, { 'content.xml': novoConteudo })
}

module.exports = { gerarAnuarioOds, CAMINHO_SEMENTE }
