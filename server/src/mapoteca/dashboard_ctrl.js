// Path: mapoteca\dashboard_ctrl.js
"use strict";

const { db } = require("../database");
const { AppError, httpCode, domainConstants: { SITUACAO_PEDIDO, TIPO_PRODUTO } } = require("../utils");
const {
  QTD_EFETIVA,
  MIDIA_EFETIVA,
  dataEntregaEfetiva,
  ESCALA_DISPLAY,
  filtroAno
} = require("./query_fragments");

const controller = {};

// Situações que contam como entrega efetuada
const SITUACOES_ENTREGUE = [SITUACAO_PEDIDO.ENVIADO, SITUACAO_PEDIDO.CONCLUIDO];

// Filtro "entregue no ano": pedido remetido/concluído cuja data efetiva de
// entrega (item com fallback no fechamento do pedido) cai no ano consultado.
// Requer aliases pp/ped e os parâmetros $<situacoesEntregue:csv> e $<ano>.
const FILTRO_ENTREGUE_ANO = `ped.situacao_pedido_id IN ($<situacoesEntregue:csv>)
      AND EXTRACT(YEAR FROM ${dataEntregaEfetiva()}) = $<ano>`;

// Order Status Distribution - numerical cards
controller.getOrderStatusDistribution = async () => {
  return db.conn.task(async t => {
    // Get counts for different statuses
    const statusCounts = await t.any(`
      SELECT 
        situacao_pedido_id,
        sp.nome AS situacao_nome,
        COUNT(*) AS quantidade
      FROM mapoteca.pedido p
      JOIN mapoteca.situacao_pedido sp ON p.situacao_pedido_id = sp.code
      GROUP BY situacao_pedido_id, sp.nome
      ORDER BY situacao_pedido_id
    `);

    // Get total orders
    const totalOrders = await t.one(`
      SELECT COUNT(*) AS total FROM mapoteca.pedido
    `);

    const inProgressOrders = statusCounts.find(s => s.situacao_pedido_id === SITUACAO_PEDIDO.EM_ANDAMENTO) || { quantidade: 0 };

    const completedOrders = statusCounts.find(s => s.situacao_pedido_id === SITUACAO_PEDIDO.CONCLUIDO) || { quantidade: 0 };

    const pendingOrders = statusCounts
      .filter(s => [SITUACAO_PEDIDO.PRE_CADASTRAMENTO, SITUACAO_PEDIDO.DOCUMENTO_RECEBIDO, SITUACAO_PEDIDO.EM_ANDAMENTO].includes(s.situacao_pedido_id))
      .reduce((sum, curr) => sum + parseInt(curr.quantidade), 0);

    return {
      total: parseInt(totalOrders.total),
      em_andamento: parseInt(inProgressOrders.quantidade),
      concluidos: parseInt(completedOrders.quantidade),
      pendentes: pendingOrders,
      distribuicao: statusCounts.map(item => ({
        id: item.situacao_pedido_id,
        nome: item.situacao_nome,
        quantidade: parseInt(item.quantidade)
      }))
    };
  });
};

// Orders Timeline - bar chart by week
controller.getOrdersTimeline = async (meses = 6) => {
  return db.conn.any(`
    WITH semanas AS (
      SELECT 
        date_trunc('week', dd)::date AS semana_inicio,
        (date_trunc('week', dd) + interval '6 days')::date AS semana_fim
      FROM generate_series(
        date_trunc('week', current_date - interval '${meses} months'),
        date_trunc('week', current_date),
        interval '1 week'
      ) AS dd
    ),
    pedidos_por_semana AS (
      SELECT 
        date_trunc('week', data_pedido)::date AS semana,
        COUNT(*) AS total_pedidos,
        SUM((SELECT COUNT(*) FROM mapoteca.produto_pedido WHERE pedido_id = p.id)) AS total_produtos
      FROM mapoteca.pedido p
      WHERE data_pedido >= current_date - interval '${meses} months'
      GROUP BY semana
    )
    SELECT 
      s.semana_inicio,
      s.semana_fim,
      COALESCE(p.total_pedidos, 0) AS total_pedidos,
      COALESCE(p.total_produtos, 0) AS total_produtos
    FROM semanas s
    LEFT JOIN pedidos_por_semana p ON s.semana_inicio = p.semana
    ORDER BY s.semana_inicio
  `);
};

