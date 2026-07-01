// Path: relatorio\relatorio_ctrl.js
'use strict'

// Gerador do RPCMTec - Seção Acervo (Estado do Acervo, Produtos Entregues,
// Mapoteca + Insumos de Impressão, LAI/Órgãos Públicos e Totais Consolidados).
// Não faz nenhuma query nova: compõe, em JS, o que os controllers já expostos
// (integracao_ctrl, acervo_ctrl, mapoteca_ctrl) já calculam para outras rotas.

const { Document, Packer, Paragraph, HeadingLevel, Table, TableRow, TableCell, WidthType, TextRun } = require('docx')

const { db } = require('../database')
const acervoCtrl = require('../acervo/acervo_ctrl')
const integracaoCtrl = require('../integracao/integracao_ctrl')
const mapotecaCtrl = require('../mapoteca/mapoteca_ctrl')
const { domainConstants: { SITUACAO_PEDIDO, TIPO_CLIENTE } } = require('../utils')
const { QTD_EFETIVA, filtroPeriodoMes } = require('../mapoteca/query_fragments')

const controller = {}

// Tipos de cliente militares (Mapoteca) versus civis/LAI/órgãos públicos.
const TIPOS_CLIENTE_MILITAR = [
  TIPO_CLIENTE.OM_EB,
  TIPO_CLIENTE.OM_AERONAUTICA,
  TIPO_CLIENTE.OM_MARINHA
]

// Situações que já foram entregues; o resto (exceto Cancelado) conta como
// pendente. Cancelado não é "pendente" (não há mais nada a cobrar) nem
// "entregue" — fica de fora dos dois totais.
const SITUACOES_ENTREGUE = [SITUACAO_PEDIDO.REMETIDO, SITUACAO_PEDIDO.CONCLUIDO]

// Universo de folhas da ASC (Área de Suprimento Cartográfico, 576.000 km²) por
// escala; usado só para a % de cobertura da seção "Estado do Acervo". Fonte:
// RT 11/2025 (proposta de base contínua), confirmado pelo chefe da DGEO em
// 2026-07-01 (o RT registrava 250 para 1:100.000; o valor correto é 249).
const UNIVERSO_ASC = {
  '1:25.000': 3556,
  '1:50.000': 927,
  '1:100.000': 249,
  '1:250.000': 49
}

// Mapeia o "name" curto usado por SITUACAO_GERAL_ESCALAS ('25k'...) para o
// nome de exibição da escala (igual a dominio.tipo_escala.nome), que é o
// mesmo valor que produtos_finalizados devolve em `resumo[].escala`.
const ESCALA_NOME = {
  '25k': '1:25.000',
  '50k': '1:50.000',
  '100k': '1:100.000',
  '250k': '1:250.000'
}

const NAO_MAPEADO = 'Não mapeado'

const texto = valor => (valor == null || valor === '' ? '-' : String(valor))

const contaCobertas = (features) =>
  features.filter(f => f.properties.situacao_topo !== NAO_MAPEADO || f.properties.situacao_orto !== NAO_MAPEADO).length

const somaQuantidade = (lista) => lista.reduce((s, r) => s + (r.quantidade || 0), 0)

const contaSolicitantesDistintos = (lista) => new Set(lista.map(r => r.solicitante)).size

// ---------------------------------------------------------------------------
// 1) Estado do acervo, por escala.
// ---------------------------------------------------------------------------
const montaEstadoAcervo = ({ situacaoGeral, produtosMes }) => {
  return acervoCtrl.SITUACAO_GERAL_ESCALAS.map(e => {
    const escalaNome = ESCALA_NOME[e.name]
    const features = situacaoGeral[e.name] || []
    const totalCatalogado = contaCobertas(features)
    const catalogadoNoMes = produtosMes.resumo
      .filter(r => r.escala === escalaNome)
      .reduce((s, r) => s + r.quantidade, 0)
    const universo = UNIVERSO_ASC[escalaNome] || null

    return {
      escala: escalaNome,
      total_catalogado: totalCatalogado,
      catalogado_no_mes: catalogadoNoMes,
      universo_asc: universo,
      percentual_asc: universo ? Math.round((totalCatalogado / universo) * 1000) / 10 : null
    }
  })
}

