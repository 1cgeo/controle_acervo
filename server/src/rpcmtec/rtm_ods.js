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

// Os estilos que o modelo usa nas linhas de dados, medidos em
// "META4_DETALHADA.ods".
const ESTILO_LINHA = 'ro2'
const ESTILO_CELULA = 'ce130'
const ESTILO_DATA = 'ce156'
const ESTILO_OBSERVACAO = 'ce134'

// O modelo fecha cada linha com uma célula repetida que preenche o resto da
// planilha. Sem ela a linha gerada tem largura diferente das do modelo. Quanto
// ela repete sai de `ABAS[<aba>].largura`, porque as três abas diferem.

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

// As 15 colunas da aba META4, na ordem do modelo. A chave é a que
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

// As 13 colunas da aba META1_DETALHADA, medidas no RTM de agosto de 2026.
//
// `data_carga_bdgex` SAI SEMPRE VAZIA, e é decisão do Chefe da DGEO de
// 2026-09-11. A data da carga no BDGEx não existe no banco: a busca no `er/`
// inteiro por `data_carga|data_carregamento|bdgex_id|id_bdgex|data_publicacao`
// devolve zero, e o que existe (`acervo.arquivo.situacao_carregamento_id`) diz
// o ONDE e nunca o QUANDO. Em vez de criar coluna, o chefe preferiu deixar a
// célula em branco para preenchimento à mão, como é hoje. A coluna fica aqui,
// na posição certa, para a aba abrir com a mesma forma de sempre.
//
// `meta` é TEXTO de propósito, mesmo valendo "1.1". No RTM de agosto uma linha
// saiu como número, porque alguém digitou `2` sem ponto, e aí o Calc alinha à
// direita e a coluna deixa de casar com as outras.
const COLUNAS_META1 = [
  { key: 'omds' },
  { key: 'demandante' },
  { key: 'meta' },
  { key: 'produto' },
  { key: 'mi' },
  { key: 'escala' },
  { key: 'projeto_sap' },
  { key: 'lote_sap' },
  { key: 'bloco_sap' },
  { key: 'data_carga_bdgex', tipo: 'data' },
  { key: 'id_carga_bdgex' },
  { key: 'local_carga' },
  { key: 'observacao', estilo: ESTILO_OBSERVACAO }
]

// As 7 colunas da aba EXTRA_PIT. `quantidade` é NÚMERO: é coluna que a DSG soma.
const COLUNAS_EXTRA_PIT = [
  { key: 'omds' },
  { key: 'demandante' },
  { key: 'descricao' },
  { key: 'quantidade', tipo: 'numero' },
  { key: 'data_conclusao', tipo: 'data' },
  { key: 'documento_autorizacao' },
  { key: 'observacao', estilo: ESTILO_OBSERVACAO }
]

// UMA SEMENTE POR ABA, e não uma semente com três tabelas. É como o RTM é
// colado: quem monta o relatório abre a aba que falta e cola por cima da que já
// existe, uma de cada vez.
//
// A LARGURA TOTAL difere entre as abas (1022, 1023 e 1024 colunas), medida no
// RTM preenchido. Ela não é enfeite: a célula repetida que fecha a linha tem de
// casar com a declaração de colunas da semente, senão a linha gerada fica mais
// estreita que as do modelo e o Calc desenha a borda no lugar errado.
const ABAS = {
  meta4: {
    nome: 'META4_DETALHADA',
    semente: path.join(__dirname, 'modelos', 'rtm_meta4_detalhada.ods'),
    colunas: COLUNAS,
    largura: 1022
  },
  meta1: {
    nome: 'META1_DETALHADA',
    semente: path.join(__dirname, 'modelos', 'rtm_meta1_detalhada.ods'),
    colunas: COLUNAS_META1,
    largura: 1023
  },
  extraPit: {
    nome: 'EXTRA_PIT',
    semente: path.join(__dirname, 'modelos', 'rtm_extra_pit.ods'),
    colunas: COLUNAS_EXTRA_PIT,
    largura: 1024
  }
}

const montarLinha = (aba, linha) => {
  const celulas = aba.colunas.map(coluna => {
    const valor = linha[coluna.key]
    if (coluna.tipo === 'numero') return celulaNumero(valor)
    if (coluna.tipo === 'data') return celulaData(valor)
    return celulaTexto(valor, coluna.estilo)
  })

  const sobra = aba.largura - aba.colunas.length
  return `<table:table-row table:style-name="${ESTILO_LINHA}">` +
    celulas.join('') +
    `<table:table-cell table:number-columns-repeated="${sobra}"/>` +
    '</table:table-row>'
}

/**
 * Gera o .ods de UMA aba do RTM a partir da semente dela.
 *
 * @param {Object} aba - uma entrada de ABAS
 * @param {Array<Object>} linhas - objetos com as chaves que `aba.colunas` declara
 * @returns {Buffer}
 */
const gerarAbaOds = (aba, linhas) => {
  const semente = fs.readFileSync(aba.semente)
  const conteudo = desziparParaMapa(semente).get('content.xml').toString('utf8')

  // A semente tem UMA linha, a do cabeçalho. As de dados entram logo depois
  // dela, antes de </table:table>. Conferir isso aqui é o que impede uma
  // semente trocada por engano de gerar um arquivo com o cabeçalho no meio.
  const linhasNaSemente = (conteudo.match(/<table:table-row/g) || []).length
  if (linhasNaSemente !== 1) {
    throw new AppError(
      `A planilha-semente de ${aba.nome} deveria ter só a linha de cabeçalho, e tem ${linhasNaSemente}`,
      httpCode.InternalError
    )
  }

  // A SEMENTE CERTA para a aba certa. Sem esta guarda, trocar o caminho por
  // engano gera um arquivo que abre, com o cabeçalho de uma aba e os dados de
  // outra: o Calc não reclama, e quem cola no RTM só descobre depois.
  if (!conteudo.includes(`table:name="${aba.nome}"`)) {
    throw new AppError(
      `A planilha-semente de ${aba.nome} não traz uma tabela com esse nome`,
      httpCode.InternalError
    )
  }

  const fimCabecalho = conteudo.indexOf('</table:table-row>') + '</table:table-row>'.length
  const novoConteudo = conteudo.slice(0, fimCabecalho) +
    linhas.map(linha => montarLinha(aba, linha)).join('') +
    conteudo.slice(fimCabecalho)

  return reescreverOds(semente, { 'content.xml': novoConteudo })
}

/**
 * Gera o .ods da aba META4_DETALHADA. Mantida com a assinatura de sempre porque
 * duas rotas a chamam (a da mapoteca e a do rpcmtec).
 *
 * @param {Array<Object>} linhas - o que mapoteca/relatorio_ctrl.paraAbaMeta4 devolve
 * @returns {Buffer}
 */
const gerarRtmOds = linhas => gerarAbaOds(ABAS.meta4, linhas)

/** A aba META1_DETALHADA, uma folha MI da Meta 1 por linha. */
const gerarMeta1Ods = linhas => gerarAbaOds(ABAS.meta1, linhas)

/** A aba EXTRA_PIT, uma demanda autorizada fora do plano por linha. */
const gerarExtraPitOds = linhas => gerarAbaOds(ABAS.extraPit, linhas)

module.exports = {
  gerarRtmOds,
  gerarMeta1Ods,
  gerarExtraPitOds,
  gerarAbaOds,
  ABAS,
  CAMINHO_SEMENTE,
  COLUNAS,
  COLUNAS_META1,
  COLUNAS_EXTRA_PIT
}
