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

  const statsGrid = el('div', { className: 'stats-grid' }, [
    cardTotal, cardEmAndamento, cardConcluidos, cardPendentes,
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
    ]);
    if (disposed) return;

    const [statusRes, stockRes, timelineRes, pendingRes] = results;

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
    entregasTipoChart._cleanup();
    entregasMidiaChart._cleanup();
    operacoesChart._cleanup();
    pendingTable._cleanup();
    entregasMesTable._cleanup();
  };
}
