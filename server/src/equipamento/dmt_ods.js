'use strict'

// O Relatorio DMT em .ods, gerado A PARTIR DA PLANILHA-SEMENTE, e nao
// redesenhado. Mesmo principio do RTM (ver rpcmtec/rtm_ods.js) e do Anuario.
//
// O QUE ISSO RESOLVE. Quem recebe o relatorio confere um arquivo que a Secao ja
// conhece: as faixas coloridas do cabecalho (Inventario Geral em cinza,
// Afastamento em verde, Indisponibilidade em vermelho, Transferencia em azul),
// a mesclagem dessas faixas, a largura de cada uma das 26 colunas, o
// `settings.xml` e o `Configurations2/`. Montar a planilha do zero daria os
// numeros certos num arquivo que nao e o da Secao.
//
// A SEMENTE e `modelos/relatorio_dmt.ods`, fabricada a partir do
// "Relatorio DMT 1 CGEO" de 2026-08-03 com as 105 LINHAS DE DADO REMOVIDAS.
// Elas traziam numero de patrimonio, OM de afastamento e valor orcado, e este
// repositorio e PUBLICO -- e o mesmo motivo que o rtm_ods.js documenta. A
// miniatura embutida (`Thumbnails/thumbnail.png`) tambem saiu: era uma imagem
// das 105 linhas.
//
// O QUE SOBROU NA SEMENTE: TRES linhas. Duas de cabecalho (a das faixas
// mescladas e a dos rotulos) e uma linha-modelo, que traz so o traco em cada
// uma das 26 colunas e serve para declarar o estilo de celula de cada coluna.
//
// COMO AS LINHAS ENTRAM. A linha-modelo e SUBSTITUIDA pelas linhas geradas: se
// ela ficasse, toda planilha entregue comecaria com uma linha de exemplo cheia
// de tracos. Os estilos abaixo foram LIDOS da linha-modelo, e nao inventados.

const fs = require('fs')
const path = require('path')

const { AppError, httpCode } = require('../utils')
const { desziparParaMapa, reescreverOds } = require('../utils/ods_export')

const CAMINHO_SEMENTE = path.join(__dirname, 'modelos', 'relatorio_dmt.ods')

// Duas de cabecalho mais a linha-modelo. Medido na semente em 2026-08-08.
const LINHAS_NA_SEMENTE = 3

// Estilos medidos na semente. `ce22` carrega o formato de data N37 (DD/MM/AA) e
// `ce12` o de moeda N104 (R$ com duas casas); os demais so mudam a fonte e a
// borda. Nao invente codigo aqui: um `ce` que a semente nao declara faz o Calc
// abrir a celula com o estilo padrao, sem borda.
const ESTILO_LINHA = 'ro3'
const ESTILO_TEXTO = 'ce7'
const ESTILO_CHAVE = 'ce2'
const ESTILO_TIPO = 'ce36'
const ESTILO_PATRIMONIO = 'ce31'
const ESTILO_DATA = 'ce22'
const ESTILO_MOEDA = 'ce12'

// O modelo fecha cada linha com duas celulas repetidas que preenchem o resto da
// planilha: 26 + 998 + 15360 sao as 16384 colunas do Calc. Sem elas a linha
// gerada tem largura diferente das do modelo.
const CELULAS_DE_SOBRA =
  '<table:table-cell table:style-name="ce17" table:number-columns-repeated="998"/>' +
  '<table:table-cell table:number-columns-repeated="15360"/>'

// A convencao DESTE documento: celula sem dado traz o traco, e nao celula
// vazia. O RTM emite vazio; aqui vazio faria o arquivo entregue nao parecer o
// da Secao.
const TRACO = '-'

const escaparXml = texto => String(texto)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')

// Texto de varias linhas vira varios <text:p>: o ODF colapsa a quebra de linha
// crua, e motivo e descricao chegam com quebra.
const paragrafos = valor => String(valor)
  .split(/\r?\n/)
  .map(linha => `<text:p>${escaparXml(linha)}</text:p>`)
  .join('')

const celulaTexto = (valor, estilo = ESTILO_TEXTO) => {
  const texto = valor == null || valor === '' ? TRACO : valor
  return `<table:table-cell table:style-name="${estilo}" office:value-type="string" ` +
    `calcext:value-type="string">${paragrafos(texto)}</table:table-cell>`
}

