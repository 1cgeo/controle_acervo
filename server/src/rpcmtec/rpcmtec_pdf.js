'use strict'

// O RPCMTec em PDF, pronto para assinar.
//
// NÃO HÁ DOCX: o documento inteiro é preenchido no sistema, e o que sai daqui é
// o arquivo final. Não existe etapa no Word.
//
// AS MEDIDAS SÃO DO DOCUMENTO DA DIVISÃO, lidas do OOXML de uma edição real e
// convertidas de twip para ponto (1 pt = 20 twip). O PDF tem de ser
// reconhecível como o mesmo relatório de sempre por quem o assina.
//
//   página        Letter (612 x 792 pt), margens 49,5 topo / 72 nos outros
//   cabeçalho     a 36 pt do topo
//   fonte         Lato Light
//   título        seção 12 pt negrito, subseção 12 pt normal
//   tabela        grade de coluna própria por tabela
//   cabeçalho     preenchimento DDD9C4, 10 pt negrito, centrado
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
// A MOLDURA DA CÉLULA SAI DA LARGURA, e não sobra dela (chefe, 2026-08-11). O
// pdfmake trata `widths` como largura de CONTEÚDO e soma por fora o espaçamento
// dos dois lados de cada célula E o traço de cada linha vertical: a tabela de 8
// colunas terminava em 597 pt e a de 6, em 583 -- as duas invadindo a margem
// direita, e cada uma um tanto diferente. Quem olhava a página via margem
// esquerda larga, direita nenhuma e tabela de largura variável, que eram o mesmo
// defeito. Descontados os dois antes de repartir, TODA tabela fecha em 468 pt e
// encosta nas duas margens, e é `rpcmtec_formato_do_pdf.test.js` quem cobra.
//
// A FONTE É LATO LIGHT, e não Calibri Light. O documento é Calibri Light, que é
// da Microsoft e não se redistribui; a Lato é do MESMO desenhador de que a
// Carlito (o clone métrico da Calibri) descende, está sob a SIL Open Font
// License e tem o peso Light que falta à Carlito. O preço é 8% de largura a mais
// que a Calibri Light: célula estreita quebra uma linha antes. Os .ttf vivem em
// `assets/`, com a licença ao lado, porque o servidor não tem fonte instalada.
//
// SÓ LIGHT E NEGRITO. O documento não tem uma execução em itálico, e os dois
// estilos itálicos apontam os mesmos arquivos: um .ttf a mais no repositório
// para um estilo que ninguém usa custa 1,3 MB.

// O NOME DO CENTRO NÃO É MAIS LITERAL, desde 2026-08-09. A capa, a linha do mês,
// o bloco de assinatura e o cabeçalho de toda página traziam '1º CGEO' e '1º
// Centro de Geoinformação' escritos aqui, e outro Centro que instalasse o SAP
// emitiria um relatório com o nome desta casa. Os quatro leem `edicao.instituicao`,
// que `rpcmtec_edicao_ctrl.montar` põe no objeto -- este arquivo não consulta
// banco, e continua não consultando.

const path = require('path')
const PdfPrinter = require('pdfmake')

const { AppError, httpCode } = require('../utils')

const ASSETS = path.join(__dirname, 'assets')

const FONTES = {
  Lato: {
    normal: path.join(ASSETS, 'Lato-Light.ttf'),
    bold: path.join(ASSETS, 'Lato-Bold.ttf'),
    italics: path.join(ASSETS, 'Lato-Light.ttf'),
    bolditalics: path.join(ASSETS, 'Lato-Bold.ttf')
  }
}

const BRASAO = path.join(ASSETS, 'brasao.png')

// Twip para ponto. As grades da estrutura estão em twip, como o modelo as
// guarda.
const pt = twip => twip / 20

// DOIS TAMANHOS, e a régua é a do chefe (2026-08-11): a TABELA inteira e o
// cabeçalho institucional saem em 10, e todo o resto do relatório em 12. O
// cabeçalho da tabela era 12 e passou a acompanhar o corpo dela: com colunas de
// 40 a 90 pt, a palavra do cabeçalho é quem estourava.
const TAMANHO_TEXTO = 12
const TAMANHO_REDUZIDO = 10
const PREENCHIMENTO_CABECALHO = '#DDD9C4'

