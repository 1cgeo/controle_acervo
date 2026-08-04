'use strict'

// O RPCMTec em PDF, pronto para assinar.
//
// SUBSTITUIU O DOCX em 2026-08-05 (decisão do chefe). Até então o sistema
// emitia um .docx com as tabelas que sabia calcular, e alguém as colava num
// documento mestre no Word, preenchia as doze subseções restantes e exportava
// dali. Agora o documento inteiro é preenchido no sistema, e o que sai é o
// arquivo final: não há mais etapa no Word, e por isso não há mais DOCX.
//
// AS MEDIDAS SÃO DO DOCUMENTO DA DIVISÃO, lidas do OOXML da edição de
// julho/2026 e convertidas de twip para ponto (1 pt = 20 twip). O PDF tem de
// ser reconhecível como o mesmo relatório de sempre por quem o assina.
//
//   página        Letter (612 x 792 pt), margens 49,5 topo / 72 nos outros
//   cabeçalho     a 36 pt do topo
//   fonte         Carlito
//   título        seção 12 pt negrito, subseção 12 pt normal
//   tabela        grade de coluna própria por tabela
//   cabeçalho     preenchimento DDD9C4, 12 pt negrito, centrado
//   da tabela
//   corpo         10 pt, centrado
//   bordas        linha preta de 1 pt nos quatro lados
//
// A LARGURA DA TABELA é a única medida que NÃO se copia do modelo, e a razão é
// que lá ela não fecha: as trinta tabelas somam entre 9.750 e 10.155 twip
// (487 a 508 pt) numa página cuja área útil é 468 pt. No Word aquilo funciona
// porque a tabela avança sobre a margem com um recuo negativo, e ainda assim a
// 2.1 chega perto da borda do papel. Aqui cada grade é REESCALADA para os 468
// pt úteis, preservando a proporção entre as colunas: nenhuma tabela estoura, e
// todas nascem do mesmo tamanho, que é o que o modelo tentava fazer à mão.
//
// A FONTE É CARLITO, e não Calibri. O documento é Calibri, que é da Microsoft e
// não se redistribui; a Carlito foi desenhada com as MESMAS métricas e está sob
// a SIL Open Font License. Cada linha quebra no mesmo ponto, e o arquivo é
// idêntico ao olho. Os dois .ttf vivem em `assets/` porque o contêiner não tem
// fonte instalada.
//
// SÓ REGULAR E NEGRITO. O documento não tem uma execução em itálico, e os dois
// estilos itálicos apontam os mesmos arquivos: um .ttf a mais no repositório
// para um estilo que ninguém usa custa 1,3 MB.

const path = require('path')
const PdfPrinter = require('pdfmake')

const ASSETS = path.join(__dirname, 'assets')

const FONTES = {
  Carlito: {
    normal: path.join(ASSETS, 'Carlito-Regular.ttf'),
    bold: path.join(ASSETS, 'Carlito-Bold.ttf'),
    italics: path.join(ASSETS, 'Carlito-Regular.ttf'),
    bolditalics: path.join(ASSETS, 'Carlito-Bold.ttf')
  }
}

const BRASAO = path.join(ASSETS, 'brasao.png')

// Twip para ponto. As grades da estrutura estão em twip, como o modelo as
// guarda.
const pt = twip => twip / 20

const TAMANHO_TITULO = 12
const TAMANHO_CORPO = 10
const PREENCHIMENTO_CABECALHO = '#DDD9C4'

// A área útil da página: 612 pt de largura menos as duas margens de 72.
const LARGURA_TABELA = 468

const MESES = [
  'JANEIRO', 'FEVEREIRO', 'MARÇO', 'ABRIL', 'MAIO', 'JUNHO',
  'JULHO', 'AGOSTO', 'SETEMBRO', 'OUTUBRO', 'NOVEMBRO', 'DEZEMBRO'
]

// 'Julho', como o cabeçalho de página do modelo o escreve.
const mesCapitalizado = mes => {
  const nome = MESES[mes - 1] || ''
  return nome.charAt(0) + nome.slice(1).toLowerCase()
}

// ---------------------------------------------------------------------------
// Tabela
// ---------------------------------------------------------------------------

// Tabela sem nenhuma linha sai com UMA linha de '-' em cada coluna, que é como
// o modelo escreve "não houve" (ver 2.4, 2.6 e 6.2 na edição de julho/2026).
// Deixar só o cabeçalho faria parecer que a tabela ficou por preencher.
const corpoDaTabela = (cabecalhos, linhas) => {
  const cabecalho = cabecalhos.map(texto => ({
    text: String(texto == null ? '' : texto),
    bold: true,
    fontSize: TAMANHO_TITULO,
    alignment: 'center'
  }))

  const dados = (linhas && linhas.length > 0)
    ? linhas
    : [cabecalhos.map(() => '-')]

  const corpo = dados.map(linha =>
    cabecalhos.map((_, i) => ({
      text: String(linha[i] == null ? '' : linha[i]),
      fontSize: TAMANHO_CORPO,
      alignment: 'center'
    }))
  )

  return [cabecalho, ...corpo]
}