// ---------------------------------------------------------------------------
// 2) Produtos entregues no mês/ano, agrupados por tipo (soma de todas as
// escalas). Inclui uma linha de "Total geral".
// ---------------------------------------------------------------------------
const montaProdutosPorTipo = ({ produtosMes, produtosAno }) => {
  const agregaPorTipo = (resumo) => {
    const mapa = {}
    for (const r of resumo) {
      mapa[r.tipo_produto] = (mapa[r.tipo_produto] || 0) + r.quantidade
    }
    return mapa
  }

  const mesPorTipo = agregaPorTipo(produtosMes.resumo)
  const anoPorTipo = agregaPorTipo(produtosAno.resumo)
  const tipos = Array.from(new Set([...Object.keys(mesPorTipo), ...Object.keys(anoPorTipo)])).sort()

  const linhas = tipos.map(tipo => ({
    tipo_produto: tipo,
    quantidade_mes: mesPorTipo[tipo] || 0,
    quantidade_ano: anoPorTipo[tipo] || 0
  }))

  linhas.push({
    tipo_produto: 'Total geral',
    quantidade_mes: produtosMes.total,
    quantidade_ano: produtosAno.total
  })

  return linhas
}

// ---------------------------------------------------------------------------
// 3) e 4) Pedidos de mapoteca/LAI no período — por DATA DE CRIAÇÃO do pedido
// (data_pedido), com QUALQUER situação (ao contrário de
// integracaoCtrl.getMapotecaAtendimentos, que só traz pedidos já entregues
// por data de atendimento). É essa fonte mais ampla que reproduz o RPCMTec
// histórico, cujas seções 2.4/2.7 sempre mostraram tanto "Pendente" quanto
// "Entregue" no mesmo mês.
const getPedidosDoPeriodo = async ({ ano, mes, cumulativo }) => {
  const rows = await db.conn.any(
    `
    SELECT
      ped.id,
      c.nome AS solicitante,
      c.tipo_cliente_id,
      ped.situacao_pedido_id,
      sp.nome AS situacao,
      ped.documento_solicitacao,
      ped.documento_solicitacao_nup,
      ped.previsto_pit,
      COALESCE(SUM(${QTD_EFETIVA}), 0)::int AS quantidade
    FROM mapoteca.pedido ped
    JOIN mapoteca.cliente c ON c.id = ped.cliente_id
    JOIN mapoteca.situacao_pedido sp ON sp.code = ped.situacao_pedido_id
    LEFT JOIN mapoteca.produto_pedido pp ON pp.pedido_id = ped.id
    WHERE ${filtroPeriodoMes('ped.data_pedido', { cumulativo })}
    GROUP BY ped.id, c.nome, c.tipo_cliente_id, ped.situacao_pedido_id, sp.nome,
      ped.documento_solicitacao, ped.documento_solicitacao_nup, ped.previsto_pit
    ORDER BY ped.data_pedido, ped.id
    `,
    { ano, mes }
  )

  const ehMilitar = (r) => TIPOS_CLIENTE_MILITAR.includes(r.tipo_cliente_id)
  return {
    militar: rows.filter(ehMilitar),
    civil: rows.filter(r => !ehMilitar(r))
  }
}

// "Documento de solicitação" como o RPCMTec histórico exibe: o documento
// informado (DIEx/Ofício/NUP) ou, na falta dele, "PIT"/"Extra-PIT" derivado
// de previsto_pit (militar) — mesma regra da referência da skill
// gerar-relatorio-dgeo (rpcmtec-estrutura.md, 2.4).
const documentoExibicao = (r) => {
  if (r.documento_solicitacao) return r.documento_solicitacao
  if (r.documento_solicitacao_nup) return r.documento_solicitacao_nup
  if (r.previsto_pit === true) return 'PIT'
  if (r.previsto_pit === false) return 'Extra-PIT'
  return '-'
}

// Detalhe do mês, linha a linha, no formato exato do RPCMTec histórico:
// Solicitante | Documento de solicitação | Quantidade | Situação.
const montaDetalheEntregas = (lista) =>
  lista.map(r => ({
    solicitante: r.solicitante,
    documento: documentoExibicao(r),
    quantidade: r.quantidade,
    situacao: r.situacao
  }))

// Separa entregues (Remetido/Concluído) de pendentes (tudo, exceto Cancelado)
// e soma produtos/pedidos/solicitantes distintos de cada grupo.
const totaisPorSituacao = (lista) => {
  const entregues = lista.filter(r => SITUACOES_ENTREGUE.includes(r.situacao_pedido_id))
  const pendentes = lista.filter(r =>
    !SITUACOES_ENTREGUE.includes(r.situacao_pedido_id) && r.situacao_pedido_id !== SITUACAO_PEDIDO.CANCELADO)

  return {
    produtos: somaQuantidade(entregues),
    pedidos_entregues: entregues.length,
    pedidos_pendentes: pendentes.length,
    solicitantes: contaSolicitantesDistintos(entregues)
  }
}