// A área útil da página: 612 pt de largura menos as duas margens de 72.
const LARGURA_TABELA = 468

// O vão em branco entre o local e o nome do assinante, onde a assinatura à
// caneta cabe: 72 pt são 2,54 cm.
const ESPACO_ASSINATURA = 72

// O respiro de cada lado da célula e a espessura do traço da grade. Os dois são
// aplicados pelo `LAYOUT` e DESCONTADOS da largura: o pdfmake soma os dois por
// fora do que se declara em `widths`.
const ESPACO_CELULA = 3
const LARGURA_BORDA = 1

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
    fontSize: TAMANHO_REDUZIDO,
    alignment: 'center'
  }))

  const dados = (linhas && linhas.length > 0)
    ? linhas
    : [cabecalhos.map(() => '-')]

  const corpo = dados.map(linha =>
    cabecalhos.map((_, i) => ({
      text: String(linha[i] == null ? '' : linha[i]),
      fontSize: TAMANHO_REDUZIDO,
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
//
// O QUE SE REPARTE NÃO É A LARGURA DA TABELA, e sim o que sobra dela depois da
// moldura de cada célula: o pdfmake soma ao que se declara aqui os
// `2 * ESPACO_CELULA` de espaçamento por coluna E o traço de cada linha
// vertical, que são `colunas + 1`. Sem os dois descontos a tabela cresce com o
// NÚMERO DE COLUNAS -- era o que punha a de 8 colunas 57 pt dentro da margem
// direita e deixava cada tabela de uma largura.
const largurasDa = (grade, quantasColunas) => {
  const util = LARGURA_TABELA -
    2 * ESPACO_CELULA * quantasColunas -
    LARGURA_BORDA * (quantasColunas + 1)

  if (!grade || grade.length !== quantasColunas) {
    return Array.from({ length: quantasColunas }, () => util / quantasColunas)
  }

  const total = grade.reduce((soma, coluna) => soma + coluna, 0)
  return grade.map(coluna => (coluna / total) * util)
}

const LAYOUT = {
  hLineWidth: () => LARGURA_BORDA,
  vLineWidth: () => LARGURA_BORDA,
  hLineColor: () => '#000000',
  vLineColor: () => '#000000',
  // Só a primeira linha é cabeçalho, e é a única preenchida.
  fillColor: rowIndex => (rowIndex === 0 ? PREENCHIMENTO_CABECALHO : null),
  paddingLeft: () => ESPACO_CELULA,
  paddingRight: () => ESPACO_CELULA,
  paddingTop: () => ESPACO_CELULA,
  paddingBottom: () => ESPACO_CELULA
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
  fontSize: TAMANHO_REDUZIDO,
  alignment: 'center'
})

// A INSTITUIÇÃO DESTA EDIÇÃO, e ela não tem valor padrão.
//
// Chegar aqui sem ela quer dizer que alguém passou a este desenhador um objeto
// que não veio de `rpcmtec_edicao_ctrl.montar`. Sem esta conferência o PDF sairia
// com 'undefined - JULHO/2026' na capa e 'RPCMTec undefined Julho/2026' em toda
// página -- um documento que alguém assina, com a assinatura valendo por um
// cabeçalho que não diz de quem é. Erro claro é melhor.
const instituicaoDa = edicao => {
  const instituicao = edicao && edicao.instituicao

  if (!instituicao || !instituicao.nome || !instituicao.sigla) {
    throw new AppError(
      'O PDF do RPCMTec não pode ser desenhado sem a instituição da instalação: o nome e a sigla do Centro entram na capa, no cabeçalho de página e no bloco de assinatura. A edição tem de vir de rpcmtec_edicao_ctrl.montar, que a lê de dgeo.instituicao.',
      httpCode.InternalError
    )
  }

  return instituicao
}

const capa = (ano, mes, instituicao) => [
  // 51,2 x 53,6 pt, medidos no `wp:extent` do documento.
  { image: BRASAO, width: 51.2, height: 53.6, alignment: 'center' },
  linhaInstitucional('MINISTÉRIO DA DEFESA'),
  linhaInstitucional('EXÉRCITO BRASILEIRO'),
  // MAIÚSCULA APLICADA AQUI, e não guardada assim: a capa do modelo grita o nome
  // do Centro, e o bloco de assinatura o escreve normal. Guardar duas grafias em
  // `dgeo.instituicao` daria duas colunas para divergir.
  linhaInstitucional(instituicao.nome.toUpperCase()),
  // As duas linhas abaixo continuam LITERAIS, e a diferença é que elas não são
  // a instituição: são a Comissão da Carta e o nome próprio da Divisão de
  // Levantamento, que `dgeo.instituicao` não tem coluna para guardar. Ficam como
  // PENDÊNCIA declarada, e não como esquecimento.
  linhaInstitucional('(Coms da Carta G do Brasil/1903)'),
  linhaInstitucional('DIVISÃO DE LEVANTAMENTO GENERAL AUGUSTO TASSO FRAGOSO'),
  { text: '', margin: [0, 6, 0, 0] },
  {
    text: 'RELATÓRIO DE PRESTAÇÃO DE CONTAS MENSAL TÉCNICO (RPCMTec)',
    bold: true,
    fontSize: TAMANHO_TEXTO,
    alignment: 'center'
  },
  { text: '', margin: [0, 6, 0, 0] },
  {
    text: `${instituicao.sigla} - ${MESES[mes - 1]}/${ano}`,
    bold: true,
    fontSize: TAMANHO_TEXTO,
    alignment: 'center',
    margin: [0, 0, 0, 10]
  }
]

// O nome e o posto saem do CADASTRO (`dgeo.usuario` mais
// `dominio.tipo_posto_grad`), e não de texto redigitado por edição. Sem
// assinante o bloco não é impresso: uma linha em branco onde vai a assinatura
// convida alguém a preenchê-la à caneta, e a edição não fecha sem assinante de
// qualquer forma.
//
// O BLOCO É INDIVISÍVEL (`unbreakable`), e na edição de julho/2026 ele não era:
// a linha do local ficou no pé da página 23 e o nome do assinante abriu a 24,
// com o cabeçalho de página entre os dois. Documento que alguém assina não tem a
// assinatura separada do lugar e da data por uma virada de folha. Sendo um
// `stack`, o bloco desce inteiro para a página seguinte quando não couber.
const assinatura = (edicao, instituicao) => {
  const bloco = [
    { text: '', margin: [0, 14, 0, 0] },
    {
      // O travessão curto é do documento.
      text: 'Porto Alegre – RS, na data da assinatura.',
      fontSize: TAMANHO_TEXTO,
      alignment: 'center',
      // O VÃO É PARA A ASSINATURA À CANETA, e por isso são 72 pt (2,54 cm) e
      // não os 24 de antes (chefe, 2026-08-11): quem assina escreve ENTRE esta
      // linha e o nome, e em 24 pt a rubrica passava por cima do nome impresso.
      margin: [0, 0, 0, ESPACO_ASSINATURA]
    }
  ]

  if (!edicao.assinante_nome) return { stack: bloco, unbreakable: true }

  const posto = edicao.assinante_posto_extenso || edicao.assinante_posto || ''
  bloco.push(
    {
      text: `${edicao.assinante_nome.toUpperCase()}${posto ? ` - ${posto}` : ''}`,
      fontSize: TAMANHO_TEXTO,
      alignment: 'center'
    },
    {
      text: 'Chefe da Divisão de Geoinformação',
      fontSize: TAMANHO_TEXTO,
      alignment: 'center'
    },
    {
      text: instituicao.nome,
      fontSize: TAMANHO_TEXTO,
      alignment: 'center'
    }
  )

  return { stack: bloco, unbreakable: true }
}

// "RPCMTec 1º CGEO Julho/2026 ... Página X de Y".
//
// A MARCA DE RASCUNHO sai em toda página enquanto a edição está aberta, e é
// barata para o que evita: um PDF de edição aberta pode ser assinado, e aí o
// documento assinado afirma números que ainda vão mudar.
const cabecalhoDaPagina = (ano, mes, fechada, sigla) => (paginaAtual, total) => {
  const linha = {
    columns: [
      {
        text: `RPCMTec ${sigla} ${mesCapitalizado(mes)}/${ano}`,
        bold: true,
        fontSize: TAMANHO_REDUZIDO
      },
      {
        text: `Página ${paginaAtual} de ${total}`,
        bold: true,
        fontSize: TAMANHO_REDUZIDO,
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
      fontSize: TAMANHO_REDUZIDO,
      color: '#B00000',
      alignment: 'center',
      margin: [72, 2, 72, 0]
    }
  ]
}

// ---------------------------------------------------------------------------
// Documento
// ---------------------------------------------------------------------------

const corpoDoDocumento = (edicao, instituicao) => {
  const conteudo = [...capa(edicao.ano, edicao.mes, instituicao)]

  for (const secao of edicao.secoes) {
    conteudo.push({
      text: secao.titulo,
      bold: true,
      fontSize: TAMANHO_TEXTO,
      alignment: 'justify',
      margin: [0, 4, 0, 2]
    })

    for (const sub of secao.subsecoes) {
      // A 1.1 não tem título: no documento ela É o parágrafo, e o número serve
      // de marcador. As 9.x têm título e a prosa vem abaixo.
      if (!sub.titulo) {
        conteudo.push({
          text: `${sub.numero}. ${sub.texto || ''}`,
          fontSize: TAMANHO_TEXTO,
          alignment: 'justify',
          margin: [0, 0, 0, 8]
        })
        continue
      }

      conteudo.push({
        text: `${sub.numero}. ${sub.titulo}`,
        fontSize: TAMANHO_TEXTO,
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
          fontSize: TAMANHO_TEXTO,
          alignment: 'justify',
          margin: [0, 0, 0, 8]
        })
      }
    }
  }

  conteudo.push(assinatura(edicao, instituicao))

  return conteudo
}

/**
 * A definição pdfmake do documento, antes de virar bytes.
 *
 * SEPARADA DE `montarDocumento` para o TESTE, e a razão é que o PDF pronto não
 * se lê: o texto sai comprimido, e a suíte só conseguia comparar TAMANHO de
 * arquivo. Com a definição à parte, o teste do segundo Centro afirma o que
 * importa -- que a capa, a linha do mês, o cabeçalho de página e o bloco de
 * assinatura trazem o nome e a sigla de quem `dgeo.instituicao` diz que é.
 *
 * @param {Object} edicao - a saída de `rpcmtec_edicao_ctrl.montar`
 * @returns {Object}
 */
const montarDefinicao = edicao => {
  const instituicao = instituicaoDa(edicao)

  return {
    pageSize: 'LETTER',
    // [esquerda, topo, direita, baixo]. O topo abre espaço para o cabeçalho de
    // página, que é desenhado dentro da margem.
    pageMargins: [72, 60, 72, 72],
    header: cabecalhoDaPagina(
      edicao.ano, edicao.mes, edicao.fechada, instituicao.sigla
    ),
    defaultStyle: { font: 'Lato', fontSize: TAMANHO_TEXTO },
    content: corpoDoDocumento(edicao, instituicao)
  }
}

/**
 * Desenha o PDF de uma edição já montada.
 *
 * @param {Object} edicao - a saída de `rpcmtec_edicao_ctrl.montar`
 * @returns {Promise<Buffer>}
 */
const montarDocumento = edicao => {
  const printer = new PdfPrinter(FONTES)

  const definicao = montarDefinicao(edicao)

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
  montarDefinicao,
  mesCapitalizado,
  MESES,
  // Exportados para o teste conferir o formato contra o modelo medido, sem
  // reabrir o documento de referência a cada execução.
  FORMATO: {
    FONTE: 'Lato',
    TAMANHO_TEXTO,
    TAMANHO_REDUZIDO,
    PREENCHIMENTO_CABECALHO,
    LARGURA_TABELA,
    ESPACO_CELULA,
    LARGURA_BORDA
  },
  // Exportada para o teste somar as colunas e cobrar os 468 pt: a conta do
  // espaçamento é o que estourava a margem, e ela não se prova pelo PDF pronto.
  largurasDa
}