// NUMERO de verdade, e nao texto: e o que a planilha soma e ordena. O visivel
// sai com virgula decimal, que e como o Calc em pt-BR o reescreve.
const celulaNumero = (valor, estilo = ESTILO_TEXTO) => {
  if (valor == null || valor === '') return celulaTexto(null, estilo)
  const n = Number(valor)
  if (!Number.isFinite(n)) return celulaTexto(valor, estilo)
  const visivel = String(n).replace('.', ',')
  return `<table:table-cell table:style-name="${estilo}" office:value-type="float" ` +
    `office:value="${n}" calcext:value-type="float"><text:p>${visivel}</text:p></table:table-cell>`
}

const formatarMoeda = n => {
  const [inteiro, centavos] = Math.abs(n).toFixed(2).split('.')
  const agrupado = inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${n < 0 ? '-' : ''}R$ ${agrupado},${centavos}`
}

const celulaMoeda = valor => {
  if (valor == null || valor === '') return celulaTexto(null, ESTILO_MOEDA)
  const n = Number(valor)
  if (!Number.isFinite(n)) return celulaTexto(valor, ESTILO_MOEDA)
  return `<table:table-cell table:style-name="${ESTILO_MOEDA}" office:value-type="currency" ` +
    `office:currency="BRL" office:value="${n}" calcext:value-type="currency">` +
    `<text:p>${escaparXml(formatarMoeda(n))}</text:p></table:table-cell>`
}

// DATA de verdade (office:date-value em ISO), com o visivel em DD/MM/AA, que e
// como o modelo a escreve. Sem o valor ISO o Calc reinterpreta a string com a
// localidade de quem abre, e 10/02/26 vira outubro em quem usa MM/DD.
//
// A data chega como Date ou como 'YYYY-MM-DD' (a coluna e DATE); nos dois casos
// os componentes sao lidos SEM passar por fuso, senao o dia anda para tras.
const celulaData = valor => {
  if (!valor) return celulaTexto(null, ESTILO_DATA)

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

// O booleano do banco em papel. Nulo continua traco: um bem sem transferencia
// nenhuma nao respondeu "Nao", ele nao foi perguntado.
const celulaSimNao = valor => {
  if (valor == null) return celulaTexto(null)
  return celulaTexto(valor ? 'Sim' : 'Não')
}

const ehData = valor => valor instanceof Date ||
  (typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}/.test(valor))

// A coluna 19 aceita as duas coisas: o gestor tanto escreve uma data prevista
// quanto uma frase ("solicitado descarga").
const celulaTextoOuData = valor => {
  if (valor == null || valor === '') return celulaTexto(null)
  return ehData(valor) ? celulaData(valor) : celulaTexto(valor)
}

// O cabecalho da Secao pede ANOS e o sistema guarda MESES. Duas casas bastam:
// as vidas uteis do QDMP sao 60, 120 e 180 meses, e todas dao ano inteiro.
const vidaUtilEmAnos = meses => {
  if (meses == null || meses === '') return null
  const n = Number(meses)
  if (!Number.isFinite(n)) return null
  return Number((n / 12).toFixed(2))
}

// As 26 colunas do documento, na ordem em que a Secao as imprime. A chave e a
// que o controlador do modulo devolve, uma linha por bem.
const COLUNAS = [
  { key: null, tipo: 'ordem', estilo: ESTILO_CHAVE }, // 1  ID (ROW_NUMBER, nao o id do banco)
  { key: 'classe', estilo: ESTILO_CHAVE }, // 2  Classe
  { key: 'tipo', estilo: ESTILO_TIPO }, // 3  Tipo Equipamento (conforme QDMP)
  { key: 'modelo' }, // 4  Modelo
  { key: 'nr_patrimonio', estilo: ESTILO_PATRIMONIO }, // 5  Patrimonio, SEMPRE texto
  { key: 'data_entrada_carga', tipo: 'data' }, // 6  Data Entrada em Carga
  { key: 'vida_util_meses', tipo: 'anos' }, // 7  Tempo de Vida util Previsto (anos)
  { key: 'secao_detentora' }, // 8  Secao ou Deposito responsavel
  { key: 'situacao' }, // 9  Situacao
  { key: 'afastamento_om' }, // 10 Local
  { key: 'afastamento_motivo' }, // 11 Motivo afastamento OM
  { key: 'afastamento_data_inicio', tipo: 'data' }, // 12 Inicio afastamento
  { key: 'afastamento_previsao_termino', tipo: 'data' }, // 13 Previsao termino afastamento
  { key: 'indisponibilidade_motivo' }, // 14 Motivo Indisponibilidade
  { key: 'indisponibilidade_data_inicio', tipo: 'data' }, // 15 Data inicio Indisponibilidade
  { key: 'manutencao_valor_orcado', tipo: 'moeda' }, // 16 Orcamento (CGEO)
  { key: 'manutencao_valor_pdr', tipo: 'moeda' }, // 17 Previsao de recurso (PDR)
  { key: 'manutencao_certame' }, // 18 Certame
  { key: 'previsao_disponibilidade_ou_descarga', tipo: 'texto_ou_data' }, // 19
  { key: 'transferencia_om' }, // 20 OM - Origem ou Destino
  { key: 'transferencia_documento_solicitacao' }, // 21 Documento de solicitacao
  { key: 'transferencia_data', tipo: 'data' }, // 22 Data Transferencia
  { key: 'transferido_siafi', tipo: 'sim_nao' }, // 23 Transferido SIAFI
  { key: 'apropriado_siafi', tipo: 'sim_nao' }, // 24 Apropriado SIAFI
  { key: 'transferencia_publicacao' }, // 25 Publicacao de Autorizacao
  { key: 'transferencia_descricao' } // 26 Descricao
]

const montarCelula = (coluna, linha, indice) => {
  if (coluna.tipo === 'ordem') return celulaNumero(indice + 1, coluna.estilo)

  const valor = linha[coluna.key]

  if (coluna.tipo === 'data') return celulaData(valor)
  if (coluna.tipo === 'moeda') return celulaMoeda(valor)
  if (coluna.tipo === 'sim_nao') return celulaSimNao(valor)
  if (coluna.tipo === 'texto_ou_data') return celulaTextoOuData(valor)
  if (coluna.tipo === 'anos') return celulaNumero(vidaUtilEmAnos(valor), coluna.estilo)
  return celulaTexto(valor, coluna.estilo)
}

const montarLinha = (linha, indice) =>
  `<table:table-row table:style-name="${ESTILO_LINHA}">` +
  COLUNAS.map(coluna => montarCelula(coluna, linha, indice)).join('') +
  CELULAS_DE_SOBRA +
  '</table:table-row>'

/**
 * Gera o .ods do Relatório DMT a partir da semente.
 *
 * @param {Array<Object>} linhas - um objeto por bem, JÁ na ordem de saída
 * @returns {Promise<Buffer>}
 */
const gerarRelatorioDmt = async linhas => {
  const dados = Array.isArray(linhas) ? linhas : []

  const semente = await fs.promises.readFile(CAMINHO_SEMENTE)
  const conteudo = desziparParaMapa(semente).get('content.xml').toString('utf8')

  // Conferir a contagem aqui e o que impede uma semente trocada por engano de
  // gerar um arquivo com o cabecalho no meio da planilha.
  const linhasNaSemente = (conteudo.match(/<table:table-row/g) || []).length
  if (linhasNaSemente !== LINHAS_NA_SEMENTE) {
    throw new AppError(
      'A planilha-semente do Relatório DMT deveria ter ' +
      `${LINHAS_NA_SEMENTE} linhas (duas de cabeçalho e uma de modelo), e tem ${linhasNaSemente}`,
      httpCode.InternalError
    )
  }

  // As duas primeiras linhas sao o cabecalho e ficam intactas. A TERCEIRA e a
  // linha-modelo, e e ela que as linhas geradas substituem.
  let inicioModelo = -1
  for (let i = 0; i < LINHAS_NA_SEMENTE; i++) {
    inicioModelo = conteudo.indexOf('<table:table-row', inicioModelo + 1)
  }
  const fimModelo = conteudo.indexOf('</table:table-row>', inicioModelo) + '</table:table-row>'.length

  const novoConteudo = conteudo.slice(0, inicioModelo) +
    dados.map(montarLinha).join('') +
    conteudo.slice(fimModelo)

  return reescreverOds(semente, { 'content.xml': novoConteudo })
}

module.exports = { gerarRelatorioDmt, CAMINHO_SEMENTE, COLUNAS }
