// Path: integracao\integracao_ctrl.js
'use strict'

// Controller das rotas públicas de integração (read-only, sem autenticação).
// Servem o vault do Chefe da DGEO: roteamento de demanda (cobertura do acervo)
// e montagem do RPCMTec (produtos finalizados no mês e atendimentos da
// mapoteca). Reaproveita a lógica de situação geral do acervo e os fragmentos
// SQL de negócio da mapoteca; nenhuma query nova de PII é exposta.

const { db } = require('../database')
const acervoCtrl = require('../acervo/acervo_ctrl')
const {
  domainConstants: { SITUACAO_PEDIDO, TIPO_CLIENTE }
} = require('../utils')
const {
  QTD_EFETIVA,
  ESCALA_DISPLAY,
  filtroPeriodoMes
} = require('../mapoteca/query_fragments')

const controller = {}

// Tipos de cliente militares (RPCMTec 2.4) versus civis/LAI (RPCMTec 2.7)
const TIPOS_CLIENTE_MILITAR = [
  TIPO_CLIENTE.OM_EB,
  TIPO_CLIENTE.OM_AERONAUTICA,
  TIPO_CLIENTE.OM_MARINHA
]

// Situações que contam como entrega efetuada
const SITUACOES_ENTREGUE = [SITUACAO_PEDIDO.REMETIDO, SITUACAO_PEDIDO.CONCLUIDO]

const normIdentificador = (s) =>
  s == null ? '' : String(s).trim().toUpperCase().replace(/\s+/g, '')

const parseCsv = (s) =>
  s ? String(s).split(',').map(x => x.trim()).filter(Boolean) : []

// 1) Cobertura por folha (substitui o site de produtos para a skill
// consultar-produtos). Devolve { escala: [Feature, ...] } no mesmo formato de
// propriedades dos arquivos do site (identificadorMI, edicoes_topo, etc.).
controller.getSituacaoGeral = async ({ escala, geom = false, mi, inom } = {}) => {
  const escalas = escala
    ? acervoCtrl.SITUACAO_GERAL_ESCALAS.filter(e => e.name === escala)
    : acervoCtrl.SITUACAO_GERAL_ESCALAS

  const ids = [...parseCsv(mi), ...parseCsv(inom)].map(normIdentificador)
  const filtroIds = ids.length ? new Set(ids) : null

  const dados = {}
  for (const e of escalas) {
    dados[e.name] = await acervoCtrl.getSituacaoGeralCells(e.id, {
      incluirGeom: geom === true,
      filtroIds
    })
  }
  return dados
}

// 2) Produtos finalizados no mês (RPCMTec 2.2 "Entregas de produtos finais").
// Critério = data_edicao (finalização / informações marginais) no período,
// NÃO data_cadastramento (registro no SCA). cumulativo = acumulado no ano até
// o mês. Uma linha por versão.
controller.getProdutosFinalizados = async ({
  ano,
  mes,
  cumulativo = true,
  tipo_produto_id: tipoProdutoId,
  tipo_escala_id: tipoEscalaId
} = {}) => {
  const filtros = [filtroPeriodoMes('v.data_edicao', { cumulativo })]
  const params = { ano, mes }
  if (tipoProdutoId != null) {
    filtros.push('prod.tipo_produto_id = $<tipoProdutoId>')
    params.tipoProdutoId = tipoProdutoId
  }
  if (tipoEscalaId != null) {
    filtros.push('prod.tipo_escala_id = $<tipoEscalaId>')
    params.tipoEscalaId = tipoEscalaId
  }

  const produtos = await db.conn.any(
    `
    SELECT
      v.uuid_versao,
      v.nome,
      v.versao,
      v.orgao_produtor,
      v.data_criacao,
      v.data_edicao,
      v.data_cadastramento,
      prod.mi,
      prod.inom,
      prod.tipo_produto_id,
      tp.nome AS tipo_produto,
      prod.tipo_escala_id,
      ${ESCALA_DISPLAY} AS escala,
      sp.nome AS subtipo_produto,
      l.nome AS lote,
      l.pit,
      pr.nome AS projeto,
      COALESCE((
        SELECT array_agg(DISTINCT sc.nome ORDER BY sc.nome)
        FROM acervo.arquivo a
        JOIN dominio.situacao_carregamento sc ON sc.code = a.situacao_carregamento_id
        WHERE a.versao_id = v.id
      ), ARRAY[]::varchar[]) AS situacao_carregamento
    FROM acervo.versao v
    JOIN acervo.produto prod ON prod.id = v.produto_id
    JOIN dominio.tipo_produto tp ON tp.code = prod.tipo_produto_id
    JOIN dominio.tipo_escala te ON te.code = prod.tipo_escala_id
    JOIN dominio.subtipo_produto sp ON sp.code = v.subtipo_produto_id
    LEFT JOIN acervo.lote l ON l.id = v.lote_id
    LEFT JOIN acervo.projeto pr ON pr.id = l.projeto_id
    WHERE ${filtros.join(' AND ')}
    ORDER BY v.data_edicao, prod.mi, prod.inom
    `,
    params
  )

  // Resumo por tipo de produto × escala
  const resumoMap = {}
  for (const p of produtos) {
    const chave = `${p.tipo_produto}|${p.escala}`
    if (!resumoMap[chave]) {
      resumoMap[chave] = {
        tipo_produto: p.tipo_produto,
        escala: p.escala,
        quantidade: 0
      }
    }
    resumoMap[chave].quantidade += 1
  }

  return {
    ano,
    mes,
    cumulativo,
    total: produtos.length,
    resumo: Object.values(resumoMap),
    produtos
  }
}

