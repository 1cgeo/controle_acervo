// Path: rpcmtec\rpcmtec_docx.js
'use strict'

// A FORMATAÇÃO do RPCMTec, medida no documento que a Divisão usa hoje
// ("RPCM Técnico Julho_2026.docx", conferido em 2026-08-01). Cada constante
// abaixo é um valor LIDO do OOXML daquele arquivo, não uma escolha nossa: o
// documento gerado tem de poder ser colado no RPCMTec mestre sem ninguém
// reformatar tabela nenhuma.
//
// POR QUE ARQUIVO SEPARADO, e não dentro do `_ctrl` como manda o padrão de 4
// arquivos do CLAUDE.md: isto é apresentação, e o ctrl é dado. Juntos dariam um
// arquivo de mais de mil linhas em que a regra de negócio (o que conta como
// pedido entregue) fica misturada com a cor do cabeçalho da tabela. O `_ctrl`
// não importa este arquivo; quem os junta é a rota.
//
// O QUE FOI MEDIDO (unidades do OOXML: twip para distância, meio-ponto para
// fonte, oitavo de ponto para borda):
//
//   página        12240 x 15840 twip (Letter), margens 990 topo / 1440 nos
//                 outros três lados, cabeçalho e rodapé a 720
//   fonte         Calibri em tudo o que se vê. O `docDefaults` do modelo diz
//                 Arial 11, mas NENHUMA execução visível o usa: todas as
//                 redefinem para Calibri. Aqui o default já nasce Calibri, e
//                 cada execução ainda a declara, para o arquivo não depender do
//                 que o Word resolver herdar.
//   título        seção "2. EXECUÇÃO DO PIT": 12pt NEGRITO, justificado
//                 subseção "2.2. Totais do Mês e do Ano": 12pt normal, idem
//   tabela        largura ~9840 twip, recuo -141 (ela avança sobre a margem
//                 esquerda de propósito), layout FIXO
//   cabeçalho     preenchimento DDD9C4, 12pt negrito, centrado, alinhamento
//   da tabela     vertical ao centro, altura mínima 431, repete em toda página
//   corpo         10pt, centrado, alinhamento vertical ao centro
//   bordas        linha simples preta de 1pt (sz 8) nos quatro lados
//
// O modelo tem uma grade de coluna PRÓPRIA por tabela, e elas não são
// proporcionais entre si: a coluna "Finalidade" da 4.2 é larga porque o texto é
// longo, e a "Qtd" da 3.3 é estreita porque cabe um número. Por isso a grade vai
// declarada em cada tabela (GRADES, abaixo), copiada do modelo, em vez de
// distribuída por igual.

const {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  AlignmentType,
  VerticalAlign,
  BorderStyle,
  ShadingType,
  TableLayoutType,
  HeightRule,
  LineRuleType,
  Header,
  PageNumber
} = require('docx')

const FONTE = 'Calibri'

// Meio-pontos, como o OOXML guarda (w:sz). 24 = 12pt, 20 = 10pt.
const TAMANHO_TITULO = 24
const TAMANHO_CORPO_TABELA = 20
const TAMANHO_CABECALHO_PAGINA = 20

const PREENCHIMENTO_CABECALHO = 'DDD9C4'

// Oitavos de ponto: 8 = 1pt, que é a espessura das bordas do modelo.
const BORDA = { style: BorderStyle.SINGLE, size: 8, color: '000000' }
const BORDAS_CELULA = { top: BORDA, bottom: BORDA, left: BORDA, right: BORDA }

const LARGURA_TABELA = 9840
const RECUO_TABELA = -141
const ALTURA_MINIMA_CABECALHO = 431

// Entrelinha simples (w:line="240" w:lineRule="auto"), que é o que o modelo usa
// dentro das células. Fora delas o documento herda 276 (1,15), e é por isso que
// os parágrafos de título não declaram espaçamento nenhum.
const ENTRELINHA_CELULA = { line: 240, lineRule: LineRuleType.AUTO }