// Average Fulfillment Time
controller.getAverageFulfillmentTime = async () => {
  return db.conn.task(async t => {
    // Overall average
    const overallAvg = await t.oneOrNone(`
      SELECT 
        AVG(EXTRACT(EPOCH FROM (data_atendimento - data_pedido)) / 86400) AS media_dias
      FROM mapoteca.pedido
      WHERE 
        situacao_pedido_id = ${SITUACAO_PEDIDO.CONCLUIDO}
        AND data_atendimento IS NOT NULL
    `);

    // By client type
    const byClientType = await t.any(`
      SELECT 
        c.tipo_cliente_id,
        tc.nome AS tipo_cliente,
        AVG(EXTRACT(EPOCH FROM (p.data_atendimento - p.data_pedido)) / 86400) AS media_dias,
        COUNT(*) AS quantidade_pedidos
      FROM mapoteca.pedido p
      JOIN mapoteca.cliente c ON p.cliente_id = c.id
      JOIN mapoteca.tipo_cliente tc ON c.tipo_cliente_id = tc.code
      WHERE
        p.situacao_pedido_id = ${SITUACAO_PEDIDO.CONCLUIDO}
        AND p.data_atendimento IS NOT NULL
      GROUP BY c.tipo_cliente_id, tc.nome
      ORDER BY media_dias
    `);

    // Monthly average
    const monthlyAvg = await t.any(`
      WITH meses AS (
        SELECT generate_series(
          date_trunc('month', current_date - interval '11 months'),
          date_trunc('month', current_date),
          interval '1 month'
        )::date AS mes
      )
      SELECT 
        m.mes,
        COALESCE(AVG(EXTRACT(EPOCH FROM (p.data_atendimento - p.data_pedido)) / 86400), 0) AS media_dias,
        COUNT(p.id) AS quantidade_pedidos
      FROM meses m
      LEFT JOIN mapoteca.pedido p ON 
        date_trunc('month', p.data_pedido) = m.mes AND
        p.situacao_pedido_id = ${SITUACAO_PEDIDO.CONCLUIDO} AND
        p.data_atendimento IS NOT NULL
      GROUP BY m.mes
      ORDER BY m.mes
    `);

    return {
      media_geral: (overallAvg && overallAvg.media_dias !== null)
        ? parseFloat(overallAvg.media_dias).toFixed(1)
        : null,
      por_tipo_cliente: byClientType.map(item => ({
        tipo_cliente_id: item.tipo_cliente_id,
        tipo_cliente: item.tipo_cliente,
        media_dias: parseFloat(item.media_dias).toFixed(1),
        quantidade_pedidos: parseInt(item.quantidade_pedidos)
      })),
      mensal: monthlyAvg.map(item => ({
        mes: item.mes,
        media_dias: parseFloat(item.media_dias).toFixed(1),
        quantidade_pedidos: parseInt(item.quantidade_pedidos)
      }))
    };
  });
};

// Client Activity
controller.getClientActivity = async (limite = 10) => {
  return db.conn.any(`
    SELECT 
      c.id, 
      c.nome, 
      c.tipo_cliente_id,
      tc.nome AS tipo_cliente,
      COUNT(p.id) AS total_pedidos,
      SUM(CASE WHEN p.situacao_pedido_id = ${SITUACAO_PEDIDO.CONCLUIDO} THEN 1 ELSE 0 END) AS pedidos_concluidos,
      SUM((SELECT COUNT(*) FROM mapoteca.produto_pedido WHERE pedido_id = p.id)) AS total_produtos,
      MAX(p.data_pedido) AS ultimo_pedido
    FROM mapoteca.cliente c
    JOIN mapoteca.pedido p ON c.id = p.cliente_id
    JOIN mapoteca.tipo_cliente tc ON c.tipo_cliente_id = tc.code
    GROUP BY c.id, c.nome, c.tipo_cliente_id, tc.nome
    ORDER BY total_pedidos DESC
    LIMIT ${limite}
  `);
};

