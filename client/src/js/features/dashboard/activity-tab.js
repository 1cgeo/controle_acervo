import { el } from '@utils/dom.js';
import { createBarChart } from '@components/charts/bar-chart.js';
import { createPieChart } from '@components/charts/pie-chart.js';
import { createDataTable } from '@components/data-table.js';
import { createTabs } from '@components/tabs.js';
import { formatDateTime, formatNumber } from '@utils/format.js';
import * as dashboardService from '@services/dashboard-service.js';

/**
 * Render the "Atividade" tab.
 * @param {HTMLElement} container
 * @returns {Function} cleanup
 */
export async function renderActivityTab(container) {
  // Daily activity chart
  const dailyChart = createBarChart({
    title: 'Atividade Diaria (Ultimos 30 Dias)',
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
    { key: 'nome', label: 'Nome', className: 'data-table__cell--truncate' },
    { key: 'tamanho_mb', label: 'Tamanho (MB)', format: (v) => v != null ? Number(v).toFixed(2) : '-' },
    { key: 'extensao', label: 'Tipo', format: (v) => v ? v.toUpperCase() : '-' },
    { key: 'data', label: 'Data', format: (v) => formatDateTime(v) },
  ];

  const deleteColumns = [
    { key: 'nome', label: 'Nome', className: 'data-table__cell--truncate' },
    { key: 'tamanho_mb', label: 'Tamanho (MB)', format: (v) => v != null ? Number(v).toFixed(2) : '-' },
    { key: 'extensao', label: 'Tipo', format: (v) => v ? v.toUpperCase() : '-' },
    { key: 'data_delete', label: 'Data', format: (v) => formatDateTime(v) },
    {
      key: 'motivo_exclusao', label: 'Motivo',
      className: 'data-table__cell--truncate',
      format: (v) => v || '-',
    },
  ];

  const downloadColumns = [
    { key: 'id', label: 'ID' },
    { key: 'arquivo_id', label: 'Arquivo ID' },
    { key: 'data_download', label: 'Data Download', format: (v) => formatDateTime(v) },
    {
      key: 'apagado', label: 'Status',
      format: (v, row) => {
        const isAvailable = !row.apagado;
        return el('span', {
          className: `chip chip--${isAvailable ? 'success' : 'error'}`,
          textContent: isAvailable ? 'Disponivel' : 'Arquivo Excluido',
        });
      },
    },
  ];

  const productColumns = [
    { key: 'nome', label: 'Nome', className: 'data-table__cell--truncate' },
    { key: 'mi', label: 'MI' },
    { key: 'tipo_produto', label: 'Tipo' },
    { key: 'tipo_escala', label: 'Escala' },
    { key: 'total_versoes', label: 'Versoes', format: (v) => formatNumber(v) },
    { key: 'data_cadastramento', label: 'Data Cadastro', format: (v) => formatDateTime(v) },
  ];

  const versionColumns = [
    { key: 'versao', label: 'Versao' },
    { key: 'produto_nome', label: 'Produto', className: 'data-table__cell--truncate' },
    { key: 'mi', label: 'MI' },
    { key: 'tipo_versao', label: 'Tipo' },
    { key: 'orgao_produtor', label: 'Orgao Produtor', className: 'data-table__cell--truncate' },
    { key: 'total_arquivos', label: 'Arquivos', format: (v) => formatNumber(v) },
    { key: 'data_criacao', label: 'Data Criacao', format: (v) => formatDateTime(v) },
  ];

  // Tables state
  const tables = {};

  const tabsComponent = createTabs({
    className: 'sub-tabs',
    tabs: [
      {
        id: 'produtos',
        label: 'Produtos Recentes',
        render: async (content) => {
          tables.produtos = createDataTable({ columns: productColumns, loading: true, pageSize: 5 });
          content.appendChild(tables.produtos);
          try {
            const data = await dashboardService.getUltimosProdutos();
            tables.produtos.update({ data: Array.isArray(data) ? data : [], loading: false });
          } catch {
            tables.produtos.update({ data: [], loading: false });
          }
        },
      },
      {
        id: 'versoes',
        label: 'Versoes Recentes',
        render: async (content) => {
          tables.versoes = createDataTable({ columns: versionColumns, loading: true, pageSize: 5 });
          content.appendChild(tables.versoes);
          try {
            const data = await dashboardService.getUltimasVersoes();
            tables.versoes.update({ data: Array.isArray(data) ? data : [], loading: false });
          } catch {
            tables.versoes.update({ data: [], loading: false });
          }
        },
      },
      {
        id: 'uploads',
        label: 'Uploads Recentes',
        render: async (content) => {
          tables.uploads = createDataTable({ columns: fileColumns, loading: true, pageSize: 5 });
          content.appendChild(tables.uploads);
          try {
            const data = await dashboardService.getUltimosCarregamentos();
            tables.uploads.update({
              data: (Array.isArray(data) ? data : []).map(d => ({
                ...d,
                data: d.data_cadastramento || d.data_carregamento,
              })),
              loading: false,
            });
          } catch {
            tables.uploads.update({ data: [], loading: false });
          }
        },
      },
      {
        id: 'modificacoes',
        label: 'Modificacoes Recentes',
        render: async (content) => {
          tables.modificacoes = createDataTable({ columns: fileColumns, loading: true, pageSize: 5 });
          content.appendChild(tables.modificacoes);
          try {
            const data = await dashboardService.getUltimasModificacoes();
            tables.modificacoes.update({
              data: (Array.isArray(data) ? data : []).map(d => ({
                ...d,
                data: d.data_modificacao || d.data_cadastramento,
              })),
              loading: false,
            });
          } catch {
            tables.modificacoes.update({ data: [], loading: false });
          }
        },
      },
      {
        id: 'exclusoes',
        label: 'Exclusoes Recentes',
        render: async (content) => {
          tables.exclusoes = createDataTable({ columns: deleteColumns, loading: true, pageSize: 5 });
          content.appendChild(tables.exclusoes);
          try {
            const data = await dashboardService.getUltimosDeletes();
            tables.exclusoes.update({ data: Array.isArray(data) ? data : [], loading: false });
          } catch {
            tables.exclusoes.update({ data: [], loading: false });
          }
        },
      },
      {
        id: 'downloads',
        label: 'Historico de Downloads',
        render: async (content) => {
          tables.downloads = createDataTable({ columns: downloadColumns, loading: true, pageSize: 5 });
          content.appendChild(tables.downloads);
          try {
            const data = await dashboardService.getDownloads();
            tables.downloads.update({ data: Array.isArray(data) ? data : [], loading: false });
          } catch {
            tables.downloads.update({ data: [], loading: false });
          }
        },
      },
      {
        id: 'carregamento',
        label: 'Situacao de Carregamento',
        render: async (content) => {
          const chart = createPieChart({ title: 'Distribuicao por Situacao de Carregamento', loading: true });
          content.appendChild(chart);
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
          return () => { if (chart._cleanup) chart._cleanup(); };
        },
      },
    ],
  });

  container.appendChild(tabsComponent.element);

  // Fetch daily activity data
  const [arquivosResult, downloadsResult] = await Promise.allSettled([
    dashboardService.getArquivosDia(),
    dashboardService.getDownloadsDia(),
  ]);

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

  return () => {
    if (dailyChart._cleanup) dailyChart._cleanup();
    if (tabsComponent.element._cleanup) tabsComponent.element._cleanup();
  };
}