// ---------------------------------------------------------------------------
// 3) Mapoteca (bloco militar dos pedidos do período) + insumos de impressão
// (mapoteca.tipo_material / estoque_material / consumo_material).
// ---------------------------------------------------------------------------
const montaMapotecaEInsumos = ({ pedidosMes, pedidosAno, tiposMaterial, consumoAno, mes }) => {
  const consumoDoMes = {}
  for (const linha of consumoAno) {
    if (Number(linha.mes) === Number(mes)) {
      consumoDoMes[linha.tipo_material_id] = Number(linha.quantidade)
    }
  }

  const insumos = tiposMaterial
    .filter(tm => tm.ativo)
    .map(tm => ({
      insumo: tm.nome,
      estoque_atual: Number(tm.estoque_total),
      consumo_no_mes: consumoDoMes[tm.id] || 0,
      abaixo_minimo: tm.abaixo_minimo
    }))

  return {
    totais_mes: totaisPorSituacao(pedidosMes.militar),
    totais_ano: totaisPorSituacao(pedidosAno.militar),
    insumos
  }
}

// ---------------------------------------------------------------------------
// 4) LAI e órgãos públicos (bloco civil dos pedidos do período).
// ---------------------------------------------------------------------------
const montaLai = ({ pedidosMes, pedidosAno }) => ({
  totais_mes: totaisPorSituacao(pedidosMes.civil),
  totais_ano: totaisPorSituacao(pedidosAno.civil)
})

// Achata um par de totais (mês/ano) numa lista de linhas indicador/mes/ano,
// a partir de uma lista de [rótulo, campo]. Usado tanto pela seção 3
// (Mapoteca) quanto pela 4 (LAI), e reaproveitado pela seção 5 (totais
// consolidados) — uma linha de indicador só existe num lugar.
const linhasIndicadores = (totaisMes, totaisAno, definicoes) =>
  definicoes.map(([indicador, campo]) => ({
    indicador,
    mes: totaisMes[campo],
    ano: totaisAno[campo]
  }))

// ---------------------------------------------------------------------------
// 5) Totais do mês e do ano, consolidados numa visão só (junta o total geral
// de produtos entregues com as linhas já montadas de Mapoteca e LAI).
// ---------------------------------------------------------------------------
const montaTotaisConsolidados = ({ produtosPorTipo, mapotecaLinhas, laiLinhas }) => {
  const totalGeral = produtosPorTipo.find(l => l.tipo_produto === 'Total geral') ||
    { quantidade_mes: 0, quantidade_ano: 0 }

  const prefixar = (prefixo, linhas) =>
    linhas.map(l => ({ indicador: `${prefixo} - ${l.indicador}`, mes: l.mes, ano: l.ano }))

  return [
    { indicador: 'Produtos entregues (todos os tipos)', mes: totalGeral.quantidade_mes, ano: totalGeral.quantidade_ano },
    ...prefixar('Mapoteca', mapotecaLinhas),
    ...prefixar('LAI e órgãos públicos', laiLinhas)
  ]
}

// ---------------------------------------------------------------------------
// Orquestrador: busca tudo em paralelo (uma vez só por período) e monta as
// 6 seções a partir dos mesmos dados. O mesmo objeto alimenta o preview em
// tela (rota JSON) e o export DOCX.
// ---------------------------------------------------------------------------
controller.gerarRelatorioAcervo = async ({ ano, mes }) => {
  const [
    situacaoGeral,
    produtosMes,
    produtosAno,
    pedidosMes,
    pedidosAno,
    tiposMaterial,
    consumoAno
  ] = await Promise.all([
    integracaoCtrl.getSituacaoGeral({}),
    integracaoCtrl.getProdutosFinalizados({ ano, mes, cumulativo: false }),
    integracaoCtrl.getProdutosFinalizados({ ano, mes, cumulativo: true }),
    getPedidosDoPeriodo({ ano, mes, cumulativo: false }),
    getPedidosDoPeriodo({ ano, mes, cumulativo: true }),
    mapotecaCtrl.getTiposMaterial(),
    mapotecaCtrl.getConsumoMensalPorTipo(ano)
  ])

  const estadoAcervo = montaEstadoAcervo({ situacaoGeral, produtosMes })
  const produtosPorTipo = montaProdutosPorTipo({ produtosMes, produtosAno })
  const mapotecaEInsumos = montaMapotecaEInsumos({ pedidosMes, pedidosAno, tiposMaterial, consumoAno, mes })
  const lai = montaLai({ pedidosMes, pedidosAno })

  const mapotecaLinhas = linhasIndicadores(mapotecaEInsumos.totais_mes, mapotecaEInsumos.totais_ano, [
    ['Produtos entregues', 'produtos'],
    ['Quantidade de pedidos entregues', 'pedidos_entregues'],
    ['Quantidade de pedidos pendentes', 'pedidos_pendentes'],
    ['OM atendidas', 'solicitantes']
  ])
  const laiLinhas = linhasIndicadores(lai.totais_mes, lai.totais_ano, [
    ['Produtos entregues', 'produtos'],
    ['Quantidade de pedidos entregues', 'pedidos_entregues'],
    ['Quantidade de pedidos pendentes', 'pedidos_pendentes'],
    ['Solicitantes distintos', 'solicitantes']
  ])
  const totaisConsolidados = montaTotaisConsolidados({ produtosPorTipo, mapotecaLinhas, laiLinhas })

  // 2.4/2.7 no formato exato do RPCMTec histórico (linha a linha, só do mês,
  // não cumulativo — mesma granularidade das edições reais).
  const mapotecaDetalhe = montaDetalheEntregas(pedidosMes.militar)
  const laiDetalhe = montaDetalheEntregas(pedidosMes.civil)

  return {
    ano,
    mes,
    estadoAcervo,
    produtosPorTipo,
    mapotecaDetalhe,
    laiDetalhe,
    mapotecaLinhas,
    insumos: mapotecaEInsumos.insumos,
    laiLinhas,
    totaisConsolidados
  }
}