// Pending Orders (not completed and not canceled)
controller.getPendingOrders = async () => {
  return db.conn.any(`
    SELECT 
      p.id, 
      p.data_pedido, 
      p.prazo,
      p.cliente_id, 
      c.nome AS cliente_nome,
      p.situacao_pedido_id, 
      sp.nome AS situacao_nome,
      p.documento_solicitacao,
      (SELECT COUNT(*) FROM mapoteca.produto_pedido WHERE pedido_id = p.id) AS quantidade_produtos,
      CASE 
        WHEN p.prazo IS NULL THEN NULL
        WHEN current_date > p.prazo THEN true
        ELSE false
      END AS atrasado,
      CASE 
        WHEN p.prazo IS NULL THEN NULL
        ELSE p.prazo - current_date
      END AS dias_ate_prazo
    FROM mapoteca.pedido p
    JOIN mapoteca.cliente c ON p.cliente_id = c.id
    JOIN mapoteca.situacao_pedido sp ON p.situacao_pedido_id = sp.code
    WHERE p.situacao_pedido_id NOT IN (${SITUACAO_PEDIDO.CONCLUIDO}, ${SITUACAO_PEDIDO.CANCELADO})
    ORDER BY 
      CASE WHEN p.prazo IS NULL THEN 1 ELSE 0 END, -- nulls last
      p.prazo,
      p.data_pedido
  `);
};

// Stock by Location - pie chart
controller.getStockByLocation = async () => {
  return db.conn.any(`
    SELECT 
      tl.code AS localizacao_id,
      tl.nome AS localizacao,
      SUM(em.quantidade) AS quantidade_total
    FROM mapoteca.estoque_material em
    JOIN mapoteca.tipo_localizacao tl ON em.localizacao_id = tl.code
    GROUP BY tl.code, tl.nome
    ORDER BY quantidade_total DESC
  `);
};

// Material Consumption Trends
controller.getMaterialConsumptionTrends = async (meses = 12) => {
  return db.conn.task(async t => {
    // Monthly consumption for all materials
    const monthlyConsumption = await t.any(`
      WITH meses AS (
        SELECT generate_series(
          date_trunc('month', current_date - interval '${meses-1} months'),
          date_trunc('month', current_date),
          interval '1 month'
        )::date AS mes
      )
      SELECT 
        m.mes,
        COALESCE(SUM(cm.quantidade), 0) AS quantidade_total
      FROM meses m
      LEFT JOIN mapoteca.consumo_material cm ON 
        date_trunc('month', cm.data_consumo) = m.mes
      GROUP BY m.mes
      ORDER BY m.mes
    `);

    // Top 5 most consumed materials
    const topMaterials = await t.any(`
      SELECT 
        tm.id,
        tm.nome,
        SUM(cm.quantidade) AS quantidade_total
      FROM mapoteca.consumo_material cm
      JOIN mapoteca.tipo_material tm ON cm.tipo_material_id = tm.id
      WHERE cm.data_consumo >= current_date - interval '${meses} months'
      GROUP BY tm.id, tm.nome
      ORDER BY quantidade_total DESC
      LIMIT 5
    `);

    // Consumption by material type for each month (for top 5 materials)
    const materialIds = topMaterials.map(m => m.id);

    // Sem consumo no período não há materiais para detalhar
    // (unnest de array vazio quebraria a query)
    if (materialIds.length === 0) {
      return {
        consumo_mensal_total: monthlyConsumption,
        materiais_mais_consumidos: [],
        consumo_por_material: []
      };
    }

    const consumptionByMaterial = await t.any(`
      WITH meses AS (
        SELECT generate_series(
          date_trunc('month', current_date - interval '${meses-1} months'),
          date_trunc('month', current_date),
          interval '1 month'
        )::date AS mes
      ),
      material_ids AS (
        SELECT unnest(ARRAY[${materialIds.join(',')}]) AS material_id
      )
      SELECT 
        m.mes,
        mi.material_id,
        tm.nome AS material_nome,
        COALESCE(SUM(cm.quantidade), 0) AS quantidade
      FROM meses m
      CROSS JOIN material_ids mi
      JOIN mapoteca.tipo_material tm ON mi.material_id = tm.id
      LEFT JOIN mapoteca.consumo_material cm ON 
        date_trunc('month', cm.data_consumo) = m.mes AND
        cm.tipo_material_id = mi.material_id
      GROUP BY m.mes, mi.material_id, tm.nome
      ORDER BY m.mes, mi.material_id
    `);

    return {
      consumo_mensal_total: monthlyConsumption,
      materiais_mais_consumidos: topMaterials,
      consumo_por_material: consumptionByMaterial
    };
  });
};