// A grade de coluna de cada tabela, em twip, COPIADA do modelo. A chave é o
// número da subseção. Uma tabela sem entrada aqui cai na divisão por igual, que
// é o certo para tabela que o modelo não tem (nenhuma, hoje).
const GRADES = {
  // SEM a 2.2 e a 2.4: por enquanto elas nao vem do SCA (chefe, 2026-08-01).
  '2.7': [1380, 1755, 2070, 1515, 1515, 1515],
  '3.1': [5010, 2580, 2175],
  '3.2': [2040, 3345, 2010, 2415],
  // SEM a 3.3 (Extra-PIT): o SCA nao a gera. Ver rpcmtec_ctrl.js.
  // A 3.4 tem QUATRO colunas aqui, e tres no modelo: em 2026-08-01 saiu o
  // "Documento de solicitacao" e entraram o codigo da LAI (o NUP do Fala.BR) e a
  // descricao. A Descricao e a mais larga porque e prosa; a largura total
  // continua a do modelo, 9825, para a tabela nascer do tamanho das vizinhas.
  '3.4': [2040, 2400, 3200, 2185],
  '4.1': [1388, 2151, 1388, 1638, 1638, 1637],
  '4.2': [855, 855, 840, 2865, 1125, 1170, 1140, 945],
  '4.3': [2040, 2670, 2100, 3000],
  '4.4': [2340, 3150, 2145, 2205],
  '4.5': [2535, 2955, 2145, 2205],
  '4.6': [1965, 2685, 1755, 3435],
  '4.7': [855, 870, 840, 2295, 1185, 1245, 1485, 1050],
  // 7.2 e 7.3 dividem a mesma grade: no modelo a 7.3 quebrava as tintas em uma
  // coluna por plotter (HP 70 / HP 72 / HP 730), e aqui cada cartucho é uma
  // LINHA própria de `mapoteca.tipo_material`, então as duas tabelas têm as
  // mesmas cinco colunas.
  '7.2': [3374, 1554, 1554, 1491, 1867],
  '7.3': [3374, 1554, 1554, 1491, 1867]
}

const MESES = [
  'JANEIRO', 'FEVEREIRO', 'MARÇO', 'ABRIL', 'MAIO', 'JUNHO',
  'JULHO', 'AGOSTO', 'SETEMBRO', 'OUTUBRO', 'NOVEMBRO', 'DEZEMBRO'
]

// Nome do mês como o cabeçalho de página do modelo o escreve ("Julho/2026"):
// primeira letra maiúscula, o resto minúsculo.
const mesCapitalizado = mes => {
  const nome = MESES[mes - 1] || ''
  return nome.charAt(0) + nome.slice(1).toLowerCase()
}

// ---------------------------------------------------------------------------
// Blocos de texto
// ---------------------------------------------------------------------------

// `bold` só entra quando é verdadeiro. Com `bold: false` a biblioteca escreve
// <w:b w:val="false"/>, que o Word entende igual a não ter o elemento, mas que
// o modelo não tem: sem esta guarda, comparar o OOXML gerado com o do modelo
// acusa diferença em toda célula de corpo, e o teste que protege a formatação
// vira ruído.
const execucao = (texto, { negrito = false, tamanho = TAMANHO_TITULO } = {}) =>
  new TextRun({
    text: texto,
    ...(negrito ? { bold: true } : {}),
    font: FONTE,
    size: tamanho
  })

// "2. EXECUÇÃO DO PIT": 12pt negrito, justificado.
const tituloSecao = texto =>
  new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    children: [execucao(texto, { negrito: true })]
  })

// "2.2. Totais do Mês e do Ano": 12pt normal, justificado.
const tituloSubsecao = texto =>
  new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    children: [execucao(texto)]
  })

const linhaVazia = () => new Paragraph({ children: [execucao('')] })

// ---------------------------------------------------------------------------
// Tabela
// ---------------------------------------------------------------------------

// Célula vazia continua precisando de um parágrafo: `w:tc` sem `w:p` é OOXML
// inválido, e o Word recusa o arquivo inteiro.
const celula = (texto, { largura, cabecalho = false }) =>
  new TableCell({
    width: { size: largura, type: WidthType.DXA },
    borders: BORDAS_CELULA,
    verticalAlign: VerticalAlign.CENTER,
    shading: cabecalho
      ? { type: ShadingType.CLEAR, fill: PREENCHIMENTO_CABECALHO, color: 'auto' }
      : undefined,
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: ENTRELINHA_CELULA,
        children: [
          execucao(String(texto == null ? '' : texto), {
            negrito: cabecalho,
            tamanho: cabecalho ? TAMANHO_TITULO : TAMANHO_CORPO_TABELA
          })
        ]
      })
    ]
  })