// 3) Atendimentos da mapoteca no mês (RPCMTec 2.4 militar e 2.7 civil/LAI).
// Enxuto às colunas do RPCMTec: sem endereço, ponto de contato ou observações
// de envio. Pedido entregue (Remetido/Concluído) cuja data efetiva de
// atendimento (fechamento do pedido, com fallback na maior data de entrega de
// item) cai no período. Uma linha por pedido.
controller.getMapotecaAtendimentos = async ({ ano, mes, cumulativo = true } = {}) => {
  const rows = await db.conn.any(
    `
    WITH pedidos_entregues AS (
      SELECT
        ped.id,
        c.nome AS solicitante,
        c.tipo_cliente_id,
        tc.nome AS tipo_cliente,
        sp.nome AS situacao,
        ped.documento_solicitacao,
        ped.documento_solicitacao_nup,
        ped.previsto_pit,
        ped.operacao,
        COALESCE(SUM(${QTD_EFETIVA}), 0)::int AS quantidade,
        COALESCE(ped.data_atendimento::date, MAX(pp.data_entrega)) AS data_atendimento
      FROM mapoteca.pedido ped
      JOIN mapoteca.cliente c ON c.id = ped.cliente_id
      JOIN mapoteca.tipo_cliente tc ON tc.code = c.tipo_cliente_id
      JOIN mapoteca.situacao_pedido sp ON sp.code = ped.situacao_pedido_id
      LEFT JOIN mapoteca.produto_pedido pp ON pp.pedido_id = ped.id
      WHERE ped.situacao_pedido_id IN ($<situacoesEntregue:csv>)
      GROUP BY ped.id, c.nome, c.tipo_cliente_id, tc.nome, sp.nome
    )
    SELECT *
    FROM pedidos_entregues
    WHERE ${filtroPeriodoMes('data_atendimento', { cumulativo })}
    ORDER BY data_atendimento, id
    `,
    { situacoesEntregue: SITUACOES_ENTREGUE, ano, mes }
  )

  const ehMilitar = (r) => TIPOS_CLIENTE_MILITAR.includes(r.tipo_cliente_id)

  // 2.4: Solicitante | Documento de solicitação | Quantidade | Situação
  const militar = rows.filter(ehMilitar).map(r => ({
    solicitante: r.solicitante,
    documento_solicitacao: r.documento_solicitacao,
    previsto_pit: r.previsto_pit,
    operacao: r.operacao,
    quantidade: r.quantidade,
    situacao: r.situacao,
    data_atendimento: r.data_atendimento
  }))

  // 2.7: Solicitante | Documento (ofício/NUP) | Quantidade | Situação
  const civil = rows.filter(r => !ehMilitar(r)).map(r => ({
    solicitante: r.solicitante,
    tipo_cliente: r.tipo_cliente,
    documento: r.documento_solicitacao,
    nup: r.documento_solicitacao_nup,
    quantidade: r.quantidade,
    situacao: r.situacao,
    data_atendimento: r.data_atendimento
  }))

  return {
    ano,
    mes,
    cumulativo,
    militar,
    civil,
    resumo: {
      total_pedidos: rows.length,
      total_produtos: rows.reduce((s, r) => s + r.quantidade, 0),
      pedidos_militares: militar.length,
      pedidos_civis: civil.length
    }
  }
}

module.exports = controller