// A grade vem da estrutura, em twip, e é REESCALADA para a área útil da
// página: o que o modelo fixa é a PROPORÇÃO entre as colunas (a "Finalidade" da
// 4.2 é larga porque o texto é longo, a "Qtd" da 3.3 é estreita porque cabe um
// número), e é isso que se preserva.
//
// Sem grade (edição fechada numa estrutura que mudou de número de colunas),
// divide-se por igual: é o que sobra quando a largura medida não corresponde
// mais à tabela.
const largurasDa = (grade, quantasColunas) => {
  if (!grade || grade.length !== quantasColunas) {
    return Array.from({ length: quantasColunas }, () => LARGURA_TABELA / quantasColunas)
  }

  const total = grade.reduce((soma, coluna) => soma + coluna, 0)
  return grade.map(coluna => (coluna / total) * LARGURA_TABELA)
}

const LAYOUT = {
  hLineWidth: () => 1,
  vLineWidth: () => 1,
  hLineColor: () => '#000000',
  vLineColor: () => '#000000',
  // Só a primeira linha é cabeçalho, e é a única preenchida.
  fillColor: rowIndex => (rowIndex === 0 ? PREENCHIMENTO_CABECALHO : null),
  paddingLeft: () => 3,
  paddingRight: () => 3,
  paddingTop: () => 3,
  paddingBottom: () => 3
}

const tabela = (grade, cabecalhos, linhas) => ({
  table: {
    headerRows: 1,
    widths: largurasDa(grade, cabecalhos.length),
    body: corpoDaTabela(cabecalhos, linhas)
  },
  layout: LAYOUT,
  margin: [0, 0, 0, 8]
})

// ---------------------------------------------------------------------------
// Cabeçalho institucional e bloco de assinatura
// ---------------------------------------------------------------------------

const linhaInstitucional = texto => ({
  text: texto,
  bold: true,
  fontSize: TAMANHO_CORPO,
  alignment: 'center'
})

const capa = (ano, mes) => [
  // 51,2 x 53,6 pt, medidos no `wp:extent` do documento.
  { image: BRASAO, width: 51.2, height: 53.6, alignment: 'center' },
  linhaInstitucional('MINISTÉRIO DA DEFESA'),
  linhaInstitucional('EXÉRCITO BRASILEIRO'),
  linhaInstitucional('1º CENTRO DE GEOINFORMAÇÃO'),
  linhaInstitucional('(Coms da Carta G do Brasil/1903)'),
  linhaInstitucional('DIVISÃO DE LEVANTAMENTO GENERAL AUGUSTO TASSO FRAGOSO'),
  { text: '', margin: [0, 6, 0, 0] },
  {
    text: 'RELATÓRIO DE PRESTAÇÃO DE CONTAS MENSAL TÉCNICO (RPCMTec)',
    bold: true,
    fontSize: TAMANHO_TITULO,
    alignment: 'center'
  },
  { text: '', margin: [0, 6, 0, 0] },
  {
    text: `1º CGEO - ${MESES[mes - 1]}/${ano}`,
    bold: true,
    fontSize: TAMANHO_TITULO,
    alignment: 'center',
    margin: [0, 0, 0, 10]
  }
]

// O nome e o posto saem do CADASTRO (`dgeo.usuario` mais
// `dominio.tipo_posto_grad`), e não de texto redigitado por edição. Sem
// assinante o bloco não é impresso: uma linha em branco onde vai a assinatura
// convida alguém a preenchê-la à caneta, e a edição não fecha sem assinante de
// qualquer forma.
const assinatura = edicao => {
  const bloco = [
    { text: '', margin: [0, 14, 0, 0] },
    {
      // O travessão curto é do documento.
      text: 'Porto Alegre – RS, na data da assinatura.',
      fontSize: TAMANHO_TITULO,
      alignment: 'center',
      margin: [0, 0, 0, 24]
    }
  ]

  if (!edicao.assinante_nome) return bloco

  const posto = edicao.assinante_posto_extenso || edicao.assinante_posto || ''
  bloco.push(
    {
      text: `${edicao.assinante_nome.toUpperCase()}${posto ? ` - ${posto}` : ''}`,
      fontSize: TAMANHO_TITULO,
      alignment: 'center'
    },
    {
      text: 'Chefe da Divisão de Geoinformação',
      fontSize: TAMANHO_TITULO,
      alignment: 'center'
    },
    {
      text: '1º Centro de Geoinformação',
      fontSize: TAMANHO_TITULO,
      alignment: 'center'
    }
  )

  return bloco
}

