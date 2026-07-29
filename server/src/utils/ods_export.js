// Path: utils\ods_export.js
'use strict'

const zlib = require('zlib')

/**
 * Escreve uma planilha ODS (OpenDocument Spreadsheet) de UMA aba.
 *
 * POR QUE ESCREVER O ODS A MÃO. O destino destes relatórios é uma aba de
 * planilha que já existe (o RTM mensal do 1º CGEO), e CSV perde três coisas que
 * a aba tem: a data como DATA (o CSV entrega texto, e o Calc reinterpreta com o
 * fuso e a localidade de quem abre), o número como NÚMERO, e a formatação
 * (cabeçalho, borda, largura de coluna). Um .ods é um ZIP com XML dentro, e
 * escrevê-lo custa este arquivo. A alternativa era mais uma dependência para
 * gerar o que caberia aqui, e o `archiver` que já existe no projeto é stream de
 * arquivo, não buffer em memória.
 *
 * O que este módulo NÃO faz, de propósito: fórmula, gráfico, mais de uma aba,
 * célula mesclada. Nenhum relatório precisa, e cada um desses seria mais
 * superfície para manter.
 */

// --- ZIP -------------------------------------------------------------------
// ZIP mínimo (deflate cru pelo zlib do Node). O ODF exige que a entrada
// `mimetype` seja a PRIMEIRA e fique SEM compressão: é por ela que o
// descompactador identifica o tipo do documento sem abrir o XML.

const TABELA_CRC = (() => {
  const tabela = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    tabela[n] = c
  }
  return tabela
})()

const crc32 = buffer => {
  let c = 0 ^ -1
  for (let i = 0; i < buffer.length; i++) {
    c = (c >>> 8) ^ TABELA_CRC[(c ^ buffer[i]) & 0xff]
  }
  return (c ^ -1) >>> 0
}

// Data/hora no formato DOS que o cabeçalho do ZIP usa (resolução de 2 segundos).
const dataDos = data => {
  const dia = ((data.getFullYear() - 1980) << 9) | ((data.getMonth() + 1) << 5) | data.getDate()
  const hora = (data.getHours() << 11) | (data.getMinutes() << 5) | (data.getSeconds() >> 1)
  return { dia, hora }
}

/**
 * Monta um ZIP a partir de uma lista de entradas.
 * @param {Array<{nome: string, conteudo: Buffer, comprimir?: boolean}>} entradas
 * @param {Date} [data] - carimbo de tempo das entradas
 * @returns {Buffer}
 */
const zipar = (entradas, data = new Date()) => {
  const { dia, hora } = dataDos(data)
  const locais = []
  const centrais = []
  let deslocamento = 0

  for (const entrada of entradas) {
    const nome = Buffer.from(entrada.nome, 'utf8')
    const cru = entrada.conteudo
    const comprimir = entrada.comprimir !== false
    const dados = comprimir ? zlib.deflateRawSync(cru, { level: 9 }) : cru
    const metodo = comprimir ? 8 : 0
    const crc = crc32(cru)

    const local = Buffer.alloc(30 + nome.length)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4) // versão necessária
    local.writeUInt16LE(0, 6) // flags
    local.writeUInt16LE(metodo, 8)
    local.writeUInt16LE(hora, 10)
    local.writeUInt16LE(dia, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(dados.length, 18)
    local.writeUInt32LE(cru.length, 22)
    local.writeUInt16LE(nome.length, 26)
    local.writeUInt16LE(0, 28) // sem campo extra
    nome.copy(local, 30)

    const central = Buffer.alloc(46 + nome.length)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4) // versão de quem escreveu
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0, 8)
    central.writeUInt16LE(metodo, 10)
    central.writeUInt16LE(hora, 12)
    central.writeUInt16LE(dia, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(dados.length, 20)
    central.writeUInt32LE(cru.length, 24)
    central.writeUInt16LE(nome.length, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    central.writeUInt32LE(0, 38)
    central.writeUInt32LE(deslocamento, 42)
    nome.copy(central, 46)

    locais.push(local, dados)
    centrais.push(central)
    deslocamento += local.length + dados.length
  }

  const diretorio = Buffer.concat(centrais)
  const fim = Buffer.alloc(22)
  fim.writeUInt32LE(0x06054b50, 0)
  fim.writeUInt16LE(0, 4)
  fim.writeUInt16LE(0, 6)
  fim.writeUInt16LE(entradas.length, 8)
  fim.writeUInt16LE(entradas.length, 10)
  fim.writeUInt32LE(diretorio.length, 12)
  fim.writeUInt32LE(deslocamento, 16)
  fim.writeUInt16LE(0, 20)

  return Buffer.concat([...locais, diretorio, fim])
}