// ---------------------------------------------------------------------------
// Export DOCX: mesmo padrão de geração usado pelo SCO para a Seção 3 do
// RPCMTec (lib `docx`, tabela com cabeçalho em negrito, uma linha de '-'
// quando vazia).
// ---------------------------------------------------------------------------
const docxCelula = (valor, bold = false) => new TableCell({
  children: [new Paragraph({ children: [new TextRun({ text: texto(valor), bold })] })]
})

const docxTabela = (headers, linhas) => {
  const corpo = linhas.length > 0 ? linhas : [headers.map(() => '-')]
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ tableHeader: true, children: headers.map(h => docxCelula(h, true)) }),
      ...corpo.map(celulas => new TableRow({ children: celulas.map(c => docxCelula(c)) }))
    ]
  })
}

controller.gerarRelatorioAcervoDocx = async ({ ano, mes }) => {
  const dados = await controller.gerarRelatorioAcervo({ ano, mes })

  const children = [
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun({ text: `RPCMTec - Seção Acervo (Estado do Acervo, Mapoteca e LAI) - ${String(mes).padStart(2, '0')}/${ano}` })]
    })
  ]

  const bloco = (titulo, headers, linhas) => {
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: titulo })] }))
    children.push(docxTabela(headers, linhas))
    children.push(new Paragraph({ text: '' }))
  }

  bloco('1. Estado do Acervo',
    ['Escala', 'Total catalogado', 'Catalogado no mês', 'Universo da ASC', '% da ASC'],
    dados.estadoAcervo.map(l => [
      texto(l.escala),
      texto(l.total_catalogado),
      texto(l.catalogado_no_mes),
      texto(l.universo_asc),
      l.percentual_asc != null ? `${l.percentual_asc}%` : '-'
    ]))

  bloco('2. Produtos Entregues no Mês/Ano, por Tipo',
    ['Tipo de produto', 'Quantidade no mês', 'Quantidade no ano'],
    dados.produtosPorTipo.map(l => [texto(l.tipo_produto), texto(l.quantidade_mes), texto(l.quantidade_ano)]))

  bloco('2.4. Entregas da Mapoteca',
    ['Solicitante', 'Documento de solicitação', 'Quantidade', 'Situação'],
    dados.mapotecaDetalhe.map(l => [texto(l.solicitante), texto(l.documento), texto(l.quantidade), texto(l.situacao)]))

  bloco('2.7. LAI e Atendimento a Órgãos Públicos',
    ['Solicitante', 'Documento de solicitação', 'Quantidade', 'Situação'],
    dados.laiDetalhe.map(l => [texto(l.solicitante), texto(l.documento), texto(l.quantidade), texto(l.situacao)]))

  bloco('3. Mapoteca — Totais do Mês e do Ano',
    ['Indicador', 'Total no mês', 'Total no ano'],
    dados.mapotecaLinhas.map(l => [texto(l.indicador), texto(l.mes), texto(l.ano)]))

  bloco('3.1 Insumos de Impressão',
    ['Insumo', 'Estoque atual', 'Consumo no mês', 'Abaixo do mínimo'],
    dados.insumos.map(i => [
      texto(i.insumo), texto(i.estoque_atual), texto(i.consumo_no_mes), i.abaixo_minimo ? 'Sim' : 'Não'
    ]))

  bloco('4. LAI e Órgãos Públicos — Totais do Mês e do Ano',
    ['Indicador', 'Total no mês', 'Total no ano'],
    dados.laiLinhas.map(l => [texto(l.indicador), texto(l.mes), texto(l.ano)]))

  bloco('5. Totais do Mês e do Ano (consolidado)',
    ['Indicador', 'Total no mês', 'Total no ano'],
    dados.totaisConsolidados.map(l => [texto(l.indicador), texto(l.mes), texto(l.ano)]))

  const doc = new Document({ sections: [{ children }] })
  return Packer.toBuffer(doc)
}

module.exports = controller
