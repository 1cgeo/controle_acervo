'use strict'

// A aba META4_DETALHADA do RTM, gerada A PARTIR DA PLANILHA-SEMENTE, e não
// redesenhada. Mesmo princípio do Anuário (ver rpcmtec/anuario_ods.js).
//
// O QUE ISSO RESOLVE. O arquivo era montado do zero por `utils/ods_export`, com
// largura de coluna e estilo NOSSOS. O conteúdo já batia com o modelo -- as 15
// colunas, os rótulos, o número como número e a data como data --, mas o
// envelope não: o modelo traz `settings.xml` e `Configurations2/` (a posição da
// janela, o painel congelado no cabeçalho, o zoom) e o gerado não trazia
// nenhum dos dois. Quem cola no RTM cola numa aba que já existe, e a aba tem de
// abrir igual à de sempre.
//
// A SEMENTE é `modelos/rtm_meta4_detalhada.ods`: o arquivo real, com as 1.628
// linhas de DADOS removidas. Sobraram a declaração das colunas, a linha de
// cabeçalho, os estilos, o `settings.xml` e o `Configurations2/` -- 29 KB contra
// os 3,5 MB do original. Tirar os dados não foi só economia: eles traziam nome
// de OM e quantidade entregue, e este repositório é PÚBLICO.
//
// COMO AS LINHAS ENTRAM. Cada linha nova copia os estilos que a semente usa nas
// dela: `ro2` na linha, `ce130` no texto e no número, `ce156` na data e `ce134`
// na observação. Eles não são inventados aqui -- foram lidos do modelo, e é por
// isso que a aba gerada abre com a mesma cara.

const fs = require('fs')
const path = require('path')

const { AppError, httpCode } = require('../utils')
const { desziparParaMapa, reescreverOds } = require('../utils/ods_export')

const CAMINHO_SEMENTE = path.join(__dirname, 'modelos', 'rtm_meta4_detalhada.ods')

// Os estilos que o modelo usa nas linhas de dados. Medidos em
// "META4_DETALHADA.ods" (2026-08-01).
const ESTILO_LINHA = 'ro2'
const ESTILO_CELULA = 'ce130'
const ESTILO_DATA = 'ce156'
const ESTILO_OBSERVACAO = 'ce134'

// O modelo fecha cada linha com uma célula repetida que preenche o resto da
// planilha. Sem ela a linha gerada tem largura diferente das do modelo.
const COLUNAS_DE_SOBRA = 1007

const escaparXml = texto => String(texto)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')

const celulaTexto = (valor, estilo = ESTILO_CELULA) => {
  if (valor == null || valor === '') {
    return `<table:table-cell table:style-name="${estilo}"/>`
  }
  return `<table:table-cell table:style-name="${estilo}" office:value-type="string" ` +
    `calcext:value-type="string"><text:p>${escaparXml(valor)}</text:p></table:table-cell>`
}

// NÚMERO de verdade, e não texto: é o que a planilha de destino soma. Texto
// passaria despercebido e zeraria a coluna no RTM.
const celulaNumero = valor => {
  if (valor == null || valor === '') {
    return `<table:table-cell table:style-name="${ESTILO_CELULA}"/>`
  }
  const n = Number(valor)
  if (!Number.isFinite(n)) return celulaTexto(valor)
  return `<table:table-cell table:style-name="${ESTILO_CELULA}" office:value-type="float" ` +
    `office:value="${n}" calcext:value-type="float"><text:p>${n}</text:p></table:table-cell>`
}

// DATA de verdade (office:date-value em ISO), com o texto visível em DD/MM/AA,
// que é como o modelo a escreve. Sem o valor ISO o Calc reinterpreta a string
// com a localidade de quem abre, e 10/02/26 vira outubro em quem usa MM/DD.
//
// A data chega como 'YYYY-MM-DD' (a coluna é DATE) ou como Date; nos dois casos
// os componentes são lidos SEM passar por fuso, senão o dia anda para trás.
const celulaData = valor => {
  if (!valor) return `<table:table-cell table:style-name="${ESTILO_DATA}"/>`

  const iso = valor instanceof Date
    ? `${valor.getFullYear()}-${String(valor.getMonth() + 1).padStart(2, '0')}-${String(valor.getDate()).padStart(2, '0')}`
    : String(valor).slice(0, 10)

  const [ano, mes, dia] = iso.split('-')
  if (!ano || !mes || !dia) return celulaTexto(String(valor), ESTILO_DATA)

  const visivel = `${dia}/${mes}/${ano.slice(2)}`
  return `<table:table-cell table:style-name="${ESTILO_DATA}" office:value-type="date" ` +
    `office:date-value="${iso}" calcext:value-type="date">` +
    `<text:p>${visivel}</text:p></table:table-cell>`
}

// As 15 colunas da aba, na ordem do modelo. A chave é a que
// `mapoteca/relatorio_ctrl.paraAbaMeta4` devolve.
const COLUNAS = [
  { key: 'omds' },
  { key: 'demandante' },
  { key: 'om_destino' },
  { key: 'previsto_pit' },
  { key: 'meta' },
  { key: 'produto' },
  { key: 'mi' },
  { key: 'escala' },
  { key: 'quantidade_prevista', tipo: 'numero' },
  { key: 'material_previsto' },
  { key: 'quantidade_fornecida', tipo: 'numero' },
  { key: 'material_fornecido' },
  { key: 'data_entrega', tipo: 'data' },
  { key: 'forma_entrega' },
  { key: 'observacao', estilo: ESTILO_OBSERVACAO }
]

const montarLinha = linha => {
  const celulas = COLUNAS.map(coluna => {
    const valor = linha[coluna.key]
    if (coluna.tipo === 'numero') return celulaNumero(valor)
    if (coluna.tipo === 'data') return celulaData(valor)
    return celulaTexto(valor, coluna.estilo)
  })

  return `<table:table-row table:style-name="${ESTILO_LINHA}">` +
    celulas.join('') +
    `<table:table-cell table:number-columns-repeated="${COLUNAS_DE_SOBRA}"/>` +
    '</table:table-row>'
}

/**
 * Gera o .ods da aba META4_DETALHADA a partir da semente.
 *
 * @param {Array<Object>} linhas - o que mapoteca/relatorio_ctrl.paraAbaMeta4 devolve
 * @returns {Buffer}
 */
const gerarRtmOds = linhas => {
  const semente = fs.readFileSync(CAMINHO_SEMENTE)
  const conteudo = desziparParaMapa(semente).get('content.xml').toString('utf8')

  // A semente tem UMA linha, a do cabeçalho. As de dados entram logo depois
  // dela, antes de </table:table>. Conferir isso aqui é o que impede uma
  // semente trocada por engano de gerar um arquivo com o cabeçalho no meio.
  const linhasNaSemente = (conteudo.match(/<table:table-row/g) || []).length
  if (linhasNaSemente !== 1) {
    throw new AppError(
      `A planilha-semente do RTM deveria ter só a linha de cabeçalho, e tem ${linhasNaSemente}`,
      httpCode.InternalServerError
    )
  }

  const fimCabecalho = conteudo.indexOf('</table:table-row>') + '</table:table-row>'.length
  const novoConteudo = conteudo.slice(0, fimCabecalho) +
    linhas.map(montarLinha).join('') +
    conteudo.slice(fimCabecalho)

  return reescreverOds(semente, { 'content.xml': novoConteudo })
}

module.exports = { gerarRtmOds, CAMINHO_SEMENTE, COLUNAS }