// --- XML -------------------------------------------------------------------

const escaparXml = texto =>
  String(texto)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // O XML 1.0 não aceita caractere de controle. Observação colada de um Word
    // chega com eles, e um só torna o arquivo inteiro ilegível no Calc. A
    // tabulação, o LF e o CR ficam: o LF separa parágrafo dentro da célula.
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')

const pad = n => String(n).padStart(2, '0')

// Letra da coluna no endereço da planilha (0 -> A, 26 -> AA).
const letraColuna = indice => {
  let n = indice
  let letra = ''
  do {
    letra = String.fromCharCode(65 + (n % 26)) + letra
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return letra
}

/**
 * Data de calendário -> { iso: 'AAAA-MM-DD', exibicao: 'DD/MM/AA' }.
 *
 * Aceita string 'AAAA-MM-DD' (é assim que as colunas DATE chegam do banco, por
 * causa do type parser em database/db.js) e objeto Date. Da string a data sai
 * por fatia de texto, sem passar por Date: `new Date('2026-02-10')` é UTC, e num
 * fuso a oeste de Greenwich o dia volta um.
 */
const partesData = valor => {
  if (valor instanceof Date) {
    const iso = `${valor.getFullYear()}-${pad(valor.getMonth() + 1)}-${pad(valor.getDate())}`
    return { iso, exibicao: `${pad(valor.getDate())}/${pad(valor.getMonth() + 1)}/${String(valor.getFullYear()).slice(-2)}` }
  }
  const achado = String(valor).match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!achado) return null
  const [, ano, mes, dia] = achado
  return { iso: `${ano}-${mes}-${dia}`, exibicao: `${dia}/${mes}/${ano.slice(-2)}` }
}

const celula = (valor, tipo, estilo) => {
  const attrEstilo = ` table:style-name="${estilo}"`

  if (valor === null || valor === undefined || valor === '') {
    return `<table:table-cell${attrEstilo}/>`
  }

  if (tipo === 'numero') {
    const n = Number(valor)
    if (!Number.isFinite(n)) {
      return `<table:table-cell${attrEstilo} office:value-type="string"><text:p>${escaparXml(valor)}</text:p></table:table-cell>`
    }
    return `<table:table-cell${attrEstilo} office:value-type="float" office:value="${n}"><text:p>${n}</text:p></table:table-cell>`
  }

  if (tipo === 'data') {
    const partes = partesData(valor)
    if (!partes) {
      return `<table:table-cell${attrEstilo} office:value-type="string"><text:p>${escaparXml(valor)}</text:p></table:table-cell>`
    }
    return `<table:table-cell${attrEstilo} office:value-type="date" office:date-value="${partes.iso}"><text:p>${partes.exibicao}</text:p></table:table-cell>`
  }

  // Texto: cada linha vira um parágrafo, como o Calc faz com Ctrl+Enter.
  const paragrafos = String(valor)
    .split('\n')
    .map(linha => `<text:p>${escaparXml(linha)}</text:p>`)
    .join('')
  return `<table:table-cell${attrEstilo} office:value-type="string">${paragrafos}</table:table-cell>`
}

const NS = [
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"',
  'xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"',
  'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"',
  'xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"',
  // ATENÇÃO: o prefixo `fo` do ODF é `xsl-fo-compatible`, e não `xsl-format-object`
  // nem o namespace do XSL-FO do W3C. Com a URI errada o arquivo abre sem erro e
  // TODO atributo fo:* é ignorado em silêncio: a planilha sai sem borda, sem
  // fundo no cabeçalho e sem negrito. Medido em 2026-07-29, comparando com o
  // content.xml do RTM do chefe.
  'xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"',
  'xmlns:number="urn:oasis:names:tc:opendocument:xmlns:datastyle:1.0"'
].join(' ')

