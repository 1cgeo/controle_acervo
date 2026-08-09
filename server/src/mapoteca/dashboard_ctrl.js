"use strict";

const { db } = require("../database");
const { AppError, httpCode, domainConstants: { SITUACAO_PEDIDO, TIPO_PRODUTO, TIPO_CLIENTE, TIPO_MOVIMENTO_MATERIAL } } = require("../utils");
const {
  QTD_EFETIVA,
  MIDIA_EFETIVA,
  ESCALA_DISPLAY,
  ESCALA_DISPLAY_ITEM,
  JOIN_PRODUTO_ITEM,
  PRODUTO_TIPO_ID,
  filtroAno
} = require("./query_fragments");

const controller = {};

// Os tipos de cliente MILITARES. Pelas constantes, e não pelos códigos crus:
// `IN (1, 2, 3)` não diz quais são, e a mesma lista já vive nomeada em
// `relatorio_ctrl.TIPOS_CLIENTE_MILITAR`, que separa a aba Mil da aba Civ. Dois
// lugares escrevendo a mesma régua com números soltos divergem no dia em que o
// domínio ganhar um tipo de OM.
const TIPOS_CLIENTE_MILITAR = [
  TIPO_CLIENTE.OM_EB,
  TIPO_CLIENTE.OM_AERONAUTICA,
  TIPO_CLIENTE.OM_MARINHA
];

const LISTA_TIPOS_MILITAR = TIPOS_CLIENTE_MILITAR.join(", ");

// As métricas de PEDIDO do dashboard são a visão de produção (OM). O civil
// (LAI/órgão/empresa) tem o relatório Civ próprio; incluí-lo aqui distorce
// clientes, tempo médio e pendentes. Este predicado limita o pedido a cliente
// MILITAR (OM EB/Aeronáutica/Marinha). Usa subconsulta -> vale com qualquer alias.
const PEDIDO_MILITAR = (colId) =>
  `${colId} IN (SELECT id FROM mapoteca.cliente WHERE tipo_cliente_id IN (${LISTA_TIPOS_MILITAR}))`;

// Situações que contam como entrega efetuada
const SITUACOES_ENTREGUE = [SITUACAO_PEDIDO.REMETIDO, SITUACAO_PEDIDO.CONCLUIDO];

// Filtro "entregue no ano": pedido remetido/concluído cuja data de entrega cai
// no ano consultado. Requer o alias ped e os parâmetros
// $<situacoesEntregue:csv> e $<ano>.
//
// A data é a do PEDIDO (`data_atendimento`). O item não tem data de entrega
// própria.
//
// Sargável, pelo `filtroAno`, e não por `EXTRACT(YEAR FROM col) = ano`. O
// EXTRACT envolve a coluna numa função e o Postgres deixa de usar o índice
// `idx_pedido_data_atendimento` (er/mapoteca.sql, linha 541): ele varre a tabela
// inteira. O `filtroAno` compara a coluna CRUA com
// duas datas, e é a razão de ele existir. As onze consultas abaixo usam este
// filtro, então a diferença aparece em onze lugares.
//
// A mudança preserva o recorte, inclusive nos nulos: pedido sem
// `data_atendimento` não passava (NULL = ano dá NULL) e continua sem passar
// (NULL >= data dá NULL). Requer os parâmetros $<situacoesEntregue:csv> e $<ano>.
//
// O recorte MILITAR mora aqui dentro, e nao em cada consulta. Sem ele, o lado
// da ENTREGA do dashboard somava o cliente civil enquanto o lado do PEDIDO ja
// o excluia: o cartao "Pedidos no ano" dizia 130 e o cartao vizinho "Produtos
// entregues" contava uma populacao maior, sem nada na tela dizendo por que.
// Medido na producao em 2026-08-07: os 33 pedidos civis entregues no ano tem
// ZERO item de produto_pedido, porque a LAI entrega foto aerea por
// `pedido.qtd_imagens`. O total nao se move hoje (6.535 antes e depois), e a
// regra passa a valer para o dia em que um pedido civil tiver item.
// As dez consultas de entrega deste arquivo (cartao, graficos e mapa) usam
// este fragmento, entao a regra entra nas dez de uma vez.
const FILTRO_ENTREGUE_ANO = `ped.situacao_pedido_id IN ($<situacoesEntregue:csv>)
      AND ${filtroAno("ped.data_atendimento")}
      AND ${PEDIDO_MILITAR('ped.cliente_id')}`;

// Filtro "pedido do ano": pedido cuja DATA DE PEDIDO cai no ano consultado.
//
// É um ano DIFERENTE do de cima, e a diferença não é detalhe. FILTRO_ENTREGUE_ANO
// responde "o que a mapoteca ENTREGOU em 2026", e alimenta o Resumo Anual e o
// Mapa; este responde "o que ENTROU em 2026", e alimenta Pedidos e Atendimento.
// Um pedido de dezembro de 2025 entregue em janeiro de 2026 conta no primeiro
// como 2026 e no segundo como 2025, e os dois estão certos: são perguntas
// distintas. Por isso cada aba diz na tela qual das duas está mostrando, senão
// os números pareceriam se contradizer.
//
// Sargável (usa o índice btree de data_pedido), ao contrário de
// EXTRACT(YEAR FROM col) = ano. Requer o parâmetro $<ano>.
const FILTRO_ANO_PEDIDO = (alias = 'p') => filtroAno(`${alias}.data_pedido`);