// Plotter Status
controller.getPlotterStatus = async () => {
  return db.conn.task(async t => {
    // Overall plotter status
    const statusSummary = await t.one(`
      SELECT 
        COUNT(*) AS total,
        COALESCE(SUM(CASE WHEN ativo THEN 1 ELSE 0 END), 0) AS ativos,
        COALESCE(SUM(CASE WHEN NOT ativo THEN 1 ELSE 0 END), 0) AS inativos
      FROM mapoteca.plotter
    `);

    // List of all plotters with last maintenance info
    const plotters = await t.any(`
      WITH ultima_manutencao AS (
        SELECT 
          plotter_id,
          MAX(data_manutencao) AS data_ultima_manutencao,
          SUM(valor) AS custo_total_manutencao
        FROM mapoteca.manutencao_plotter
        GROUP BY plotter_id
      )
      SELECT 
        p.id, 
        p.ativo, 
        p.nr_serie, 
        p.modelo, 
        p.data_aquisicao,
        p.vida_util,
        um.data_ultima_manutencao,
        um.custo_total_manutencao,
        CASE 
          WHEN p.data_aquisicao IS NULL OR p.vida_util IS NULL THEN NULL
          WHEN p.data_aquisicao + (p.vida_util || ' months')::interval < current_date THEN true
          ELSE false
        END AS fim_vida_util
      FROM mapoteca.plotter p
      LEFT JOIN ultima_manutencao um ON p.id = um.plotter_id
      ORDER BY p.ativo DESC, p.modelo, p.nr_serie
    `);

    return {
      sumario: {
        total: parseInt(statusSummary.total),
        ativos: parseInt(statusSummary.ativos),
        inativos: parseInt(statusSummary.inativos)
      },
      plotters: plotters.map(p => ({
        ...p,
        custo_total_manutencao: p.custo_total_manutencao ? parseFloat(p.custo_total_manutencao) : 0
      }))
    };
  });
};

// Entregas por tipo de produto × escala no ano
controller.getEntregasPorTipoProduto = async (ano) => {
  return db.conn.any(
    `
    SELECT
      tp.nome AS tipo_produto,
      ${ESCALA_DISPLAY} AS escala,
      COUNT(DISTINCT ped.id)::int AS total_pedidos,
      COALESCE(SUM(${QTD_EFETIVA}), 0)::int AS total_produtos
    FROM mapoteca.produto_pedido pp
    JOIN mapoteca.pedido ped ON ped.id = pp.pedido_id
    JOIN acervo.versao v ON v.uuid_versao = pp.uuid_versao
    JOIN acervo.produto prod ON prod.id = v.produto_id
    JOIN dominio.tipo_produto tp ON tp.code = prod.tipo_produto_id
    JOIN dominio.tipo_escala te ON te.code = prod.tipo_escala_id
    WHERE ${FILTRO_ENTREGUE_ANO}
    GROUP BY 1, 2
    ORDER BY 1, 2
    `,
    { ano, situacoesEntregue: SITUACOES_ENTREGUE }
  );
};

// Entregas por tipo de mídia no ano (mídia fornecida com fallback na prevista)
controller.getEntregasPorMidia = async (ano) => {
  return db.conn.any(
    `
    SELECT
      tm.nome AS tipo_midia,
      COALESCE(SUM(${QTD_EFETIVA}), 0)::int AS total_produtos
    FROM mapoteca.produto_pedido pp
    JOIN mapoteca.pedido ped ON ped.id = pp.pedido_id
    LEFT JOIN mapoteca.tipo_midia tm ON tm.code = ${MIDIA_EFETIVA}
    WHERE ${FILTRO_ENTREGUE_ANO}
    GROUP BY tm.nome
    ORDER BY total_produtos DESC
    `,
    { ano, situacoesEntregue: SITUACOES_ENTREGUE }
  );
};

// Operações apoiadas no ano (campo livre pedido.operacao)
controller.getOperacoesApoiadas = async (ano) => {
  return db.conn.any(
    `
    SELECT
      ped.operacao,
      COUNT(DISTINCT ped.id)::int AS total_pedidos,
      COALESCE(SUM(${QTD_EFETIVA}), 0)::int AS total_produtos
    FROM mapoteca.pedido ped
    LEFT JOIN mapoteca.produto_pedido pp ON pp.pedido_id = ped.id
    WHERE ped.operacao IS NOT NULL AND ped.operacao <> ''
      AND ${filtroAno("ped.data_pedido")}
    GROUP BY ped.operacao
    ORDER BY total_pedidos DESC
    `,
    { ano }
  );
};