/**
 * Uma tabela no formato do RPCMTec.
 *
 * Tabela sem nenhuma linha sai com UMA linha de '-' em cada coluna, que é como
 * o modelo escreve "não houve" (ver 2.4, 2.6 e 6.2 na edição de julho/2026).
 * Deixar só o cabeçalho faria parecer que a tabela ficou por preencher.
 *
 * @param {string} numero - a subseção ('2.2'), para escolher a grade de coluna
 * @param {Array<string>} cabecalhos
 * @param {Array<Array<string>>} linhas
 * @returns {Table}
 */
const tabela = (numero, cabecalhos, linhas) => {
  const grade = GRADES[numero] ||
    cabecalhos.map(() => Math.round(LARGURA_TABELA / cabecalhos.length))
  const corpo = linhas.length > 0 ? linhas : [cabecalhos.map(() => '-')]

  return new Table({
    columnWidths: grade,
    width: { size: grade.reduce((s, g) => s + g, 0), type: WidthType.DXA },
    indent: { size: RECUO_TABELA, type: WidthType.DXA },
    layout: TableLayoutType.FIXED,
    rows: [
      new TableRow({
        tableHeader: true,
        height: { value: ALTURA_MINIMA_CABECALHO, rule: HeightRule.ATLEAST },
        children: cabecalhos.map((texto, i) =>
          celula(texto, { largura: grade[i], cabecalho: true }))
      }),
      ...corpo.map(celulas => new TableRow({
        children: celulas.map((texto, i) => celula(texto, { largura: grade[i] }))
      }))
    ]
  })
}

// ---------------------------------------------------------------------------
// Cabeçalho de página
// ---------------------------------------------------------------------------

// "RPCMTec 1º CGEO Julho/2026 ... Página X de Y", 10pt negrito. No modelo o
// espaçamento até "Página" é feito com tabulações mais espaços; aqui vai uma
// tabulação à direita, que produz o mesmo resultado sem depender da largura da
// fonte.
const cabecalhoPagina = (ano, mes) =>
  new Header({
    children: [
      new Paragraph({
        tabStops: [{ type: 'right', position: LARGURA_TABELA }],
        children: [
          execucao(`RPCMTec 1º CGEO ${mesCapitalizado(mes)}/${ano}`, {
            negrito: true, tamanho: TAMANHO_CABECALHO_PAGINA
          }),
          new TextRun({
            bold: true, font: FONTE, size: TAMANHO_CABECALHO_PAGINA,
            children: ['\t', 'Página ', PageNumber.CURRENT, ' de ', PageNumber.TOTAL_PAGES]
          })
        ]
      })
    ]
  })

// ---------------------------------------------------------------------------
// Documento
// ---------------------------------------------------------------------------

/**
 * Monta o DOCX a partir das seções já formatadas.
 *
 * @param {Object} params
 * @param {number} params.ano
 * @param {number} params.mes
 * @param {Array<Object>} params.secoes - [{ titulo, subsecoes: [{ numero,
 *   titulo, cabecalhos, linhas }] }]
 * @returns {Promise<Buffer>}
 */
const montarDocumento = ({ ano, mes, secoes }) => {
  const children = []

  for (const secao of secoes) {
    children.push(tituloSecao(secao.titulo))
    for (const sub of secao.subsecoes) {
      children.push(tituloSubsecao(`${sub.numero}. ${sub.titulo}`))
      children.push(tabela(sub.numero, sub.cabecalhos, sub.linhas))
      children.push(linhaVazia())
    }
  }

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: { font: FONTE, size: TAMANHO_TITULO }
        }
      }
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: 12240, height: 15840 },
            margin: {
              top: 990, bottom: 1440, left: 1440, right: 1440,
              header: 720, footer: 720
            }
          }
        },
        headers: { default: cabecalhoPagina(ano, mes) },
        children
      }
    ]
  })

  return Packer.toBuffer(doc)
}

module.exports = {
  montarDocumento,
  mesCapitalizado,
  MESES,
  // Exportados para o teste conferir a formatação contra o modelo medido, sem
  // reabrir o .docx de referência a cada execução.
  FORMATO: {
    FONTE,
    TAMANHO_TITULO,
    TAMANHO_CORPO_TABELA,
    PREENCHIMENTO_CABECALHO,
    LARGURA_TABELA,
    RECUO_TABELA,
    GRADES
  }
}