// Os meses JÁ DECORRIDOS do ano consultado, para os gráficos mensais.
// Substituiu a janela deslizante ("últimos 6/12 meses"), que não tinha como
// respeitar um ano de contexto: em 2025, "últimos 12 meses" continuaria
// terminando hoje.
//
// O corte no mês corrente é a parte que importa. Com os doze meses fixos, o ano
// em curso trazia zero de setembro a dezembro, e a linha do gráfico despencava:
// a queda lia-se como colapso da produção, quando era só o futuro que ainda não
// aconteceu. Pior no tempo médio de atendimento, onde o mês sem pedido descia a
// curva a "0,0 dias", que se lê como entrega instantânea.
//
// O LEAST resolve os três casos com uma expressão: ano passado devolve os doze
// meses, ano corrente para no mês de hoje, e ano futuro devolve conjunto VAZIO,
// porque o primeiro mês já é maior que o último e o generate_series não gera
// nada. Vazio é a resposta certa: nenhum mês de 2027 decorreu.
const MESES_DO_ANO = `SELECT generate_series(
        make_date($<ano>, 1, 1),
        LEAST(make_date($<ano>, 12, 1), date_trunc('month', CURRENT_DATE)::date),
        interval '1 month'
      )::date AS mes`;

// Order Status Distribution - numerical cards
// Escopo: pedidos ABERTOS no ano (data_pedido). Ver FILTRO_ANO_PEDIDO.
controller.getOrderStatusDistribution = async (ano) => {
  return db.conn.task(async t => {
    const statusCounts = await t.any(`
      SELECT
        situacao_pedido_id,
        sp.nome AS situacao_nome,
        COUNT(*) AS quantidade
      FROM mapoteca.pedido p
      JOIN mapoteca.situacao_pedido sp ON p.situacao_pedido_id = sp.code
      WHERE ${PEDIDO_MILITAR('p.cliente_id')}
        AND ${FILTRO_ANO_PEDIDO()}
      GROUP BY situacao_pedido_id, sp.nome
      ORDER BY situacao_pedido_id
    `, { ano });

    const totalOrders = await t.one(`
      SELECT COUNT(*) AS total FROM mapoteca.pedido p
      WHERE ${PEDIDO_MILITAR('p.cliente_id')}
        AND ${FILTRO_ANO_PEDIDO()}
    `, { ano });

    const inProgressOrders = statusCounts.find(s => s.situacao_pedido_id === SITUACAO_PEDIDO.EM_ANDAMENTO) || { quantidade: 0 };

    const completedOrders = statusCounts.find(s => s.situacao_pedido_id === SITUACAO_PEDIDO.CONCLUIDO) || { quantidade: 0 };

    // Pendente é tudo que NÃO fechou: nem concluído, nem cancelado. Era uma
    // lista escolhida a dedo (pré-cadastramento, documento recebido, em
    // andamento), e ela deixava "Aguardando produção" e "Remetido" fora de
    // TODO cartão. Medido na produção em 2026, com cliente militar: 129
    // pedidos = 98 concluídos + 25 em andamento + 5 aguardando produção + 1
    // remetido. A tela mostrava 129 / 98 / 25 e escondia 6.
    //
    // A regra é por exclusão, e não por lista, para que situação nova no
    // domínio entre em pendentes sozinha, em vez de sumir em silêncio.
    //
    // Com isso vale total = concluídos + pendentes, desde que o ano não tenha
    // pedido CANCELADO: o cancelado conta no total e em nenhum dos dois
    // cartões, de propósito, porque não é fila nem entrega. O gráfico de
    // situações ao lado é quem o mostra.
    const SITUACOES_FECHADAS = [SITUACAO_PEDIDO.CONCLUIDO, SITUACAO_PEDIDO.CANCELADO];

    const pendingOrders = statusCounts
      .filter(s => !SITUACOES_FECHADAS.includes(s.situacao_pedido_id))
      .reduce((sum, curr) => sum + parseInt(curr.quantidade), 0);

    return {
      ano,
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

// Entrada de pedidos MÊS A MÊS no ano consultado.
//
// Era por SEMANA, numa janela de "últimos 6 meses". A janela deslizante não tem
// como respeitar um ano de contexto: em 2025 ela continuaria terminando hoje, e
// mostraria 2026. Fechada no ano, a semana daria 52 pontos numa linha só; o mês
// dá 12, e é a granularidade que o resto do dashboard já usa (tempo médio
// mensal, consumo mensal), então os gráficos passam a ser comparáveis entre si.
//
// Os doze meses saem sempre, mesmo vazios: sem eles, um ano com movimento só em
// março e outubro desenharia uma reta entre os dois, sugerindo movimento que
// não houve.
controller.getOrdersTimeline = async (ano) => {
  return db.conn.any(`
    WITH meses AS (
      ${MESES_DO_ANO}
    ),
    pedidos_por_mes AS (
      SELECT
        date_trunc('month', p.data_pedido)::date AS mes,
        COUNT(*) AS total_pedidos,
        SUM((SELECT COUNT(*) FROM mapoteca.produto_pedido WHERE pedido_id = p.id)) AS total_produtos
      FROM mapoteca.pedido p
      WHERE ${FILTRO_ANO_PEDIDO()}
        AND ${PEDIDO_MILITAR('p.cliente_id')}
      GROUP BY mes
    )
    SELECT
      m.mes,
      COALESCE(pm.total_pedidos, 0) AS total_pedidos,
      COALESCE(pm.total_produtos, 0) AS total_produtos
    FROM meses m
    LEFT JOIN pedidos_por_mes pm ON pm.mes = m.mes
    ORDER BY m.mes
  `, { ano });
};

// Average Fulfillment Time
// Escopo: pedidos ABERTOS no ano (data_pedido), igual à aba Pedidos. A média
// mensal já agrupava por data_pedido, então usar a mesma data nas três consultas
// é o que faz o cartão, a linha e a barra fecharem entre si.
controller.getAverageFulfillmentTime = async (ano) => {
  return db.conn.task(async t => {
    // Overall average
    const overallAvg = await t.oneOrNone(`
      SELECT 
        -- Diferenca em DIAS INTEIROS, sem passar por epoch.
        -- O ::date faz esta conta valer com a coluna em TIMESTAMPTZ e em DATE.
        -- Sem ele, uma forma quebra a outra: EXTRACT(EPOCH FROM (date - date))
        -- nao existe, porque date menos date ja e um inteiro.
        -- (Sem crase aqui: a consulta e um template literal.)
        AVG(data_atendimento::date - data_pedido::date) AS media_dias
      FROM mapoteca.pedido p
      WHERE
        situacao_pedido_id = ${SITUACAO_PEDIDO.CONCLUIDO}
        AND data_atendimento IS NOT NULL
        AND ${PEDIDO_MILITAR('p.cliente_id')}
        AND ${FILTRO_ANO_PEDIDO()}
    `, { ano });

    const byClientType = await t.any(`
      SELECT 
        c.tipo_cliente_id,
        tc.nome AS tipo_cliente,
        AVG(p.data_atendimento::date - p.data_pedido::date) AS media_dias,
        COUNT(*) AS quantidade_pedidos
      FROM mapoteca.pedido p
      JOIN mapoteca.cliente c ON p.cliente_id = c.id
      JOIN mapoteca.tipo_cliente tc ON c.tipo_cliente_id = tc.code
      WHERE
        p.situacao_pedido_id = ${SITUACAO_PEDIDO.CONCLUIDO}
        AND p.data_atendimento IS NOT NULL
        -- Sem este filtro a quebra por tipo somava o CIVIL, enquanto a media
        -- geral e a mensal, no mesmo cartao, ja contavam so o militar. As tres
        -- linhas nao fechavam entre si.
        AND ${PEDIDO_MILITAR('p.cliente_id')}
        AND ${FILTRO_ANO_PEDIDO()}
      GROUP BY c.tipo_cliente_id, tc.nome
      ORDER BY media_dias
    `, { ano });

    // Monthly average
    const monthlyAvg = await t.any(`
      WITH meses AS (
        ${MESES_DO_ANO}
      )
      SELECT
        m.mes,
        -- SEM COALESCE para zero. Mes sem pedido concluido nao tem media, e
        -- "0,0 dias" na linha do grafico le-se como entrega no mesmo dia, que e
        -- o melhor desempenho possivel. Era o oposto do fato: nao houve
        -- entrega. NULO deixa a serie com buraco, e buraco nao afirma nada.
        AVG(p.data_atendimento::date - p.data_pedido::date) AS media_dias,
        COUNT(p.id) AS quantidade_pedidos
      FROM meses m
      LEFT JOIN mapoteca.pedido p ON
        date_trunc('month', p.data_pedido)::date = m.mes AND
        p.situacao_pedido_id = ${SITUACAO_PEDIDO.CONCLUIDO} AND
        p.data_atendimento IS NOT NULL AND
        ${PEDIDO_MILITAR('p.cliente_id')}
      GROUP BY m.mes
      ORDER BY m.mes
    `, { ano });

    return {
      ano,
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
        // O nulo do SQL atravessa como nulo. Sem esta guarda o parseFloat(null)
        // devolveria NaN, e o JSON o serializa como `null` por acidente, o que
        // funcionaria hoje e quebraria na primeira conta feita sobre o campo.
        media_dias: item.media_dias === null
          ? null
          : parseFloat(item.media_dias).toFixed(1),
        quantidade_pedidos: parseInt(item.quantidade_pedidos)
      }))
    };
  });
};

// Client Activity
// Escopo: pedidos ABERTOS no ano, igual às outras métricas de pedido. O Top 10
// passa a ser "quem mais pediu NAQUELE ano", e não o acumulado histórico, que
// era uma lista praticamente imóvel.
controller.getClientActivity = async (limite = 10, ano) => {
  return db.conn.any(`
    SELECT 
      c.id, 
      c.nome, 
      c.tipo_cliente_id,
      tc.nome AS tipo_cliente,
      COUNT(p.id) AS total_pedidos,
      SUM(CASE WHEN p.situacao_pedido_id = ${SITUACAO_PEDIDO.CONCLUIDO} THEN 1 ELSE 0 END) AS pedidos_concluidos,
      SUM((SELECT COUNT(*) FROM mapoteca.produto_pedido WHERE pedido_id = p.id)) AS total_produtos,
      -- Folhas realmente impressas, e não o que foi pedido. A quantidade vem de
      -- mapoteca.impressao_item, que registra cada sessão de impressão, então um
      -- item impresso em dois dias soma as duas. Ligação:
      -- impressao_item -> produto_pedido -> pedido -> cliente.
      SUM((SELECT COALESCE(SUM(ii.quantidade), 0)
             FROM mapoteca.impressao_item ii
             JOIN mapoteca.produto_pedido pp ON pp.id = ii.produto_pedido_id
            WHERE pp.pedido_id = p.id)) AS total_impressoes,
      MAX(p.data_pedido) AS ultimo_pedido
    FROM mapoteca.cliente c
    JOIN mapoteca.pedido p ON c.id = p.cliente_id
    JOIN mapoteca.tipo_cliente tc ON c.tipo_cliente_id = tc.code
    -- Mesma régua militar do resto do arquivo, agora pela mesma lista nomeada.
    -- Aqui o filtro é direto (o cliente já está no JOIN), e não pelo subselect
    -- do PEDIDO_MILITAR, que existe para quem não tem o alias.
    WHERE c.tipo_cliente_id IN (${LISTA_TIPOS_MILITAR})
      AND ${FILTRO_ANO_PEDIDO()}
    GROUP BY c.id, c.nome, c.tipo_cliente_id, tc.nome
    ORDER BY total_pedidos DESC
    -- Parâmetro, e não interpolação: o limite vem da query da requisição, e o
    -- único valor de usuário que entrava na consulta por template literal era
    -- este. O Joi já o restringe a 1..100; o parâmetro tira a dependência disso.
    LIMIT $<limite>
  `, { ano, limite });
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
      -- Idade do pedido em dias. E o criterio de ordem desta lista (ver o
      -- ORDER BY), e sai como coluna para a tela mostrar o mesmo numero que
      -- ordenou, em vez de recalcular a data no navegador.
      -- O ::date vale com a coluna em TIMESTAMPTZ e em DATE.
      (current_date - p.data_pedido::date)::int AS dias_aberto,
      -- A ULTIMA MOVIMENTACAO do registro, distinta da data do pedido.
      --
      -- Existe porque a idade sozinha nao discrimina nesta fila. Medido na
      -- producao em 2026-08-07: 16 dos 31 pedidos abertos tem data_pedido
      -- 01/01/2026, a data de carimbo da carga retroativa, e todos aparecem com
      -- os mesmos 218 dias. As dez linhas do topo saiam identicas em data, em
      -- idade e em prazo (nulo), e a tabela nao dizia qual pedido olhar.
      --
      -- A data_atualizacao NAO serve sozinha: e nula em 10 dos 31, porque o
      -- pedido nunca foi alterado depois de criado. O COALESCE na criacao da a
      -- coluna para todo pedido, e e ela que mostra que o pedido de "janeiro"
      -- entrou no sistema em julho.
      COALESCE(p.data_atualizacao, p.data_criacao) AS ultima_movimentacao,
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
      AND ${PEDIDO_MILITAR('p.cliente_id')}
    -- Por IDADE (o mais antigo primeiro), e NUNCA por prazo. Medido na
    -- producao: so 33 dos 164 pedidos tem prazo preenchido, e nenhum pedido
    -- aberto esta vencido hoje. Ordenar por prazo poe no topo a minoria que
    -- alguem preencheu, e uma fila de "atrasados" mostraria zero por campo em
    -- branco, nao por bom desempenho. A idade existe para todo pedido.
    -- O id desempata, para a ordem nao variar entre duas chamadas iguais.
    ORDER BY p.data_pedido, p.id
  `);
};

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
//
// Escopo: os doze meses do ANO consultado. Era uma janela deslizante de doze
// meses, que não tem como respeitar um ano de contexto (em 2025 ela continuaria
// terminando hoje). A tela de consumo (#/mapoteca/consumo) já é por ano, então
// os dois passam a contar a mesma coisa.
//
// A FONTE é o LIVRO, filtrado no tipo Consumo, desde 2026-08-08. Entrada e
// Transferência moram na mesma tabela e não gastam nada: sem o
// filtro, o painel somaria a reposição junto com o gasto e o gráfico subiria
// justamente no mês em que o material chegou.
controller.getMaterialConsumptionTrends = async (ano) => {
  return db.conn.task(async t => {
    const monthlyConsumption = await t.any(`
      WITH meses AS (
        ${MESES_DO_ANO}
      )
      SELECT
        m.mes,
        COALESCE(SUM(cm.quantidade), 0) AS quantidade_total
      FROM meses m
      LEFT JOIN mapoteca.movimento_material cm ON
        cm.tipo_movimento_id = ${TIPO_MOVIMENTO_MATERIAL.CONSUMO} AND
        date_trunc('month', cm.data_movimento)::date = m.mes
      GROUP BY m.mes
      ORDER BY m.mes
    `, { ano });

    // Top 5 most consumed materials
    const topMaterials = await t.any(`
      SELECT
        tm.id,
        tm.nome,
        SUM(cm.quantidade) AS quantidade_total
      FROM mapoteca.movimento_material cm
      JOIN mapoteca.tipo_material tm ON cm.tipo_material_id = tm.id
      WHERE cm.tipo_movimento_id = ${TIPO_MOVIMENTO_MATERIAL.CONSUMO}
        AND ${filtroAno('cm.data_movimento')}
      GROUP BY tm.id, tm.nome
      ORDER BY quantidade_total DESC
      LIMIT 5
    `, { ano });

    // Consumption by material type for each month (for top 5 materials)
    const materialIds = topMaterials.map(m => m.id);

    // Sem consumo no período não há materiais para detalhar
    // (unnest de array vazio quebraria a query)
    if (materialIds.length === 0) {
      return {
        ano,
        consumo_mensal_total: monthlyConsumption,
        materiais_mais_consumidos: [],
        consumo_por_material: []
      };
    }

    const consumptionByMaterial = await t.any(`
      WITH meses AS (
        ${MESES_DO_ANO}
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
      LEFT JOIN mapoteca.movimento_material cm ON
        cm.tipo_movimento_id = ${TIPO_MOVIMENTO_MATERIAL.CONSUMO} AND
        date_trunc('month', cm.data_movimento)::date = m.mes AND
        cm.tipo_material_id = mi.material_id
      GROUP BY m.mes, mi.material_id, tm.nome
      ORDER BY m.mes, mi.material_id
    `, { ano });

    return {
      ano,
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
      -- O avulso nao tem tipo no dominio, e cai num balde unico e explicito.
      -- Usar o nome do proprio avulso criaria uma fatia por impresso e tornaria
      -- o grafico ilegivel.
      COALESCE(tp.nome, 'Impressão avulsa') AS tipo_produto,
      ${ESCALA_DISPLAY_ITEM} AS escala,
      COUNT(DISTINCT ped.id)::int AS total_pedidos,
      COALESCE(SUM(${QTD_EFETIVA}), 0)::int AS total_produtos
    FROM mapoteca.produto_pedido pp
    JOIN mapoteca.pedido ped ON ped.id = pp.pedido_id
    ${JOIN_PRODUTO_ITEM}
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
//
// Conta o que a mapoteca ENTREGOU, e não o que lhe pediram. A consulta usava
// `filtroAno(data_pedido)` sem filtro de situação, e o gráfico somava 8.097
// exemplares ao lado de um cartão que dizia 6.535, na MESMA aba, sem explicação.
//
// A diferença não era arredondamento. Medido na produção em 2026-08-07: a maior
// barra era "Exercício Combinado ARANDU 2026", com 4.436 exemplares, do pedido
// 59, EM ANDAMENTO e sem data de atendimento. A segunda, "Racionalização do
// acervo", tinha 5 dos 6 pedidos em andamento. As duas somavam 6.399 dos 8.097:
// 79% do gráfico era trabalho ainda não feito, sob um título que diz "apoiadas".
//
// Com FILTRO_ENTREGUE_ANO o gráfico passa a fechar com o cartão "Produtos
// entregues" e com o mapa, que já usavam este mesmo filtro. O recorte militar
// vem junto, de dentro do fragmento.
controller.getOperacoesApoiadas = async (ano) => {
  return db.conn.any(
    `
    SELECT
      ped.operacao,
      COUNT(DISTINCT ped.id)::int AS total_pedidos,
      COALESCE(SUM(${QTD_EFETIVA}), 0)::int AS total_produtos
    FROM mapoteca.pedido ped
    JOIN mapoteca.produto_pedido pp ON pp.pedido_id = ped.id
    WHERE ped.operacao IS NOT NULL AND ped.operacao <> ''
      AND ${FILTRO_ENTREGUE_ANO}
    GROUP BY ped.operacao
    -- Por VOLUME, e nao por numero de pedidos: o grafico e de barras de
    -- exemplares, e ordenar por outra coisa punha barra curta acima de barra
    -- longa. O nome desempata, para a ordem nao variar entre chamadas iguais.
    ORDER BY total_produtos DESC, ped.operacao
    `,
    { ano, situacoesEntregue: SITUACOES_ENTREGUE }
  );
};

// Resumo anual: totais de pedidos, entregas, OMs, operações e custo de manutenção
controller.getResumoAnual = async (ano) => {
  const row = await db.conn.one(
    `
    SELECT p.total_pedidos, p.oms_distintas_count, o.operacoes_distintas_count,
           e.total_entregas, m.manutencoes_count, m.custo_manutencao_total
    FROM (
      SELECT
        COUNT(*)::int AS total_pedidos,
        COUNT(DISTINCT cliente_id)::int AS oms_distintas_count
      FROM mapoteca.pedido
      WHERE ${filtroAno("data_pedido")}
        -- Recorte MILITAR, igual ao das outras metricas de pedido deste
        -- arquivo. Sem ele, este bloco era o unico que somava o cliente civil,
        -- e o Resumo dizia 162 pedidos em 2026 enquanto a aba Pedidos ao lado
        -- dizia 129 (129 militares + 33 civis, 29 deles de LAI). O civil tem
        -- relatorio proprio. Ver o comentario do topo do arquivo.
        AND ${PEDIDO_MILITAR('cliente_id')}
    ) p
    CROSS JOIN (
      -- O cartao de OPERACOES sai da mesma regra do grafico logo abaixo dele
      -- (getOperacoesApoiadas): operacao com ENTREGA no ano. Antes ele vinha do
      -- bloco de cima, por data_pedido e sem filtro de situacao, e podia contar
      -- operacao que nao recebeu nada. Duas contas para o mesmo rotulo, uma no
      -- cartao e outra no grafico, e quem lesse a tela nao tinha como saber
      -- qual das duas valia.
      SELECT COUNT(DISTINCT ped.operacao)::int AS operacoes_distintas_count
      FROM mapoteca.pedido ped
      JOIN mapoteca.produto_pedido pp ON pp.pedido_id = ped.id
      WHERE ped.operacao IS NOT NULL AND ped.operacao <> ''
        AND ${FILTRO_ENTREGUE_ANO}
    ) o
    CROSS JOIN (
      SELECT COALESCE(SUM(${QTD_EFETIVA}), 0)::int AS total_entregas
      FROM mapoteca.produto_pedido pp
      JOIN mapoteca.pedido ped ON ped.id = pp.pedido_id
      WHERE ${FILTRO_ENTREGUE_ANO}
    ) e
    CROSS JOIN (
      -- A CONTAGEM de linhas sai junto da soma, e o COALESCE saiu de proposito.
      -- Ano sem nenhuma manutencao registrada devolve NULL, e a tela diz "sem
      -- registro"; ano com registro somando zero devolve 0 e mostra R$ 0,00.
      -- Sao coisas diferentes: com mapoteca.manutencao_plotter vazia, o
      -- R$ 0,00 do cartao e ausencia de fonte, e nao custo medido.
      SELECT COUNT(*)::int AS manutencoes_count,
             SUM(valor)::float8 AS custo_manutencao_total
      FROM mapoteca.manutencao_plotter
      WHERE ${filtroAno("data_manutencao")}
    ) m
    `,
    { ano, situacoesEntregue: SITUACOES_ENTREGUE }
  );

  return {
    ano,
    ...row,
    // Null só quando NÃO HÁ linha. Havendo linha, a soma vale, inclusive zero.
    // O segundo caso cobre a linha com valor nulo, que somaria NULL e seria
    // confundida com ausência de registro.
    custo_manutencao_total: row.manutencoes_count > 0
      ? Number(row.custo_manutencao_total || 0)
      : null
  };
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
      -- O NUMERO do mes, tirado do mesmo MESES_DO_ANO das outras series
      -- mensais. Um generate_series(1, 12) proprio aqui voltaria a trazer o
      -- futuro como zero, e a curva de entrega cairia no mes que ainda nao
      -- chegou. Uma fonte so para o corte, e as quatro series param juntas.
      SELECT EXTRACT(MONTH FROM m.mes)::int AS mes FROM (${MESES_DO_ANO}) m
    ),
    itens AS (
      SELECT
        EXTRACT(MONTH FROM ped.data_atendimento)::int AS mes,
        ${QTD_EFETIVA} AS qtd,
        ${PRODUTO_TIPO_ID} AS tipo_produto_id
      FROM mapoteca.produto_pedido pp
      JOIN mapoteca.pedido ped ON ped.id = pp.pedido_id
      ${JOIN_PRODUTO_ITEM}
      WHERE ${FILTRO_ENTREGUE_ANO}
    )
    SELECT
      m.mes,
      COALESCE(SUM(i.qtd) FILTER (WHERE i.tipo_produto_id = $<tipoTopo>), 0)::int AS carta_topo,
      COALESCE(SUM(i.qtd) FILTER (WHERE i.tipo_produto_id = $<tipoOrto>), 0)::int AS carta_orto,
      -- O "IS NULL OR" nao e enfeite: o item avulso tem tipo_produto_id NULO, e
      -- em SQL "NULL NOT IN (2,3)" da NULL, nao verdadeiro. Sem ele o avulso
      -- ficaria de fora de "outros" e DENTRO do total, e as tres colunas
      -- deixariam de somar o total, sem ninguem ver.
      COALESCE(SUM(i.qtd) FILTER (WHERE i.tipo_produto_id IS NULL
                                     OR i.tipo_produto_id NOT IN ($<tipoTopo>, $<tipoOrto>)), 0)::int AS outros,
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

// Os três filtros do mapa, cada um com a condição SQL que o realiza. Ficam
// juntos para que o mapa e as listas de opção nunca apliquem o mesmo filtro de
// dois jeitos: é essa coincidência que faz o total do mapa fechar com a soma
// das opções.
const FILTROS_MAPA = {
  tipo_produto_id: { sql: 'prod.tipo_produto_id = $<tipoProdutoId>', param: 'tipoProdutoId' },
  escala: { sql: `${ESCALA_DISPLAY} = $<escala>`, param: 'escala' },
  cliente_id: { sql: 'ped.cliente_id = $<clienteId>', param: 'clienteId' }
};

/**
 * Trecho `AND ...` com os filtros preenchidos, podendo PULAR um deles.
 *
 * O pulo é o que faz a lista de opções ser faceted: a lista de escalas aplica
 * tipo e cliente, mas não a escala escolhida. Se aplicasse, ela devolveria só a
 * própria escolha e não haveria como trocar de escala sem antes limpar.
 *
 * @param {Object} filtros
 * @param {string} [exceto] - chave a ignorar
 */
const condicoesDeFiltro = (filtros = {}, exceto = null) => {
  const partes = Object.entries(FILTROS_MAPA)
    .filter(([chave]) => chave !== exceto && filtros[chave])
    .map(([, def]) => def.sql);
  return partes.length ? `AND ${partes.join(' AND ')}` : '';
};

/** Parâmetros nomeados das consultas do mapa. Nulo é valor válido: a condição
 * correspondente simplesmente não entra no SQL. */
const paramsDeFiltro = (ano, filtros = {}) => ({
  ano,
  situacoesEntregue: SITUACOES_ENTREGUE,
  tipoProdutoId: filtros.tipo_produto_id || null,
  escala: filtros.escala || null,
  clienteId: filtros.cliente_id || null
});

// Entregas do ano com GEOMETRIA, para o mapa do dashboard.
//
// Uma linha por PRODUTO do acervo, com o quanto dele saiu no ano. É a mesma
// população do cartão "Produtos entregues" do resumo anual (mesmo filtro de
// situação e mesma data efetiva), agregada por produto em vez de somada: o total
// das feições tem de fechar com o cartão.
//
// `sem_geometria` sai junto de propósito. O produto do acervo sempre tem
// geometria hoje, mas se um dia não tiver, o mapa mostraria menos entregas do
// que o cartão sem explicar por quê. Com o número, a tela pode dizer.
//
// FILTROS (tipo de produto, escala e cliente) são opcionais e se combinam por E.
// Ficam no SERVIDOR, e não na tela, porque `cliente_id` não existe na feição:
// ela traz a CONTAGEM de OMs atendidas, não a lista. Filtrar tipo e escala no
// cliente e o cliente no servidor deixaria as três contas com regras
// diferentes, e o número do resumo pararia de fechar com o mapa.
//
// A escala entra pelo RÓTULO, e não pelo código do domínio: a escala
// personalizada tem um código só para todos os denominadores, e filtrar por ele
// juntaria 1:30.000 com 1:75.000 numa opção só chamada "personalizada". O
// rótulo sai do mesmo ESCALA_DISPLAY que alimenta a lista de opções, então os
// dois lados nunca divergem. O custo é comparar texto sem índice, sobre pouco
// mais de mil linhas por ano.
controller.getEntregasGeo = async (ano, filtros = {}) => {
  const filtroSql = condicoesDeFiltro(filtros);

  return db.conn.task(async t => {
    const params = paramsDeFiltro(ano, filtros);

    const linhas = await t.any(
      `
      SELECT
        prod.id,
        prod.nome,
        prod.mi,
        tp.nome AS tipo_produto,
        ${ESCALA_DISPLAY} AS escala,
        COUNT(DISTINCT ped.id)::int AS total_pedidos,
        COUNT(DISTINCT ped.cliente_id)::int AS total_clientes,
        COALESCE(SUM(${QTD_EFETIVA}), 0)::int AS total_produtos,
        -- O terceiro argumento zera o membro crs, que este PostGIS (3.4.3)
        -- emite por padrão. Ele é resquício de uma versão antiga do GeoJSON, a
        -- RFC 7946 o removeu, o MapLibre o ignora, e ele custava cerca de 65
        -- bytes por geometria: quase um terço do corpo da resposta.
        -- (Sem crase aqui: a consulta é um template literal.)
        ST_AsGeoJSON(prod.geom, 9, 0) AS geom,
        -- Ponto de rótulo, calculado aqui e não no navegador.
        --
        -- Rotular o POLÍGONO faz a mesma carta aparecer duas vezes no mapa: o
        -- MapLibre corta o GeoJSON em ladrilhos e escolhe a âncora do texto por
        -- pedaço, então a folha que cruza a borda de um ladrilho ganha um
        -- rótulo de cada lado. Um ponto cabe num ladrilho só, e resolve.
        --
        -- PointOnSurface, e não Centroid: o centroide de uma folha em L cai
        -- fora dela, e o rótulo apareceria sobre a carta vizinha.
        ST_AsGeoJSON(ST_PointOnSurface(prod.geom), 9, 0) AS ponto,
        -- Área só para ordenar o desenho; ver o comentário do ORDER BY.
        ST_Area(prod.geom)::float8 AS area
      FROM mapoteca.produto_pedido pp
      JOIN mapoteca.pedido ped ON ped.id = pp.pedido_id
      -- INNER de proposito: isto desenha o MAPA, e so entra o que tem geometria
      -- (repare no prod.geom IS NOT NULL logo abaixo). O item avulso nao tem
      -- produto no acervo, logo nao tem geometria, e ja seria descartado por
      -- aquele filtro. Ele e contado no "semGeometria", logo adiante.
      JOIN acervo.versao v ON v.uuid_versao = pp.uuid_versao
      JOIN acervo.produto prod ON prod.id = v.produto_id
      JOIN dominio.tipo_produto tp ON tp.code = prod.tipo_produto_id
      JOIN dominio.tipo_escala te ON te.code = prod.tipo_escala_id
      WHERE ${FILTRO_ENTREGUE_ANO}
        AND prod.geom IS NOT NULL
        ${filtroSql}
      GROUP BY prod.id, prod.nome, prod.mi, tp.nome, prod.tipo_escala_id,
               prod.denominador_escala_especial, te.nome, prod.geom
      -- Da MAIOR para a menor. O mapeamento é aninhado por escala (a folha
      -- 1:25.000 fica dentro da 1:100.000, que fica dentro da 1:250.000), e o
      -- preenchimento é translúcido: sem ordem, a folha grande podia cair por
      -- cima da pequena e escondê-la. Assim a menor fica sempre por cima, que é
      -- a que a pessoa quer clicar.
      ORDER BY area DESC, prod.nome
      `,
      params
    );

    const semGeometria = await t.one(
      `
      SELECT COALESCE(SUM(${QTD_EFETIVA}), 0)::int AS total
      FROM mapoteca.produto_pedido pp
      JOIN mapoteca.pedido ped ON ped.id = pp.pedido_id
      LEFT JOIN acervo.versao v ON v.uuid_versao = pp.uuid_versao
      LEFT JOIN acervo.produto prod ON prod.id = v.produto_id
      -- LEFT, e não JOIN: o item sem produto nenhum é justamente um dos que
      -- esta conta existe para achar, e um JOIN interno o descartaria em
      -- silêncio. Com filtro de escala ativo ele sai pela comparação com NULL,
      -- que é o certo: item sem produto não pertence a escala nenhuma.
      LEFT JOIN dominio.tipo_escala te ON te.code = prod.tipo_escala_id
      WHERE ${FILTRO_ENTREGUE_ANO}
        AND prod.geom IS NULL
        ${filtroSql}
      `,
      params
    );

    // Total do ano SEM filtro, para a tela poder dizer "1.234 de 3.119". Sem
    // ele, filtrar deixaria a pessoa sem noção do tamanho do recorte.
    const totalAno = await t.one(
      `
      SELECT COALESCE(SUM(${QTD_EFETIVA}), 0)::int AS total
      FROM mapoteca.produto_pedido pp
      JOIN mapoteca.pedido ped ON ped.id = pp.pedido_id
      WHERE ${FILTRO_ENTREGUE_ANO}
      `,
      { ano, situacoesEntregue: SITUACOES_ENTREGUE }
    );

    return {
      ano,
      filtrado: filtroSql !== '',
      total_produtos: linhas.reduce((soma, l) => soma + l.total_produtos, 0),
      total_ano: totalAno.total,
      sem_geometria: semGeometria.total,
      dados: linhas.map(l => ({
        // BIGINT chega como string do pg-promise, e o mapa usa o id como
        // identificador de feição (feature-state). Número aqui evita que a
        // lista e o mapa comparem '880' com 880 e nunca se encontrem.
        id: Number(l.id),
        nome: l.nome,
        mi: l.mi,
        tipo_produto: l.tipo_produto,
        escala: l.escala,
        total_pedidos: l.total_pedidos,
        total_clientes: l.total_clientes,
        total_produtos: l.total_produtos,
        area: l.area,
        geom: JSON.parse(l.geom),
        ponto: JSON.parse(l.ponto)
      }))
    };
  });
};

// Opções dos filtros do mapa, com os quantitativos CRUZADOS entre eles.
//
// Cada lista aplica os OUTROS dois filtros, e nunca o próprio: escolher uma OM
// passa a mostrar quantos produtos daquela OM existem em cada escala e em cada
// tipo, mas a lista de escalas continua inteira, para haver como trocar de
// escala sem antes limpar. Aplicar também o próprio filtro deixaria cada lista
// com uma opção só, a que já está escolhida.
//
// Só entra o que TEM entrega: oferecer os 40 tipos do domínio quando dois
// aparecem faria a pessoa procurar num menu onde quase tudo devolve tela vazia.
// A contrapartida é que a opção pode chegar a zero e sumir; a tela mantém a
// escolha atual visível com "(0)" em vez de descartá-la em silêncio.
//
// @param {number} ano
// @param {{tipo_produto_id?:number, escala?:string, cliente_id?:number}} [filtros]
controller.getEntregasFiltros = async (ano, filtros = {}) => {
  // Alias que cada lista precisa. Ficam em TODAS as consultas, e não só onde a
  // coluna aparece no SELECT, porque qualquer uma delas pode ganhar a condição
  // de outro filtro (a escala usa `te`, o cliente usa `ped.cliente_id`).
  const DE = `
    FROM mapoteca.produto_pedido pp
    JOIN mapoteca.pedido ped ON ped.id = pp.pedido_id
    JOIN acervo.versao v ON v.uuid_versao = pp.uuid_versao
    JOIN acervo.produto prod ON prod.id = v.produto_id
    JOIN dominio.tipo_produto tp ON tp.code = prod.tipo_produto_id
    JOIN dominio.tipo_escala te ON te.code = prod.tipo_escala_id
  `;

  return db.conn.task(async t => {
    const params = paramsDeFiltro(ano, filtros);

    // As três listas saem da MESMA população que o mapa desenha: entrega do
    // ano, com produto e com geometria. Opção fora disso levaria a mapa vazio,
    // que é o oposto do que um menu de filtro deve fazer.
    const tiposProduto = await t.any(
      `
      SELECT tp.code, tp.nome, COUNT(DISTINCT prod.id)::int AS produtos
      ${DE}
      WHERE ${FILTRO_ENTREGUE_ANO}
        AND prod.geom IS NOT NULL
        ${condicoesDeFiltro(filtros, 'tipo_produto_id')}
      GROUP BY tp.code, tp.nome
      ORDER BY tp.nome
      `,
      params
    );

    const escalas = await t.any(
      `
      SELECT ${ESCALA_DISPLAY} AS escala, COUNT(DISTINCT prod.id)::int AS produtos
      ${DE}
      WHERE ${FILTRO_ENTREGUE_ANO}
        AND prod.geom IS NOT NULL
        ${condicoesDeFiltro(filtros, 'escala')}
      GROUP BY 1
      -- Pelo CÓDIGO do domínio, e depois pelo denominador da personalizada. Em
      -- ordem alfabética o rótulo '1:100.000' viria antes de '1:25.000', e a
      -- lista sairia fora de ordem de escala.
      ORDER BY MIN(prod.tipo_escala_id),
               MIN(prod.denominador_escala_especial) NULLS FIRST
      `,
      params
    );

    const clientes = await t.any(
      `
      SELECT c.id, c.nome, COUNT(DISTINCT prod.id)::int AS produtos
      ${DE}
      JOIN mapoteca.cliente c ON c.id = ped.cliente_id
      WHERE ${FILTRO_ENTREGUE_ANO}
        AND prod.geom IS NOT NULL
        ${condicoesDeFiltro(filtros, 'cliente_id')}
      GROUP BY c.id, c.nome
      ORDER BY c.nome
      `,
      params
    );

    return {
      ano,
      tipos_produto: tiposProduto,
      escalas,
      clientes: clientes.map(c => ({ ...c, id: Number(c.id) }))
    };
  });
};

// Anos que têm dado na mapoteca, para o seletor de ano da navbar.
//
// Considera a data do PEDIDO e a data de entrega, que não caem necessariamente
// no mesmo ano: pedido de dezembro entregue em janeiro tem de aparecer nos
// dois, senão um dos dois anos some do seletor. As duas datas saem da MESMA
// tabela, então a consulta não visita `produto_pedido`.
controller.getAnosComDados = async () => {
  const linhas = await db.conn.any(
    `
    SELECT DISTINCT ano FROM (
      SELECT EXTRACT(YEAR FROM data_pedido)::int AS ano
      FROM mapoteca.pedido
      WHERE data_pedido IS NOT NULL
      UNION
      SELECT EXTRACT(YEAR FROM data_atendimento)::int AS ano
      FROM mapoteca.pedido
      WHERE data_atendimento IS NOT NULL
    ) t
    WHERE ano IS NOT NULL
    ORDER BY ano DESC
    `
  );
  return linhas.map(l => l.ano);
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