// Estilo da aba do RTM, lido do próprio arquivo do chefe
// (1_CGEO_RTM_JUN_26_preenchido.ods, aba META4_DETALHADA, 2026-07-29):
// cabeçalho creme #fff5ce em Calibri Light 12pt negrito, dado em Liberation
// Serif 10pt, tudo centralizado, com borda fina em toda célula.
const ESTILOS_CELULA = `
  <style:style style:name="ceCab" style:family="table-cell" style:parent-style-name="Default">
   <style:table-cell-properties fo:background-color="#fff5ce" style:text-align-source="fix" style:repeat-content="false" fo:wrap-option="wrap" fo:border="0.74pt solid #000000" style:vertical-align="middle"/>
   <style:paragraph-properties fo:text-align="center" fo:margin-left="0cm"/>
   <style:text-properties style:font-name="Calibri Light" fo:font-size="12pt" fo:font-weight="bold"/>
  </style:style>
  <style:style style:name="ceDado" style:family="table-cell" style:parent-style-name="Default">
   <style:table-cell-properties style:text-align-source="fix" style:repeat-content="false" fo:wrap-option="wrap" fo:border="0.74pt solid #000000" style:vertical-align="middle"/>
   <style:paragraph-properties fo:text-align="center" fo:margin-left="0cm"/>
   <style:text-properties style:font-name="Liberation Serif" fo:font-size="10pt" fo:language="pt" fo:country="BR"/>
  </style:style>
  <style:style style:name="ceData" style:family="table-cell" style:parent-style-name="Default" style:data-style-name="Ndata">
   <style:table-cell-properties style:text-align-source="fix" style:repeat-content="false" fo:wrap-option="wrap" fo:border="0.74pt solid #000000" style:vertical-align="middle"/>
   <style:paragraph-properties fo:text-align="center" fo:margin-left="0cm"/>
   <style:text-properties style:font-name="Liberation Serif" fo:font-size="10pt" fo:language="pt" fo:country="BR"/>
  </style:style>`

// DD/MM/AA, como na aba. `automatic-order` deixa o Calc reordenar conforme a
// localidade de quem abre, que é o comportamento do arquivo original.
const ESTILO_DATA = `
  <number:date-style style:name="Ndata" number:automatic-order="true">
   <number:day number:style="long"/><number:text>/</number:text>
   <number:month number:style="long"/><number:text>/</number:text>
   <number:year/>
  </number:date-style>`

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-styles ${NS} office:version="1.3">
 <office:styles>
  <style:style style:name="Default" style:family="table-cell">
   <style:text-properties style:font-name="Liberation Serif" fo:font-size="10pt" fo:language="pt" fo:country="BR"/>
  </style:style>
 </office:styles>
 <office:automatic-styles>
  <style:page-layout style:name="pm1">
   <style:page-layout-properties fo:margin-top="1cm" fo:margin-bottom="1cm" fo:margin-left="1cm" fo:margin-right="1cm" style:print-orientation="landscape"/>
  </style:page-layout>
 </office:automatic-styles>
 <office:master-styles>
  <style:master-page style:name="Default" style:page-layout-name="pm1"/>
 </office:master-styles>
</office:document-styles>`

const MANIFEST_XML = `<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3">
 <manifest:file-entry manifest:full-path="/" manifest:version="1.3" manifest:media-type="application/vnd.oasis.opendocument.spreadsheet"/>
 <manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>
 <manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/>
 <manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/>
