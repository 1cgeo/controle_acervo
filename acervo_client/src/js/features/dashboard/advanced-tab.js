import { el } from '@utils/dom.js';
import { createBarChart } from '@components/charts/bar-chart.js';
import { createPieChart } from '@components/charts/pie-chart.js';
import { createDataTable } from '@components/data-table.js';
import { createTabs } from '@components/tabs.js';
import { formatNumber, formatMonth } from '@utils/format.js';
import * as dashboardService from '@services/dashboard-service.js';

/**
 * Render the "Análises Avançadas" tab.
 * @param {HTMLElement} container
 * @returns {{cleanup: Function, refresh: Function}}
 */
export async function renderAdvancedTab(container) {
  let disposed = false;
  const cleanups = [];

  // --- Product Activity Timeline ---
  const timelineSelect = el('select', { className: 'chart-card__select' }, [
    el('option', { value: '6', textContent: '6 meses' }),
    el('option', { value: '12', textContent: '12 meses' }),
    el('option', { value: '24', textContent: '24 meses' }),
  ]);

  const timelineChart = createBarChart({
    title: '',
    xKey: 'month_label',
    series: [
      { dataKey: 'new_products', label: 'Novos Produtos', color: '#4caf50' },
      { dataKey: 'modified_products', label: 'Produtos Modificados', color: '#ff9800' },
    ],
    loading: true,
  });
  cleanups.push(() => { if (timelineChart._cleanup) timelineChart._cleanup(); });

  // Custom header for timeline chart
  const timelineHeader = el('div', { className: 'chart-card__header' }, [
    el('div', { className: 'chart-card__title', textContent: 'Timeline de Atividade de Produtos' }),
    timelineSelect,
  ]);
  timelineChart.querySelector('.chart-card__title')?.remove();
  timelineChart.prepend(timelineHeader);

  async function loadTimeline(months, silent = false) {
    if (!silent) timelineChart.update({ loading: true });
    try {
      const data = await dashboardService.getProdutoActivityTimeline(months);
      if (disposed) return;
      const formatted = (Array.isArray(data) ? data : []).map(d => ({
        ...d,
        month_label: formatMonth(d.month),
      }));
      timelineChart.update({ data: formatted, loading: false });
    } catch {
      if (disposed) return;
      timelineChart.update({ data: [], loading: false });
    }
  }

  timelineSelect.addEventListener('change', () => loadTimeline(parseInt(timelineSelect.value)));
  loadTimeline(6);

  // --- Version Activity Timeline ---
  const versionTimelineSelect = el('select', { className: 'chart-card__select' }, [
    el('option', { value: '6', textContent: '6 meses' }),
    el('option', { value: '12', textContent: '12 meses' }),
    el('option', { value: '24', textContent: '24 meses' }),
  ]);

  const versionTimelineChart = createBarChart({
    title: '',
    xKey: 'month_label',
    series: [
      { dataKey: 'novas_versoes', label: 'Novas Versões', color: '#4caf50' },
      { dataKey: 'acumulado', label: 'Acumulado', color: '#2196f3' },
    ],
    loading: true,
  });
  cleanups.push(() => { if (versionTimelineChart._cleanup) versionTimelineChart._cleanup(); });

  const versionTimelineHeader = el('div', { className: 'chart-card__header' }, [
    el('div', { className: 'chart-card__title', textContent: 'Timeline de Versões Cadastradas' }),
    versionTimelineSelect,
  ]);
  versionTimelineChart.querySelector('.chart-card__title')?.remove();
  versionTimelineChart.prepend(versionTimelineHeader);

  async function loadVersionTimeline(months, silent = false) {
    if (!silent) versionTimelineChart.update({ loading: true });
    try {
      const data = await dashboardService.getVersaoActivityTimeline(months);
      if (disposed) return;
      const formatted = (Array.isArray(data) ? data : []).map(d => ({
        ...d,
        month_label: formatMonth(d.month),
        novas_versoes: Number(d.novas_versoes),
        acumulado: Number(d.acumulado),
      }));
      versionTimelineChart.update({ data: formatted, loading: false });
    } catch {
      if (disposed) return;
      versionTimelineChart.update({ data: [], loading: false });
    }
  }

  versionTimelineSelect.addEventListener('change', () => loadVersionTimeline(parseInt(versionTimelineSelect.value)));
  loadVersionTimeline(6);

  // Layout: 2 timelines side by side
  const timelinesGrid = el('div', { className: 'dashboard-grid dashboard-grid--2col' }, [
    timelineChart,
    versionTimelineChart,
  ]);
  container.appendChild(timelinesGrid);

  // --- Sub-tabs for detailed analytics ---
  const subTabs = createTabs({
    className: 'sub-tabs',
    tabs: [
      { id: 'versions', label: 'Estatísticas de Versões', render: renderVersionStats },
      { id: 'storage', label: 'Tendências de Armazenamento', render: renderStorageTrends },
      { id: 'projects', label: 'Status de Projetos', render: renderProjectStatus },
      { id: 'users', label: 'Atividade de Usuários', render: renderUserActivity },
    ],
  });
  cleanups.push(() => { if (subTabs.element._cleanup) subTabs.element._cleanup(); });

  container.appendChild(subTabs.element);

  return {
    cleanup: () => {
      disposed = true;
      cleanups.forEach(fn => fn());
    },
    refresh: async () => {
      await Promise.all([
        loadTimeline(parseInt(timelineSelect.value), true),
        loadVersionTimeline(parseInt(versionTimelineSelect.value), true),
        subTabs.refreshActive(),
      ]);
    },
  };
}

