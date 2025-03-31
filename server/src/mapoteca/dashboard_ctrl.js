// Path: mapoteca\dashboard_ctrl.js
"use strict";

const { db } = require("../database");
const { AppError, httpCode } = require("../utils");

const controller = {};

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

    // Get orders in progress (status 3)
    const inProgressOrders = statusCounts.find(s => s.situacao_pedido_id === 3) || { quantidade: 0 };
    
    // Get completed orders (status 5)
    const completedOrders = statusCounts.find(s => s.situacao_pedido_id === 5) || { quantidade: 0 };
    
    // Get pending orders (status 1, 2, 3)
    const pendingOrders = statusCounts
      .filter(s => [1, 2, 3].includes(s.situacao_pedido_id))
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
        current_date - interval '${meses} months', 
        current_date, 
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
        situacao_pedido_id = 5 
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
        p.situacao_pedido_id = 5 
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
        COUNT(*) AS quantidade_pedidos
      FROM meses m
      LEFT JOIN mapoteca.pedido p ON 
        date_trunc('month', p.data_pedido) = m.mes AND
        p.situacao_pedido_id = 5 AND
        p.data_atendimento IS NOT NULL
      GROUP BY m.mes
      ORDER BY m.mes
    `);

    return {
      media_geral: overallAvg ? parseFloat(overallAvg.media_dias).toFixed(1) : null,
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
      SUM(CASE WHEN p.situacao_pedido_id = 5 THEN 1 ELSE 0 END) AS pedidos_concluidos,
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
    WHERE p.situacao_pedido_id NOT IN (5, 6) -- not completed and not canceled
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
        SUM(CASE WHEN ativo THEN 1 ELSE 0 END) AS ativos,
        SUM(CASE WHEN NOT ativo THEN 1 ELSE 0 END) AS inativos
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

module.exports = controller;