// "RPCMTec 1º CGEO Julho/2026 ... Página X de Y".
//
// A MARCA DE RASCUNHO sai em toda página enquanto a edição está aberta, e é
// barata para o que evita: um PDF de edição aberta pode ser assinado, e aí o
// documento assinado afirma números que ainda vão mudar.
const cabecalhoDaPagina = (ano, mes, fechada) => (paginaAtual, total) => {
  const linha = {
    columns: [
      {
        text: `RPCMTec 1º CGEO ${mesCapitalizado(mes)}/${ano}`,
        bold: true,
        fontSize: TAMANHO_CORPO
      },
      {
        text: `Página ${paginaAtual} de ${total}`,
        bold: true,
        fontSize: TAMANHO_CORPO,
        alignment: 'right'
      }
    ],
    margin: [72, 36, 72, 0]
  }

  if (fechada) return linha

  return [
    linha,
    {
      text: 'RASCUNHO: edição ainda aberta, os números podem mudar',
      bold: true,
      fontSize: TAMANHO_CORPO,
      color: '#B00000',
      alignment: 'center',
      margin: [72, 2, 72, 0]
    }
  ]
}

// ---------------------------------------------------------------------------
// Documento
// ---------------------------------------------------------------------------

const corpoDoDocumento = edicao => {
  const conteudo = [...capa(edicao.ano, edicao.mes)]

  for (const secao of edicao.secoes) {
    conteudo.push({
      text: secao.titulo,
      bold: true,
      fontSize: TAMANHO_TITULO,
      alignment: 'justify',
      margin: [0, 4, 0, 2]
    })

    for (const sub of secao.subsecoes) {
      // A 1.1 não tem título: no documento ela É o parágrafo, e o número serve
      // de marcador. As 9.x têm título e a prosa vem abaixo.
      if (!sub.titulo) {
        conteudo.push({
          text: `${sub.numero}. ${sub.texto || ''}`,
          fontSize: TAMANHO_TITULO,
          alignment: 'justify',
          margin: [0, 0, 0, 8]
        })
        continue
      }

      conteudo.push({
        text: `${sub.numero}. ${sub.titulo}`,
        fontSize: TAMANHO_TITULO,
        alignment: 'justify',
        margin: [0, 2, 0, 2]
      })

      if (sub.cabecalhos) {
        conteudo.push(tabela(sub.grade, sub.cabecalhos, sub.linhas))
      } else {
        conteudo.push({
          // Prosa não preenchida imprime o '-' do modelo, pela mesma razão da
          // tabela vazia: espaço em branco se lê como esquecimento.
          text: sub.texto || '-',
          fontSize: TAMANHO_TITULO,
          alignment: 'justify',
          margin: [0, 0, 0, 8]
        })
      }
    }
  }

  conteudo.push(...assinatura(edicao))

  return conteudo
}

/**
 * Desenha o PDF de uma edição já montada.
 *
 * @param {Object} edicao - a saída de `rpcmtec_edicao_ctrl.montar`
 * @returns {Promise<Buffer>}
 */
const montarDocumento = edicao => {
  const printer = new PdfPrinter(FONTES)

  const definicao = {
    pageSize: 'LETTER',
    // [esquerda, topo, direita, baixo]. O topo abre espaço para o cabeçalho de
    // página, que é desenhado dentro da margem.
    pageMargins: [72, 60, 72, 72],
    header: cabecalhoDaPagina(edicao.ano, edicao.mes, edicao.fechada),
    defaultStyle: { font: 'Carlito', fontSize: TAMANHO_TITULO },
    content: corpoDoDocumento(edicao)
  }

  return new Promise((resolve, reject) => {
    const doc = printer.createPdfKitDocument(definicao)
    const pedacos = []
    doc.on('data', p => pedacos.push(p))
    doc.on('end', () => resolve(Buffer.concat(pedacos)))
    doc.on('error', reject)
    doc.end()
  })
}

module.exports = {
  montarDocumento,
  mesCapitalizado,
  MESES,
  // Exportados para o teste conferir o formato contra o modelo medido, sem
  // reabrir o documento de referência a cada execução.
  FORMATO: {
    FONTE: 'Carlito',
    TAMANHO_TITULO,
    TAMANHO_CORPO,
    PREENCHIMENTO_CABECALHO,
    LARGURA_TABELA
  }
}
