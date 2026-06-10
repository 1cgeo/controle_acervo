import { el } from '@utils/dom.js';
import { createBarChart } from '@components/charts/bar-chart.js';
import { createPieChart } from '@components/charts/pie-chart.js';
import { createDataTable } from '@components/data-table.js';
import { createTabs } from '@components/tabs.js';
import { formatDateTime, formatNumber } from '@utils/format.js';
import * as dashboardService from '@services/dashboard-service.js';

/**
 * Build a sub-tab render function for a data table fed by a service call.
 * Returns { refresh } so the dashboard auto-refresh can re-fetch in place.
 */
function tableTab({ tables, key, columns, getData, mapData = null }) {
  return async (content) => {
    tables[key] = createDataTable({ columns, loading: true, pageSize: 5, searchable: true });
    content.appendChild(tables[key]);

    const load = async () => {
      try {
        const data = await getData();
        const rows = Array.isArray(data) ? data : [];
        tables[key].update({ data: mapData ? rows.map(mapData) : rows, loading: false });
      } catch {
        tables[key].update({ data: [], loading: false });
      }
    };

    await load();
    return { refresh: load };
  };
}

/**
 * Render the "Atividade" tab.
 * @param {HTMLElement} container
 * @returns {{cleanup: Function, refresh: Function}}
 */
