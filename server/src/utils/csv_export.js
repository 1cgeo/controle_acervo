'use strict'

const httpCode = require('./http_code')

/**
 * Conversão de resultados de query (array de objetos) para CSV.
 * Formato amigável ao Excel pt-BR: separador ';', BOM UTF-8 e datas DD/MM/YYYY.
 */

const UTF8_BOM = String.fromCharCode(0xFEFF)

const pad = n => String(n).padStart(2, '0')

// A COLUNA DATE NÃO CHEGA COMO `Date`, e chegar a este arquivo como texto é o
// desenho, não um acidente: `database/db.js` registra
// `setTypeParser(1082, valor => valor)`, e por isso toda coluna DATE volta como
// a string crua 'AAAA-MM-DD'. Sem esta linha, o mesmo CSV saía com DOIS
// formatos de data -- `data_pedido` e `prazo` (DATE) em 2026-08-01, e qualquer
// coluna TIMESTAMPTZ do mesmo relatório em 14/08/2026. O Excel pt-BR lê a
// primeira forma como TEXTO, e ordenar ou filtrar por mês deixa de funcionar
// justamente na coluna pela qual o relatório é lido.
//
// Casa a forma INTEIRA e nada mais: um texto que só comece com uma data
// (`2026-08-01 a 2026-08-31`) continua saindo como veio.
const DIA_ISO = /^(\d{4})-(\d{2})-(\d{2})$/

const formatValue = value => {
  if (value === null || value === undefined) {
    return ''
  }
  if (value instanceof Date) {
    return `${pad(value.getDate())}/${pad(value.getMonth() + 1)}/${value.getFullYear()}`
  }
  if (typeof value === 'string') {
    const dia = DIA_ISO.exec(value)
    if (dia) {
      const [, ano, mes, diaDoMes] = dia
      return `${diaDoMes}/${mes}/${ano}`
    }
  }
  if (typeof value === 'boolean') {
    return value ? 'Sim' : 'Não'
  }
  if (Array.isArray(value)) {
    return value.join(', ')
  }
  return String(value)
}

// Valores começando com = + - @ executariam como fórmula no Excel (CSV
// injection). Prefixa com apóstrofo, exceto números legítimos (ex: -5).
const neutralizeFormula = s => {
  if (/^[=+\-@]/.test(s) && !/^-?\d+([.,]\d+)?$/.test(s)) {
    return `'${s}`
  }
  return s
}

const escapeValue = value => {
  const s = neutralizeFormula(formatValue(value))
  if (/[";\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

/**
 * Converte linhas em CSV.
 * @param {Array<Object>} rows - linhas (objetos chave/valor)
 * @param {Array<{key: string, label: string}>} [columns] - colunas na ordem desejada;
 *   se omitido, usa as chaves da primeira linha como cabeçalho
 * @returns {string} CSV com BOM UTF-8
 */
const toCsv = (rows, columns = null) => {
  const cols = columns || (rows.length > 0
    ? Object.keys(rows[0]).map(key => ({ key, label: key }))
    : [])

  const header = cols.map(c => escapeValue(c.label)).join(';')
  const lines = rows.map(row => cols.map(c => escapeValue(row[c.key])).join(';'))

  return UTF8_BOM + [header, ...lines].join('\r\n')
}

/**
 * Envia a resposta como JSON padrão ou como download CSV, conforme o formato.
 * @param {Object} res - response do Express
 * @param {string} formato - 'json' ou 'csv'
 * @param {string} msg - mensagem para a resposta JSON
 * @param {Array<Object>} rows - linhas do relatório
 * @param {Object} opts - { filename, columns }
 */
const sendReport = (res, formato, msg, rows, { filename, columns = null } = {}) => {
  if (formato === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    return res.send(toCsv(rows, columns))
  }
  return res.sendJsonAndLog(true, msg, httpCode.OK, rows)
}

module.exports = { toCsv, sendReport }
