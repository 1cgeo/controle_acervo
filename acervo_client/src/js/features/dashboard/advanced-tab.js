import { el } from '@utils/dom.js';
import { createBarChart } from '@components/charts/bar-chart.js';
import { createPieChart } from '@components/charts/pie-chart.js';
import { createTabs } from '@components/tabs.js';
import { formatNumber, formatMonth } from '@utils/format.js';
import * as dashboardService from '@services/dashboard-service.js';

/**
 * Render the "Analises Avancadas" tab.
 * @param {HTMLElement} container
 * @returns {Function} cleanup
 */
export async function renderAdvancedTab(container) {
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

  async function loadTimeline(months) {
    timelineChart.update({ loading: true });
    try {
      const data = await dashboardService.getProdutoActivityTimeline(months);
      const formatted = (Array.isArray(data) ? data : []).map(d => ({
        ...d,
        month_label: formatMonth(d.month),
      }));
      timelineChart.update({ data: formatted, loading: false });
    } catch {
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
      { dataKey: 'novas_versoes', label: 'Novas Versoes', color: '#4caf50' },
      { dataKey: 'acumulado', label: 'Acumulado', color: '#2196f3' },
    ],
    loading: true,
  });
  cleanups.push(() => { if (versionTimelineChart._cleanup) versionTimelineChart._cleanup(); });

  const versionTimelineHeader = el('div', { className: 'chart-card__header' }, [
    el('div', { className: 'chart-card__title', textContent: 'Timeline de Versoes Cadastradas' }),
    versionTimelineSelect,
  ]);
  versionTimelineChart.querySelector('.chart-card__title')?.remove();
  versionTimelineChart.prepend(versionTimelineHeader);

  async function loadVersionTimeline(months) {
    versionTimelineChart.update({ loading: true });
    try {
      const data = await dashboardService.getVersaoActivityTimeline(months);
      const formatted = (Array.isArray(data) ? data : []).map(d => ({
        ...d,
        month_label: formatMonth(d.month),
        novas_versoes: Number(d.novas_versoes),
        acumulado: Number(d.acumulado),
      }));
      versionTimelineChart.update({ data: formatted, loading: false });
    } catch {
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
      { id: 'versions', label: 'Estatisticas de Versoes', render: renderVersionStats },
      { id: 'storage', label: 'Tendencias de Armazenamento', render: renderStorageTrends },
      { id: 'projects', label: 'Status de Projetos', render: renderProjectStatus },
      { id: 'users', label: 'Atividade de Usuarios', render: renderUserActivity },
    ],
  });
  cleanups.push(() => { if (subTabs.element._cleanup) subTabs.element._cleanup(); });

  container.appendChild(subTabs.element);

  return () => cleanups.forEach(fn => fn());
}

async function renderVersionStats(container) {
  const cleanups = [];

  // Summary cards placeholder
  const summaryGrid = el('div', { className: 'summary-cards' });
  container.appendChild(summaryGrid);

  // Pie charts
  const distPie = createPieChart({ title: 'Distribuicao de Versoes por Produto', loading: true });
  const typePie = createPieChart({ title: 'Tipos de Versao', loading: true });
  cleanups.push(() => { if (distPie._cleanup) distPie._cleanup(); });
  cleanups.push(() => { if (typePie._cleanup) typePie._cleanup(); });

  const chartsGrid = el('div', { className: 'dashboard-grid dashboard-grid--2col' }, [distPie, typePie]);
  container.appendChild(chartsGrid);

  try {
    const data = await dashboardService.getVersionStatistics();
    const stats = data?.stats || {};

    const cards = [
      { label: 'Total de Versoes', value: formatNumber(stats.total_versions) },
      { label: 'Produtos com Versoes', value: formatNumber(stats.products_with_versions) },
      { label: 'Media por Produto', value: Number(stats.avg_versions_per_product || 0).toFixed(1) },
      { label: 'Maximo por Produto', value: formatNumber(stats.max_versions_per_product) },
    ];

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
          label: `${d.versions_per_product} versoes`,
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
    distPie.update({ data: [], loading: false });
    typePie.update({ data: [], loading: false });
  }

  return () => cleanups.forEach(fn => fn());
}