async function renderVersionStats(container) {
  let disposed = false;

  // Summary cards placeholder
  const summaryGrid = el('div', { className: 'summary-cards' });
  container.appendChild(summaryGrid);

  // Pie charts
  const distPie = createPieChart({ title: 'Distribuição de Versões por Produto', loading: true });
  const typePie = createPieChart({ title: 'Tipos de Versão', loading: true });

  const chartsGrid = el('div', { className: 'dashboard-grid dashboard-grid--2col' }, [distPie, typePie]);
  container.appendChild(chartsGrid);

  async function loadData() {
    try {
      const data = await dashboardService.getVersionStatistics();
      if (disposed) return;
      const stats = data?.stats || {};

      const cards = [
        { label: 'Total de Versões', value: formatNumber(stats.total_versions) },
        { label: 'Produtos com Versões', value: formatNumber(stats.products_with_versions) },
        { label: 'Média por Produto', value: Number(stats.avg_versions_per_product || 0).toFixed(1) },
        { label: 'Máximo por Produto', value: formatNumber(stats.max_versions_per_product) },
      ];

      summaryGrid.innerHTML = '';
      for (const card of cards) {
        summaryGrid.appendChild(
          el('div', { className: 'summary-card' }, [
            el('div', { className: 'summary-card__value', textContent: card.value }),
            el('div', { className: 'summary-card__label', textContent: card.label }),
          ])
        );
      }

      // Version distribution pie
      if (Array.isArray(data?.distribution)) {
        distPie.update({
          data: data.distribution.map(d => ({
            label: `${d.versions_per_product} versões`,
            value: Number(d.product_count),
          })),
          loading: false,
        });
      } else {
        distPie.update({ data: [], loading: false });
      }

      // Version type pie
      if (Array.isArray(data?.type_distribution)) {
        typePie.update({
          data: data.type_distribution.map(d => ({
            label: d.version_type || 'N/A',
            value: Number(d.version_count),
          })),
          loading: false,
        });
      } else {
        typePie.update({ data: [], loading: false });
      }
    } catch {
      if (disposed) return;
      distPie.update({ data: [], loading: false });
      typePie.update({ data: [], loading: false });
    }
  }

  await loadData();

  return {
    cleanup: () => {
      disposed = true;
      if (distPie._cleanup) distPie._cleanup();
      if (typePie._cleanup) typePie._cleanup();
    },
    refresh: loadData,
  };
}

