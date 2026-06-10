import { el, svgIcon, ICONS } from '@utils/dom.js';
import { formatDate, formatNumber, formatCurrency, monthName } from '@utils/format.js';
import { showError, showSuccess } from '@utils/toast.js';
import { createStatsCard } from '@components/stats-card.js';
import { createPieChart } from '@components/charts/pie-chart.js';
import { createBarChart } from '@components/charts/bar-chart.js';
import { createLineChart } from '@components/charts/line-chart.js';
import { createDataTable } from '@components/data-table/data-table.js';
import { chip, chipSituacaoPedido } from '@components/status-chip.js';
import * as mapotecaService from '@services/mapoteca-service.js';

const REFRESH_INTERVAL_MS = 60 * 1000;

function exportButton(nome, getAno) {
  return el('button', {
    className: 'btn btn--secondary btn--sm',
    type: 'button',
    onClick: async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        await mapotecaService.downloadDashboardCsv(nome, getAno());
        showSuccess('Exportação CSV iniciada');
      } catch (err) {
        showError(err.message || 'Erro ao exportar CSV');
      } finally {
        btn.disabled = false;
      }
    },
  }, [svgIcon(ICONS.download, 14), 'Exportar CSV']);
}

function summaryCard(label) {
  const valueEl = el('div', { className: 'summary-card__value', textContent: '-' });
  const card = el('div', { className: 'summary-card' }, [
    valueEl,
    el('div', { className: 'summary-card__label', textContent: label }),
  ]);
  card.setValue = (v) => { valueEl.textContent = v; };
  return card;
}

/** Short month label ('Jan/26') for a date-only/ISO string, without TZ shifts. */
function mesLabel(mesIso) {
  const [ano, mes] = String(mesIso).slice(0, 10).split('-');
  if (!ano || !mes) return String(mesIso);
  return `${monthName(Number(mes)).slice(0, 3)}/${ano.slice(2)}`;
}

/** Pivot entregas_por_tipo_produto rows into stacked-bar data + series. */
function pivotEntregasPorTipo(rows) {
  const tipos = [...new Set(rows.map(r => r.tipo_produto))];
  const escalas = [...new Set(rows.map(r => r.escala))];

  const data = tipos.map(tipo => {
    const item = { tipo_produto: tipo };
    for (const escala of escalas) {
      const found = rows.find(r => r.tipo_produto === tipo && r.escala === escala);
      item[escala] = found ? Number(found.total_produtos) : 0;
    }
    return item;
  });

  const series = escalas.map(escala => ({ dataKey: escala, label: escala }));
  return { data, series };
}

/**
 * Render the Dashboard page (auto-refetch every 60s).
 * @param {HTMLElement} container
 * @returns {Function} cleanup
 */