</manifest:manifest>`

/**
 * Gera o .ods de uma aba.
 *
 * @param {Object} opts
 * @param {string} opts.aba - nome da aba (o do destino, ex.: 'META4_DETALHADA')
 * @param {Array<{key: string, label: string, largura?: string, tipo?: 'texto'|'numero'|'data'}>} opts.colunas
 *   `label` com '\n' vira duas linhas dentro da célula do cabeçalho.
 *   `largura` é uma medida ODF ('2.115cm'); `tipo` decide como o valor é gravado.
 * @param {Array<Object>} opts.linhas - uma linha por objeto, lida por `key`
 * @param {boolean} [opts.filtro=true] - botões de filtro no cabeçalho
 * @param {Date} [opts.data] - carimbo de tempo do ZIP (fixo em teste)
 * @returns {Buffer} o arquivo .ods
 */
const criarOds = ({ aba, colunas, linhas = [], filtro = true, data } = {}) => {
  if (!aba) throw new Error('criarOds: falta o nome da aba')
  if (!Array.isArray(colunas) || colunas.length === 0) {
    throw new Error('criarOds: falta a definição das colunas')
  }

  const estilosColuna = colunas
    .map((c, i) => `
  <style:style style:name="co${i + 1}" style:family="table-column">
   <style:table-column-properties fo:break-before="auto" style:column-width="${c.largura || '2.115cm'}"/>
  </style:style>`)
    .join('')

  const declColunas = colunas
    .map((c, i) => `<table:table-column table:style-name="co${i + 1}" table:default-cell-style-name="ceDado"/>`)
    .join('')

  const linhaCabecalho = `<table:table-row>${colunas
    .map(c => celula(c.label, 'texto', 'ceCab'))
    .join('')}</table:table-row>`

  const linhasDados = linhas
    .map(linha => `<table:table-row>${colunas
      .map(c => {
        const tipo = c.tipo || 'texto'
        const estilo = tipo === 'data' ? 'ceData' : 'ceDado'
        return celula(linha[c.key], tipo, estilo)
      })
      .join('')}</table:table-row>`)
    .join('')

  const ultimaColuna = letraColuna(colunas.length - 1)
  const ultimaLinha = linhas.length + 1
  const faixaFiltro = filtro
    ? `<table:database-ranges>
   <table:database-range table:name="__Anonymous_Sheet_DB__0" table:target-range-address="${aba}.A1:${aba}.${ultimaColuna}${ultimaLinha}" table:display-filter-buttons="true"/>
  </table:database-ranges>`
    : ''

  const contentXml = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content ${NS} office:version="1.3">
 <office:automatic-styles>${estilosColuna}${ESTILO_DATA}${ESTILOS_CELULA}
 </office:automatic-styles>
 <office:body>
  <office:spreadsheet>
   <table:table table:name="${escaparXml(aba)}">
    ${declColunas}
    ${linhaCabecalho}
    ${linhasDados}
   </table:table>
   ${faixaFiltro}
  </office:spreadsheet>
 </office:body>
</office:document-content>`

  const metaXml = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-meta ${NS} office:version="1.3">
 <office:meta>
  <meta:generator xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0">SCA - Controle do Acervo, 1o CGEO</meta:generator>
 </office:meta>
</office:document-meta>`

  return zipar([
    // Primeira e sem compressão: exigência do ODF.
    { nome: 'mimetype', conteudo: Buffer.from('application/vnd.oasis.opendocument.spreadsheet', 'utf8'), comprimir: false },
    { nome: 'META-INF/manifest.xml', conteudo: Buffer.from(MANIFEST_XML, 'utf8') },
    { nome: 'styles.xml', conteudo: Buffer.from(STYLES_XML, 'utf8') },
    { nome: 'meta.xml', conteudo: Buffer.from(metaXml, 'utf8') },
    { nome: 'content.xml', conteudo: Buffer.from(contentXml, 'utf8') }
  ], data)
}

/**
 * Envia o .ods como download.
 * @param {Object} res - response do Express
 * @param {string} filename - nome do arquivo baixado
 * @param {Object} opts - o mesmo objeto de criarOds
 */
const sendOds = (res, filename, opts) => {
  const buffer = criarOds(opts)
  res.setHeader('Content-Type', 'application/vnd.oasis.opendocument.spreadsheet')
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
  res.setHeader('Content-Length', String(buffer.length))
  return res.end(buffer)
}

module.exports = { criarOds, sendOds, letraColuna, partesData }