// Resumo anual: totais de pedidos, entregas, OMs, operações e custo de manutenção
controller.getResumoAnual = async (ano) => {
  const row = await db.conn.one(
    `
    SELECT p.total_pedidos, p.oms_distintas_count, p.operacoes_distintas_count,
           e.total_entregas, m.custo_manutencao_total
    FROM (
      SELECT
        COUNT(*)::int AS total_pedidos,
        COUNT(DISTINCT cliente_id)::int AS oms_distintas_count,
        (COUNT(DISTINCT operacao) FILTER (WHERE operacao IS NOT NULL AND operacao <> ''))::int AS operacoes_distintas_count
      FROM mapoteca.pedido
      WHERE ${filtroAno("data_pedido")}
    ) p
    CROSS JOIN (
      SELECT COALESCE(SUM(${QTD_EFETIVA}), 0)::int AS total_entregas
      FROM mapoteca.produto_pedido pp
      JOIN mapoteca.pedido ped ON ped.id = pp.pedido_id
      WHERE ${FILTRO_ENTREGUE_ANO}
    ) e
    CROSS JOIN (
      SELECT COALESCE(SUM(valor), 0)::float8 AS custo_manutencao_total
      FROM mapoteca.manutencao_plotter
      WHERE ${filtroAno("data_manutencao")}
    ) m
    `,
    { ano, situacoesEntregue: SITUACOES_ENTREGUE }
  );

  return { ano, ...row };
};

// Entregas por mês (reproduz a tabela-resumo mensal da aba Detalhado:
// Carta Topo × Carta Orto × Outros por mês).
// Classifica apenas por tipo de produto, como a planilha; difere de propósito
// do relatório Mil (relatorio_ctrl), que separa mídia digital e trata escalas
// não padrão como "outros".
controller.getEntregasPorMes = async (ano) => {
  return db.conn.any(
    `
    WITH meses AS (
      SELECT generate_series(1, 12) AS mes
    ),
    itens AS (
      SELECT
        EXTRACT(MONTH FROM ${dataEntregaEfetiva()})::int AS mes,
        ${QTD_EFETIVA} AS qtd,
        prod.tipo_produto_id
      FROM mapoteca.produto_pedido pp
      JOIN mapoteca.pedido ped ON ped.id = pp.pedido_id
      JOIN acervo.versao v ON v.uuid_versao = pp.uuid_versao
      JOIN acervo.produto prod ON prod.id = v.produto_id
      WHERE ${FILTRO_ENTREGUE_ANO}
    )
    SELECT
      m.mes,
      COALESCE(SUM(i.qtd) FILTER (WHERE i.tipo_produto_id = $<tipoTopo>), 0)::int AS carta_topo,
      COALESCE(SUM(i.qtd) FILTER (WHERE i.tipo_produto_id = $<tipoOrto>), 0)::int AS carta_orto,
      COALESCE(SUM(i.qtd) FILTER (WHERE i.tipo_produto_id NOT IN ($<tipoTopo>, $<tipoOrto>)), 0)::int AS outros,
      COALESCE(SUM(i.qtd), 0)::int AS total
    FROM meses m
    LEFT JOIN itens i ON i.mes = m.mes
    GROUP BY m.mes
    ORDER BY m.mes
    `,
    {
      ano,
      situacoesEntregue: SITUACOES_ENTREGUE,
      tipoTopo: TIPO_PRODUTO.CARTA_TOPOGRAFICA,
      tipoOrto: TIPO_PRODUTO.CARTA_ORTOIMAGEM
    }
  );
};

// Colunas para exportação CSV dos dashboards anuais
controller.COLUNAS_ENTREGAS_MES = [
  { key: "mes", label: "Mês" },
  { key: "carta_topo", label: "Carta Topo" },
  { key: "carta_orto", label: "Carta Orto" },
  { key: "outros", label: "Outros" },
  { key: "total", label: "Total" }
];

controller.COLUNAS_ENTREGAS_TIPO_PRODUTO = [
  { key: "tipo_produto", label: "Tipo de Produto" },
  { key: "escala", label: "Escala" },
  { key: "total_pedidos", label: "Total de Pedidos" },
  { key: "total_produtos", label: "Total de Produtos" }
];

controller.COLUNAS_ENTREGAS_MIDIA = [
  { key: "tipo_midia", label: "Tipo de Mídia" },
  { key: "total_produtos", label: "Total de Produtos" }
];

controller.COLUNAS_OPERACOES = [
  { key: "operacao", label: "Operação" },
  { key: "total_pedidos", label: "Total de Pedidos" },
  { key: "total_produtos", label: "Total de Produtos" }
];

module.exports = controller;