async function renderStorageTrends(container) {
  const cleanups = [];

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
  cleanups.push(() => { if (chart._cleanup) chart._cleanup(); });

  const header = el('div', { className: 'chart-card__header' }, [
    el('div', { className: 'chart-card__title', textContent: 'Tendencias de Armazenamento' }),
    periodSelect,
  ]);
  chart.querySelector('.chart-card__title')?.remove();
  chart.prepend(header);

  async function loadData(months) {
    chart.update({ loading: true });
    try {
      const data = await dashboardService.getStorageGrowthTrends(months);
      const formatted = (Array.isArray(data) ? data : []).map(d => ({
        ...d,
        month_label: formatMonth(d.month),
        gb_added: Number(d.gb_added),
        cumulative_gb: Number(d.cumulative_gb),
      }));
      chart.update({ data: formatted, loading: false });
    } catch {
      chart.update({ data: [], loading: false });
    }
  }

  periodSelect.addEventListener('change', () => loadData(parseInt(periodSelect.value)));
  loadData(6);

  container.appendChild(chart);

  return () => cleanups.forEach(fn => fn());
}

async function renderProjectStatus(container) {
  const cleanups = [];

  const summaryGrid = el('div', { className: 'summary-cards' });
  container.appendChild(summaryGrid);

  const projectPie = createPieChart({ title: 'Status dos Projetos', loading: true });
  const lotPie = createPieChart({ title: 'Status dos Lotes', loading: true });
  cleanups.push(() => { if (projectPie._cleanup) projectPie._cleanup(); });
  cleanups.push(() => { if (lotPie._cleanup) lotPie._cleanup(); });

  const chartsGrid = el('div', { className: 'dashboard-grid dashboard-grid--2col' }, [projectPie, lotPie]);
  container.appendChild(chartsGrid);

  try {
    const data = await dashboardService.getProjectStatusSummary();

    // Projects without lots card
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
    projectPie.update({ data: [], loading: false });
    lotPie.update({ data: [], loading: false });
  }

  return () => cleanups.forEach(fn => fn());
}

async function renderUserActivity(container) {
  try {
    const data = await dashboardService.getUserActivityMetrics(10);
    const rows = Array.isArray(data) ? data : [];

    // Simple HTML table
    const thead = el('thead', {}, [
      el('tr', {}, [
        el('th', { textContent: 'Usuario' }),
        el('th', { textContent: 'Uploads' }),
        el('th', { textContent: 'Modificacoes' }),
        el('th', { textContent: 'Downloads' }),
        el('th', { textContent: 'Total' }),
      ]),
    ]);

    const tbody = el('tbody', {}, rows.map(row =>
      el('tr', {}, [
        el('td', { textContent: row.usuario_nome || row.usuario_login || '-' }),
        el('td', { textContent: formatNumber(row.uploads) }),
        el('td', { textContent: formatNumber(row.modifications) }),
        el('td', { textContent: formatNumber(row.downloads) }),
        el('td', { textContent: formatNumber(row.total_activity) }),
      ])
    ));

    const table = el('table', { className: 'data-table' }, [thead, tbody]);
    const wrapper = el('div', { className: 'data-table-wrapper' }, [
      el('div', { className: 'data-table-wrapper__header' }, [
        el('div', { className: 'data-table-wrapper__title', textContent: 'Top 10 Usuarios Mais Ativos' }),
      ]),
      el('div', { className: 'data-table-scroll' }, [table]),
    ]);

    container.appendChild(wrapper);

    if (!rows.length) {
      const emptyMsg = el('div', { className: 'data-table__empty', textContent: 'Sem dados disponiveis' });
      wrapper.querySelector('.data-table-scroll').innerHTML = '';
      wrapper.querySelector('.data-table-scroll').appendChild(emptyMsg);
    }
  } catch {
    container.appendChild(el('div', { className: 'data-table__empty', textContent: 'Erro ao carregar dados' }));
  }
}