export async function renderActivityTab(container) {
  let disposed = false;

  // Daily activity chart
  const dailyChart = createBarChart({
    title: 'Atividade Diária (Últimos 30 Dias)',
    xKey: 'dia',
    series: [
      { dataKey: 'uploads', label: 'Uploads', color: '#4caf50' },
      { dataKey: 'downloads', label: 'Downloads', color: '#2196f3' },
    ],
    loading: true,
  });

  container.appendChild(dailyChart);

  // Column definitions
  const fileColumns = [
    { key: 'nome', label: 'Nome', sortable: true, className: 'data-table__cell--truncate' },
    { key: 'tamanho_mb', label: 'Tamanho (MB)', sortable: true, format: (v) => v != null ? Number(v).toFixed(2) : '-' },
    { key: 'extensao', label: 'Tipo', format: (v) => v ? v.toUpperCase() : '-' },
    { key: 'data', label: 'Data', sortable: true, format: (v) => formatDateTime(v) },
  ];

  const deleteColumns = [
    { key: 'nome', label: 'Nome', sortable: true, className: 'data-table__cell--truncate' },
    { key: 'tamanho_mb', label: 'Tamanho (MB)', sortable: true, format: (v) => v != null ? Number(v).toFixed(2) : '-' },
    { key: 'extensao', label: 'Tipo', format: (v) => v ? v.toUpperCase() : '-' },
    { key: 'data_delete', label: 'Data', sortable: true, format: (v) => formatDateTime(v) },
    {
      key: 'motivo_exclusao', label: 'Motivo',
      className: 'data-table__cell--truncate',
      format: (v) => v || '-',
    },
  ];

  const downloadColumns = [
    { key: 'id', label: 'ID', sortable: true },
    { key: 'arquivo_id', label: 'Arquivo ID' },
    { key: 'data_download', label: 'Data Download', sortable: true, format: (v) => formatDateTime(v) },
    {
      key: 'apagado', label: 'Status',
      format: (v, row) => {
        const isAvailable = !row.apagado;
        return el('span', {
          className: `chip chip--${isAvailable ? 'success' : 'error'}`,
          textContent: isAvailable ? 'Disponível' : 'Arquivo Excluído',
        });
      },
    },
  ];

  const productColumns = [
    { key: 'nome', label: 'Nome', sortable: true, className: 'data-table__cell--truncate' },
    { key: 'mi', label: 'MI', sortable: true },
    { key: 'tipo_produto', label: 'Tipo' },
    { key: 'tipo_escala', label: 'Escala' },
    { key: 'total_versoes', label: 'Versões', sortable: true, format: (v) => formatNumber(v) },
    { key: 'data_cadastramento', label: 'Data Cadastro', sortable: true, format: (v) => formatDateTime(v) },
  ];

  const versionColumns = [
    { key: 'versao', label: 'Versão', sortable: true },
    { key: 'produto_nome', label: 'Produto', sortable: true, className: 'data-table__cell--truncate' },
    { key: 'mi', label: 'MI' },
    { key: 'tipo_versao', label: 'Tipo' },
    { key: 'orgao_produtor', label: 'Órgão Produtor', className: 'data-table__cell--truncate' },
    { key: 'total_arquivos', label: 'Arquivos', sortable: true, format: (v) => formatNumber(v) },
    { key: 'data_criacao', label: 'Data Criação', sortable: true, format: (v) => formatDateTime(v) },
  ];

  // Tables state
  const tables = {};

  const tabsComponent = createTabs({
    className: 'sub-tabs',
    tabs: [
      {
        id: 'produtos',
        label: 'Produtos Recentes',
        render: tableTab({
          tables,
          key: 'produtos',
          columns: productColumns,
          getData: () => dashboardService.getUltimosProdutos(),
        }),
      },
      {
        id: 'versoes',
        label: 'Versões Recentes',
        render: tableTab({
          tables,
          key: 'versoes',
          columns: versionColumns,
          getData: () => dashboardService.getUltimasVersoes(),
        }),
      },
      {
        id: 'uploads',
        label: 'Uploads Recentes',
        render: tableTab({
          tables,
          key: 'uploads',
          columns: fileColumns,
          getData: () => dashboardService.getUltimosCarregamentos(),
          mapData: (d) => ({ ...d, data: d.data_cadastramento }),
        }),
      },
      {
        id: 'modificacoes',
        label: 'Modificações Recentes',
        render: tableTab({
          tables,
          key: 'modificacoes',
          columns: fileColumns,
          getData: () => dashboardService.getUltimasModificacoes(),
          mapData: (d) => ({ ...d, data: d.data_modificacao || d.data_cadastramento }),
        }),
      },
      {
        id: 'exclusoes',
        label: 'Exclusões Recentes',
        render: tableTab({
          tables,
          key: 'exclusoes',
          columns: deleteColumns,
          getData: () => dashboardService.getUltimosDeletes(),
        }),
      },
      {
        id: 'downloads',
        label: 'Histórico de Downloads',
        render: tableTab({
          tables,
          key: 'downloads',
          columns: downloadColumns,
          getData: () => dashboardService.getDownloads(),
        }),
      },
      {
        id: 'carregamento',
        label: 'Situação de Carregamento',
        render: async (content) => {
          const chart = createPieChart({ title: 'Distribuição por Situação de Carregamento', loading: true });
          content.appendChild(chart);

          const load = async () => {
            try {
              const data = await dashboardService.getSituacaoCarregamento();
              chart.update({
                data: (Array.isArray(data) ? data : []).map(d => ({
                  label: d.situacao,
                  value: Number(d.quantidade),
                })),
                loading: false,
              });
            } catch {
              chart.update({ data: [], loading: false });
            }
          };

          await load();
          return {
            cleanup: () => { if (chart._cleanup) chart._cleanup(); },
            refresh: load,
          };
        },
      },
    ],
  });

  container.appendChild(tabsComponent.element);

  async function loadDaily() {
    // Fetch daily activity data
    const [arquivosResult, downloadsResult] = await Promise.allSettled([
      dashboardService.getArquivosDia(),
      dashboardService.getDownloadsDia(),
    ]);
    if (disposed) return;

    // Build 30-day map
    const dailyMap = {};
    const today = new Date();
    for (let i = 29; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().split('T')[0];
      dailyMap[key] = { dia: key.slice(5), uploads: 0, downloads: 0 };
    }

    if (arquivosResult.status === 'fulfilled' && Array.isArray(arquivosResult.value)) {
      for (const item of arquivosResult.value) {
        const key = item.dia?.split('T')[0];
        if (key && dailyMap[key]) dailyMap[key].uploads = Number(item.quantidade);
      }
    }

    if (downloadsResult.status === 'fulfilled' && Array.isArray(downloadsResult.value)) {
      for (const item of downloadsResult.value) {
        const key = item.dia?.split('T')[0];
        if (key && dailyMap[key]) dailyMap[key].downloads = Number(item.quantidade);
      }
    }

    dailyChart.update({ data: Object.values(dailyMap), loading: false });
  }

  await loadDaily();

  return {
    cleanup: () => {
      disposed = true;
      if (dailyChart._cleanup) dailyChart._cleanup();
      if (tabsComponent.element._cleanup) tabsComponent.element._cleanup();
    },
    refresh: async () => {
      await Promise.all([loadDaily(), tabsComponent.refreshActive()]);
    },
  };
}
