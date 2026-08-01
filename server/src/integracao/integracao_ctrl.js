'use strict'

// Controller das rotas públicas de integração (read-only, sem autenticação).
// Servem o vault do Chefe da DGEO: roteamento de demanda (cobertura do acervo)
// e montagem do RPCMTec (produtos finalizados no mês e atendimentos da
// mapoteca). Reaproveita a lógica de situação geral do acervo e os fragmentos
// SQL de negócio da mapoteca; nenhuma query nova de PII é exposta.

const { db } = require('../database')
const acervoCtrl = require('../acervo/acervo_ctrl')
const {
  domainConstants: { SITUACAO_PEDIDO, TIPO_CLIENTE, TIPO_VERSAO }
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
controller.getSituacaoGeral = async ({
  escala,
  geom = false,
  mi,
  inom,
  intersecta = null,
  limiar = 0.01
} = {}) => {
  const escalas = escala
    ? acervoCtrl.SITUACAO_GERAL_ESCALAS.filter(e => e.name === escala)
    : acervoCtrl.SITUACAO_GERAL_ESCALAS

  const ids = [...parseCsv(mi), ...parseCsv(inom)].map(normIdentificador)
  const filtroIds = ids.length ? new Set(ids) : null

  const dados = {}
  for (const e of escalas) {
    dados[e.name] = await acervoCtrl.getSituacaoGeralCells(e.id, {
      incluirGeom: geom === true,
      filtroIds,
      intersecta,
      limiar
    })
  }
  return dados
}

// 2) Produtos finalizados no mês (RPCMTec 2.2 "Entregas de produtos finais").
// Critério = data_edicao (finalização / informações marginais) no período,
// NÃO data_cadastramento (registro no SCA). cumulativo = acumulado no ano até
// o mês. Uma linha por versão.
//
// A versão PLANEJADA (tipo 3) FICA DE FORA, e é o ponto mais delicado desta
// consulta. Ela é a folha que o acervo ainda VAI produzir, cadastrada para o
// item do pedido da mapoteca poder apontar para ela; como `acervo.versao` exige
// `data_edicao` e uma folha não produzida não tem data de edição, grava-se a
// data do CADASTRO (ver migrations/2026-07-30_tipo_versao_planejada.sql, que
// diz isso com todas as letras: "quem carrega a verdade é o tipo_versao_id = 3
// mais a ausência de arquivo, nunca a data").
//
// Sem este corte, uma promessa de produção entrava como produto ENTREGUE, pela
// data em que alguém a cadastrou. Medido em 2026-08-01 contra produção: das 24
// versões com data_edicao em julho/2026, 16 eram planejadas -- o RPCMTec do mês
// anunciava 24 produtos entregues onde foram 8, e o ano ia a 294 em vez de 278.
// As 16 não têm NENHUM arquivo, contra 7.148 de 7.148 das regulares.
//
// O Registro Histórico (tipo 2) CONTINUA entrando: ele documenta uma edição que
// de fato existiu e foi finalizada, e a data dele é a de verdade. Em produção a
// mais recente é de 2013, então ele não toca nenhum relatório do ano corrente.
controller.getProdutosFinalizados = async ({
  ano,
  mes,
  cumulativo = true,
  tipo_produto_id: tipoProdutoId,
  tipo_escala_id: tipoEscalaId
} = {}) => {
  const filtros = [
    filtroPeriodoMes('v.data_edicao', { cumulativo }),
    'v.tipo_versao_id <> $<versaoPlanejada>'
  ]
  const params = { ano, mes, versaoPlanejada: TIPO_VERSAO.PLANEJADA }
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
// de envio. Pedido entregue (Remetido/Concluído) cuja data de atendimento (o
// fechamento do pedido) cai no período. Uma linha por pedido.
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
        -- Sem queda na data do item: a coluna saiu de produto_pedido em
        -- 2026-07-30, e a data de entrega do pedido e esta. Pedido remetido sem
        -- data_atendimento nao entra no periodo, e e o certo: enquanto ninguem
        -- data o fechamento, nao ha atendimento a declarar no RPCMTec.
        ped.data_atendimento
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