async function renderStorageTrends(container) {
  let disposed = false;

  const periodSelect = el('select', { className: 'chart-card__select' }, [
    el('option', { value: '6', textContent: '6 meses' }),
    el('option', { value: '12', textContent: '12 meses' }),
    el('option', { value: '24', textContent: '24 meses' }),
  ]);

  const chart = createBarChart({
    title: '',
    xKey: 'month_label',
    series: [
      { dataKey: 'gb_added', label: 'GB Adicionados', color: '#4caf50' },
      { dataKey: 'cumulative_gb', label: 'GB Acumulados', color: '#2196f3' },
    ],
    loading: true,
  });

  const header = el('div', { className: 'chart-card__header' }, [
    el('div', { className: 'chart-card__title', textContent: 'Tendências de Armazenamento' }),
    periodSelect,
  ]);
  chart.querySelector('.chart-card__title')?.remove();
  chart.prepend(header);

  async function loadData(months, silent = false) {
    if (!silent) chart.update({ loading: true });
    try {
      const data = await dashboardService.getStorageGrowthTrends(months);
      if (disposed) return;
      const formatted = (Array.isArray(data) ? data : []).map(d => ({
        ...d,
        month_label: formatMonth(d.month),
        gb_added: Number(d.gb_added),
        cumulative_gb: Number(d.cumulative_gb),
      }));
      chart.update({ data: formatted, loading: false });
    } catch {
      if (disposed) return;
      chart.update({ data: [], loading: false });
    }
  }

  periodSelect.addEventListener('change', () => loadData(parseInt(periodSelect.value)));
  loadData(6);

  container.appendChild(chart);

  return {
    cleanup: () => {
      disposed = true;
      if (chart._cleanup) chart._cleanup();
    },
    refresh: () => loadData(parseInt(periodSelect.value), true),
  };
}

async function renderProjectStatus(container) {
  let disposed = false;

  const summaryGrid = el('div', { className: 'summary-cards' });
  container.appendChild(summaryGrid);

  const projectPie = createPieChart({ title: 'Status dos Projetos', loading: true });
  const lotPie = createPieChart({ title: 'Status dos Lotes', loading: true });

  const chartsGrid = el('div', { className: 'dashboard-grid dashboard-grid--2col' }, [projectPie, lotPie]);
  container.appendChild(chartsGrid);

  async function loadData() {
    try {
      const data = await dashboardService.getProjectStatusSummary();
      if (disposed) return;

      // Projects without lots card
      summaryGrid.innerHTML = '';
      summaryGrid.appendChild(
        el('div', { className: 'summary-card' }, [
          el('div', { className: 'summary-card__value', textContent: formatNumber(data?.projects_without_lots ?? 0) }),
          el('div', { className: 'summary-card__label', textContent: 'Projetos sem Lotes' }),
        ])
      );

      // Project status pie
      if (Array.isArray(data?.project_status)) {
        projectPie.update({
          data: data.project_status.map(d => ({
            label: d.status,
            value: Number(d.project_count),
          })),
          loading: false,
        });
      } else {
        projectPie.update({ data: [], loading: false });
      }

      // Lot status pie
      if (Array.isArray(data?.lot_status)) {
        lotPie.update({
          data: data.lot_status.map(d => ({
            label: d.status,
            value: Number(d.lot_count),
          })),
          loading: false,
        });
      } else {
        lotPie.update({ data: [], loading: false });
      }
    } catch {
      if (disposed) return;
      projectPie.update({ data: [], loading: false });
      lotPie.update({ data: [], loading: false });
    }
  }

  await loadData();

  return {
    cleanup: () => {
      disposed = true;
      if (projectPie._cleanup) projectPie._cleanup();
      if (lotPie._cleanup) lotPie._cleanup();
    },
    refresh: loadData,
  };
}

async function renderUserActivity(container) {
  container.appendChild(el('div', {
    className: 'data-table-wrapper__title',
    style: { marginBottom: 'var(--space-sm)' },
    textContent: 'Top 10 Usuários Mais Ativos',
  }));

  const table = createDataTable({
    columns: [
      { key: 'usuario', label: 'Usuário', sortable: true, className: 'data-table__cell--truncate' },
      { key: 'uploads', label: 'Uploads', sortable: true, format: (v) => formatNumber(v) },
      { key: 'modifications', label: 'Modificações', sortable: true, format: (v) => formatNumber(v) },
      { key: 'downloads', label: 'Downloads', sortable: true, format: (v) => formatNumber(v) },
      { key: 'total_activity', label: 'Total', sortable: true, format: (v) => formatNumber(v) },
    ],
    loading: true,
    pageSize: 10,
    searchable: true,
  });
  container.appendChild(table);

  const load = async () => {
    try {
      const data = await dashboardService.getUserActivityMetrics(10);
      const rows = (Array.isArray(data) ? data : []).map(row => ({
        ...row,
        usuario: row.usuario_nome || row.usuario_login || '-',
      }));
      table.update({ data: rows, loading: false });
    } catch {
      table.update({ data: [], loading: false });
    }
  };

  await load();
  return { refresh: load };
}