export async function renderDashboard(container) {
  let selectedYear = new Date().getFullYear();
  let disposed = false;

  // -------------------------------------------------------------------------
  // Status cards
  // -------------------------------------------------------------------------
  const cardTotal = createStatsCard({
    title: 'Total de Pedidos', value: '-', icon: svgIcon(ICONS.assignment, 24), color: 'primary', loading: true,
  });
  const cardEmAndamento = createStatsCard({
    title: 'Em Andamento', value: '-', icon: svgIcon(ICONS.schedule, 24), color: 'info', loading: true,
  });
  const cardConcluidos = createStatsCard({
    title: 'Concluídos', value: '-', icon: svgIcon(ICONS.checkCircle, 24), color: 'success', loading: true,
  });
  const cardPendentes = createStatsCard({
    title: 'Pendentes', value: '-', icon: svgIcon(ICONS.warning, 24), color: 'warning', loading: true,
  });
  const cardTempoMedio = createStatsCard({
    title: 'Tempo Médio de Atendimento', value: '-', icon: svgIcon(ICONS.localShipping, 24), color: 'info', loading: true, suffix: 'dias',
  });

  const statsGrid = el('div', { className: 'stats-grid' }, [
    cardTotal, cardEmAndamento, cardConcluidos, cardPendentes, cardTempoMedio,
  ]);

  // -------------------------------------------------------------------------
  // Charts: status pie + stock by location bars + orders timeline line
  // -------------------------------------------------------------------------
  const statusPie = createPieChart({ title: 'Pedidos por Situação', data: [], loading: true });
  const stockBar = createBarChart({
    title: 'Estoque por Localização',
    data: [],
    xKey: 'localizacao',
    series: [{ dataKey: 'quantidade_total', label: 'Quantidade' }],
    loading: true,
  });
  const timelineLine = createLineChart({
    title: 'Pedidos por Semana (últimos 6 meses)',
    data: [],
    xKey: 'semana',
    series: [
      { dataKey: 'total_pedidos', label: 'Pedidos' },
      { dataKey: 'total_produtos', label: 'Produtos' },
    ],
    loading: true,
  });

  // -------------------------------------------------------------------------
  // Tempo de atendimento (média mensal + por tipo de cliente)
  // -------------------------------------------------------------------------
  const fulfillmentLine = createLineChart({
    title: 'Tempo médio de atendimento por mês (dias)',
    data: [],
    xKey: 'mes_nome',
    series: [{ dataKey: 'media_dias', label: 'Dias', fill: true }],
    loading: true,
  });
  const fulfillmentTipoBar = createBarChart({
    title: 'Tempo médio por tipo de cliente (dias)',
    data: [],
    xKey: 'tipo_cliente',
    series: [{ dataKey: 'media_dias', label: 'Dias' }],
    loading: true,
  });

  const atendimentoSection = el('div', { className: 'dashboard-section' }, [
    el('div', { className: 'dashboard-section__header' }, [
      el('h2', { className: 'dashboard-section__title', textContent: 'Tempo de Atendimento' }),
    ]),
    el('div', { className: 'dashboard-grid dashboard-grid--2col' }, [fulfillmentLine, fulfillmentTipoBar]),
  ]);

  // -------------------------------------------------------------------------
  // Clientes mais ativos
  // -------------------------------------------------------------------------
  const clientesAtivosTable = createDataTable({
    columns: [
      {
        key: 'nome',
        label: 'Cliente',
        sortable: true,
        render: (row) => el('a', { href: `#/clientes/${row.id}`, textContent: row.nome || '-' }),
      },
      { key: 'tipo_cliente', label: 'Tipo' },
      { key: 'total_pedidos', label: 'Pedidos', sortable: true, render: (row) => formatNumber(row.total_pedidos) },
      { key: 'pedidos_concluidos', label: 'Concluídos', render: (row) => formatNumber(row.pedidos_concluidos) },
      { key: 'total_produtos', label: 'Produtos', render: (row) => formatNumber(row.total_produtos) },
      { key: 'ultimo_pedido', label: 'Último pedido', sortable: true, render: (row) => formatDate(row.ultimo_pedido) },
    ],
    rows: [],
    pageSize: 10,
    loading: true,
    emptyMessage: 'Nenhum cliente com pedidos',
  });

  const clientesAtivosSection = el('div', { className: 'dashboard-section' }, [
    el('div', { className: 'dashboard-section__header' }, [
      el('h2', { className: 'dashboard-section__title', textContent: 'Clientes Mais Ativos (Top 10)' }),
    ]),
    clientesAtivosTable.element,
  ]);

  // -------------------------------------------------------------------------
  // Consumo de material (12 meses)
  // -------------------------------------------------------------------------
  const consumoLine = createLineChart({
    title: 'Consumo total por mês',
    data: [],
    xKey: 'mes_nome',
    series: [{ dataKey: 'quantidade_total', label: 'Quantidade', fill: true }],
    loading: true,
  });
  const topMateriaisBar = createBarChart({
    title: 'Materiais mais consumidos (Top 5)',
    data: [],
    xKey: 'nome',
    series: [{ dataKey: 'quantidade_total', label: 'Quantidade' }],
    horizontal: true,
    loading: true,
  });

  const consumoSection = el('div', { className: 'dashboard-section' }, [
    el('div', { className: 'dashboard-section__header' }, [
      el('h2', { className: 'dashboard-section__title', textContent: 'Consumo de Material (últimos 12 meses)' }),
    ]),
    el('div', { className: 'dashboard-grid dashboard-grid--2col' }, [consumoLine, topMateriaisBar]),
  ]);

  // -------------------------------------------------------------------------
  // Situação dos plotters
  // -------------------------------------------------------------------------
  const plotterCards = {
    total: summaryCard('Total de plotters'),
    ativos: summaryCard('Ativos'),
    inativos: summaryCard('Inativos'),
  };

  const plotterTable = createDataTable({
    columns: [
      {
        key: 'modelo',
        label: 'Modelo',
        sortable: true,
        render: (row) => el('a', { href: `#/plotters/${row.id}`, textContent: row.modelo || '-' }),
      },
      { key: 'nr_serie', label: 'Número de série' },
      {
        key: 'ativo',
        label: 'Status',
        render: (row) => row.ativo ? chip('Ativo', 'success') : chip('Inativo', 'default'),
      },
      {
        key: 'data_ultima_manutencao',
        label: 'Última manutenção',
        sortable: true,
        render: (row) => formatDate(row.data_ultima_manutencao),
      },
      {
        key: 'custo_total_manutencao',
        label: 'Custo de manutenção',
        render: (row) => formatCurrency(row.custo_total_manutencao),
      },
      {
        key: 'fim_vida_util',
        label: 'Vida útil',
        render: (row) => {
          if (row.fim_vida_util === true) return chip('Expirada', 'error');
          if (row.fim_vida_util === false) return chip('Vigente', 'success');
          return el('span', { textContent: '-' });
        },
      },
    ],
    rows: [],
    pageSize: 5,
    loading: true,
    emptyMessage: 'Nenhum plotter cadastrado',
  });

  const plottersSection = el('div', { className: 'dashboard-section' }, [
    el('div', { className: 'dashboard-section__header' }, [
      el('h2', { className: 'dashboard-section__title', textContent: 'Plotters' }),
    ]),
    el('div', { className: 'summary-cards' }, Object.values(plotterCards)),
    plotterTable.element,
  ]);

  // -------------------------------------------------------------------------
  // Pending orders table
  // -------------------------------------------------------------------------
  const pendingTable = createDataTable({
    columns: [
      { key: 'id', label: 'ID', sortable: true },
      { key: 'data_pedido', label: 'Data do Pedido', sortable: true, render: (row) => formatDate(row.data_pedido) },
      { key: 'cliente_nome', label: 'Cliente', sortable: true },
      { key: 'prazo', label: 'Prazo', sortable: true, render: (row) => formatDate(row.prazo) },
      {
        key: 'dias_ate_prazo',
        label: 'Dias até o Prazo',
        sortable: true,
        render: (row) => (row.dias_ate_prazo === null || row.dias_ate_prazo === undefined)
          ? '-'
          : formatNumber(row.dias_ate_prazo),
      },
      {
        key: 'situacao_nome',
        label: 'Situação',
        render: (row) => chipSituacaoPedido(row.situacao_pedido_id, row.situacao_nome),
      },
      { key: 'quantidade_produtos', label: 'Produtos', sortable: true },
      {
        key: 'atrasado',
        label: 'Atraso',
        render: (row) => {
          if (row.atrasado === true) return chip('Atrasado', 'error');
          if (row.atrasado === false) return chip('Em dia', 'success');
          return el('span', { textContent: '-' });
        },
      },
    ],
    rows: [],
    searchable: true,
    pageSize: 10,
    loading: true,
    emptyMessage: 'Nenhum pedido pendente',
  });

  const pendingSection = el('div', { className: 'dashboard-section' }, [
    el('div', { className: 'dashboard-section__header' }, [
      el('h2', { className: 'dashboard-section__title', textContent: 'Pedidos Pendentes' }),
    ]),
    pendingTable.element,
  ]);

  // -------------------------------------------------------------------------
  // Annual section (year selector + 5 summary cards + charts + monthly table)
  // -------------------------------------------------------------------------
  const currentYear = new Date().getFullYear();
  const yearSelect = el('select', {
    className: 'chart-card__select',
    'aria-label': 'Selecionar ano',
    onChange: (e) => {
      selectedYear = parseInt(e.target.value, 10);
      loadAnnual();
    },
  }, Array.from({ length: 6 }, (_, i) => {
    const year = currentYear - i;
    return el('option', { value: String(year), textContent: String(year) });
  }));
  yearSelect.value = String(currentYear);

  const annualCards = {
    totalPedidos: summaryCard('Pedidos no ano'),
    totalEntregas: summaryCard('Produtos entregues'),
    omsDistintas: summaryCard('OMs distintas'),
    operacoesDistintas: summaryCard('Operações apoiadas'),
    custoManutencao: summaryCard('Custo de manutenção'),
  };

  const summaryGrid = el('div', { className: 'summary-cards' }, Object.values(annualCards));

  const entregasTipoChart = createBarChart({
    title: 'Entregas por Tipo de Produto × Escala',
    data: [],
    xKey: 'tipo_produto',
    series: [],
    stacked: true,
    loading: true,
  });

  const entregasMidiaChart = createBarChart({
    title: 'Entregas por Tipo de Mídia',
    data: [],
    xKey: 'tipo_midia',
    series: [{ dataKey: 'total_produtos', label: 'Produtos' }],
    loading: true,
  });

  const operacoesChart = createBarChart({
    title: 'Operações Apoiadas',
    data: [],
    xKey: 'operacao',
    series: [
      { dataKey: 'total_pedidos', label: 'Pedidos' },
      { dataKey: 'total_produtos', label: 'Produtos' },
    ],
    horizontal: true,
    loading: true,
  });

  const entregasMesTable = createDataTable({
    columns: [
      { key: 'mes_nome', label: 'Mês' },
      { key: 'carta_topo', label: 'Carta Topo', render: (row) => formatNumber(row.carta_topo) },
      { key: 'carta_orto', label: 'Carta Orto', render: (row) => formatNumber(row.carta_orto) },
      { key: 'outros', label: 'Outros', render: (row) => formatNumber(row.outros) },
      { key: 'total', label: 'Total', render: (row) => formatNumber(row.total) },
    ],
    rows: [],
    pageSize: 25,
    loading: true,
    emptyMessage: 'Sem entregas no ano selecionado',
  });

  const getAno = () => selectedYear;

  const annualSection = el('div', { className: 'dashboard-section' }, [
    el('div', { className: 'dashboard-section__header' }, [
      el('h2', { className: 'dashboard-section__title', textContent: 'Resumo Anual' }),
      el('div', { className: 'dashboard-section__controls' }, [
        el('span', { textContent: 'Ano:' }),
        yearSelect,
      ]),
    ]),
    summaryGrid,
    el('div', { className: 'export-bar' }, [exportButton('entregas_por_tipo_produto', getAno)]),
    entregasTipoChart,
    el('div', { className: 'dashboard-grid dashboard-grid--2col' }, [
      el('div', {}, [
        el('div', { className: 'export-bar' }, [exportButton('entregas_por_midia', getAno)]),
        entregasMidiaChart,
      ]),
      el('div', {}, [
        el('div', { className: 'export-bar' }, [exportButton('operacoes_apoiadas', getAno)]),
        operacoesChart,
      ]),
    ]),
    el('div', { className: 'export-bar' }, [exportButton('entregas_por_mes', getAno)]),
    entregasMesTable.element,
  ]);

  // -------------------------------------------------------------------------
  // Page assembly
  // -------------------------------------------------------------------------
  const page = el('div', { className: 'dashboard' }, [
    el('h1', { className: 'dashboard__title', textContent: 'Dashboard' }),
    statsGrid,
    el('div', { className: 'dashboard-grid dashboard-grid--2col' }, [statusPie, stockBar]),
    timelineLine,
    pendingSection,
    atendimentoSection,
    clientesAtivosSection,
    consumoSection,
    plottersSection,
    annualSection,
  ]);
  container.appendChild(page);

  // -------------------------------------------------------------------------
  // Data loading
  // -------------------------------------------------------------------------
  async function loadOverview() {
    const results = await Promise.allSettled([
      mapotecaService.getOrderStatus(),
      mapotecaService.getStockByLocation(),
      mapotecaService.getOrdersTimeline(6),
      mapotecaService.getPendingOrders(),
      mapotecaService.getAvgFulfillmentTime(),
      mapotecaService.getClientActivity(10),
      mapotecaService.getMaterialConsumption(12),
      mapotecaService.getPlotterStatus(),
    ]);
    if (disposed) return;

    const [statusRes, stockRes, timelineRes, pendingRes, avgRes, clientesRes, consumoRes, plotterRes] = results;

    if (statusRes.status === 'fulfilled') {
      const status = statusRes.value;
      cardTotal.update({ value: formatNumber(status.total), loading: false });
      cardEmAndamento.update({ value: formatNumber(status.em_andamento), loading: false });
      cardConcluidos.update({ value: formatNumber(status.concluidos), loading: false });
      cardPendentes.update({ value: formatNumber(status.pendentes), loading: false });

      const distribuicao = status.distribuicao || [];
      statusPie.update({
        data: distribuicao.map(d => ({ label: d.nome, value: Number(d.quantidade) })),
        loading: false,
      });
    } else {
      showError(statusRes.reason?.message || 'Erro ao carregar situação dos pedidos');
    }

    if (stockRes.status === 'fulfilled') {
      stockBar.update({
        data: stockRes.value.map(s => ({
          localizacao: s.localizacao,
          quantidade_total: Number(s.quantidade_total),
        })),
        loading: false,
      });
    }

    if (timelineRes.status === 'fulfilled') {
      timelineLine.update({
        data: timelineRes.value.map(t => ({
          semana: formatDate(t.semana_inicio),
          total_pedidos: Number(t.total_pedidos),
          total_produtos: Number(t.total_produtos),
        })),
        loading: false,
      });
    }

    if (pendingRes.status === 'fulfilled') {
      pendingTable.update({ rows: pendingRes.value, loading: false });
    }

    if (avgRes.status === 'fulfilled') {
      const avg = avgRes.value;
      cardTempoMedio.update({
        value: avg.media_geral != null ? formatNumber(avg.media_geral) : '-',
        loading: false,
        suffix: avg.media_geral != null ? 'dias' : '',
      });
      fulfillmentLine.update({
        data: (avg.mensal || []).map(m => ({
          mes_nome: mesLabel(m.mes),
          media_dias: Number(m.media_dias),
        })),
        loading: false,
      });
      fulfillmentTipoBar.update({
        data: (avg.por_tipo_cliente || []).map(t => ({
          tipo_cliente: t.tipo_cliente,
          media_dias: Number(t.media_dias),
        })),
        loading: false,
      });
    } else {
      cardTempoMedio.update({ value: '-', loading: false, suffix: '' });
      fulfillmentLine.update({ data: [], loading: false });
      fulfillmentTipoBar.update({ data: [], loading: false });
    }

    if (clientesRes.status === 'fulfilled') {
      clientesAtivosTable.update({ rows: clientesRes.value || [], loading: false });
    } else {
      clientesAtivosTable.update({ rows: [], loading: false });
    }

    if (consumoRes.status === 'fulfilled') {
      const consumo = consumoRes.value;
      consumoLine.update({
        data: (consumo.consumo_mensal_total || []).map(m => ({
          mes_nome: mesLabel(m.mes),
          quantidade_total: Number(m.quantidade_total),
        })),
        loading: false,
      });
      topMateriaisBar.update({
        data: (consumo.materiais_mais_consumidos || []).map(m => ({
          nome: m.nome,
          quantidade_total: Number(m.quantidade_total),
        })),
        loading: false,
      });
    } else {
      consumoLine.update({ data: [], loading: false });
      topMateriaisBar.update({ data: [], loading: false });
    }

    if (plotterRes.status === 'fulfilled') {
      const { sumario = {}, plotters = [] } = plotterRes.value || {};
      plotterCards.total.setValue(formatNumber(sumario.total ?? 0));
      plotterCards.ativos.setValue(formatNumber(sumario.ativos ?? 0));
      plotterCards.inativos.setValue(formatNumber(sumario.inativos ?? 0));
      plotterTable.update({ rows: plotters, loading: false });
    } else {
      plotterTable.update({ rows: [], loading: false });
    }
  }

  async function loadAnnual() {
    const ano = selectedYear;
    entregasTipoChart.update({ loading: true });
    entregasMidiaChart.update({ loading: true });
    operacoesChart.update({ loading: true });
    entregasMesTable.update({ loading: true });

    const results = await Promise.allSettled([
      mapotecaService.getResumoAnual(ano),
      mapotecaService.getEntregasPorTipoProduto(ano),
      mapotecaService.getEntregasPorMidia(ano),
      mapotecaService.getOperacoesApoiadas(ano),
      mapotecaService.getEntregasPorMes(ano),
    ]);
    if (disposed || ano !== selectedYear) return;

    const [resumoRes, tipoRes, midiaRes, operacoesRes, mesRes] = results;

    if (resumoRes.status === 'fulfilled') {
      const resumo = resumoRes.value;
      annualCards.totalPedidos.setValue(formatNumber(resumo.total_pedidos));
      annualCards.totalEntregas.setValue(formatNumber(resumo.total_entregas));
      annualCards.omsDistintas.setValue(formatNumber(resumo.oms_distintas_count));
      annualCards.operacoesDistintas.setValue(formatNumber(resumo.operacoes_distintas_count));
      annualCards.custoManutencao.setValue(formatCurrency(resumo.custo_manutencao_total));
    } else {
      showError(resumoRes.reason?.message || 'Erro ao carregar o resumo anual');
    }

    if (tipoRes.status === 'fulfilled') {
      const { data, series } = pivotEntregasPorTipo(tipoRes.value);
      entregasTipoChart.update({ data, series, loading: false });
    } else {
      entregasTipoChart.update({ data: [], loading: false });
    }

    if (midiaRes.status === 'fulfilled') {
      entregasMidiaChart.update({
        data: midiaRes.value.map(m => ({
          tipo_midia: m.tipo_midia || 'Não informado',
          total_produtos: Number(m.total_produtos),
        })),
        loading: false,
      });
    } else {
      entregasMidiaChart.update({ data: [], loading: false });
    }

    if (operacoesRes.status === 'fulfilled') {
      operacoesChart.update({
        data: operacoesRes.value.map(o => ({
          operacao: o.operacao,
          total_pedidos: Number(o.total_pedidos),
          total_produtos: Number(o.total_produtos),
        })),
        loading: false,
      });
    } else {
      operacoesChart.update({ data: [], loading: false });
    }

    if (mesRes.status === 'fulfilled') {
      entregasMesTable.update({
        rows: mesRes.value.map(m => ({ ...m, mes_nome: monthName(m.mes) })),
        loading: false,
      });
    } else {
      entregasMesTable.update({ rows: [], loading: false });
    }
  }

  async function loadAll() {
    await Promise.all([loadOverview(), loadAnnual()]);
  }

  await loadAll();

  // Auto-refetch every 60s (invalidate the dashboard cache first)
  const intervalId = setInterval(() => {
    mapotecaService.invalidateDashboardCache();
    loadAll();
  }, REFRESH_INTERVAL_MS);

  return () => {
    disposed = true;
    clearInterval(intervalId);
    statusPie._cleanup();
    stockBar._cleanup();
    timelineLine._cleanup();
    fulfillmentLine._cleanup();
    fulfillmentTipoBar._cleanup();
    consumoLine._cleanup();
    topMateriaisBar._cleanup();
    entregasTipoChart._cleanup();
    entregasMidiaChart._cleanup();
    operacoesChart._cleanup();
    pendingTable._cleanup();
    clientesAtivosTable._cleanup();
    plotterTable._cleanup();
    entregasMesTable._cleanup();
  };
}
