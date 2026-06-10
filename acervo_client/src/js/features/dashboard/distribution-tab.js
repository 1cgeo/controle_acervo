import { el } from '@utils/dom.js';
import { createPieChart } from '@components/charts/pie-chart.js';
import { createBarChart } from '@components/charts/bar-chart.js';
import * as dashboardService from '@services/dashboard-service.js';

/**
 * Render the "Distribuicao" tab.
 * @param {HTMLElement} container
 * @returns {Function|void} cleanup
 */
export async function renderDistributionTab(container) {
  const style = getComputedStyle(document.documentElement);

  // Create all charts with loading state
  const pieByType = createPieChart({
    title: 'Produtos por Tipo',
    loading: true,
  });

  const pieByScale = createPieChart({
    title: 'Produtos por Escala',
    loading: true,
  });

  const barStorageByType = createBarChart({
    title: 'Armazenamento por Tipo de Produto',
    xKey: 'tipo_produto',
    series: [{ dataKey: 'total_gb', label: 'GB', color: style.getPropertyValue('--chart-1').trim() }],
    loading: true,
  });

  const barFilesByType = createBarChart({
    title: 'Arquivos por Tipo de Arquivo',
    xKey: 'tipo_arquivo',
    series: [
      { dataKey: 'total_gb', label: 'GB', color: style.getPropertyValue('--chart-1').trim() },
      { dataKey: 'quantidade', label: 'Quantidade', color: style.getPropertyValue('--chart-2').trim() },
    ],
    loading: true,
  });

  const volumeChart = createBarChart({
    title: 'Armazenamento por Volume',
    xKey: 'nome_volume',
    series: [
      { dataKey: 'total_gb', label: 'Usado (GB)', color: style.getPropertyValue('--chart-1').trim() },
      { dataKey: 'available_gb', label: 'Disponivel (GB)', color: style.getPropertyValue('--chart-2').trim() },
    ],
    stacked: true,
    loading: true,
  });

  // Layout: 2 rows of 2 + 1 full-width
  const row1 = el('div', { className: 'dashboard-grid dashboard-grid--2col' }, [pieByType, pieByScale]);
  const row2 = el('div', { className: 'dashboard-grid dashboard-grid--2col' }, [barStorageByType, barFilesByType]);

  container.appendChild(row1);
  container.appendChild(row2);
  container.appendChild(volumeChart);

  // Fetch all data in parallel
  const [tipoResult, escalaResult, gbTipoResult, fileTypeResult, gbVolumeResult] = await Promise.allSettled([
    dashboardService.getProdutosTipo(),
    dashboardService.getProdutosEscala(),
    dashboardService.getGbTipoProduto(),
    dashboardService.getArquivosTipoArquivo(),
    dashboardService.getGbVolume(),
  ]);

  // Products by type (pie)
  if (tipoResult.status === 'fulfilled' && Array.isArray(tipoResult.value)) {
    pieByType.update({
      data: tipoResult.value.map(d => ({
        label: d.tipo_produto,
        value: Number(d.quantidade),
      })),
      loading: false,
    });
  } else {
    pieByType.update({ data: [], loading: false });
  }

  // Products by scale (pie)
  if (escalaResult.status === 'fulfilled' && Array.isArray(escalaResult.value)) {
    pieByScale.update({
      data: escalaResult.value.map(d => ({
        label: d.tipo_escala,
        value: Number(d.quantidade),
      })),
      loading: false,
    });
  } else {
    pieByScale.update({ data: [], loading: false });
  }

  // Storage by product type (bar)
  if (gbTipoResult.status === 'fulfilled' && Array.isArray(gbTipoResult.value)) {
    barStorageByType.update({
      data: gbTipoResult.value,
      loading: false,
    });
  } else {
    barStorageByType.update({ data: [], loading: false });
  }

  // Files by file type (bar)
  if (fileTypeResult.status === 'fulfilled' && Array.isArray(fileTypeResult.value)) {
    barFilesByType.update({
      data: fileTypeResult.value.map(d => ({
        ...d,
        total_gb: Number(d.total_gb),
        quantidade: Number(d.quantidade),
      })),
      loading: false,
    });
  } else {
    barFilesByType.update({ data: [], loading: false });
  }

  // Storage by volume (stacked bar)
  if (gbVolumeResult.status === 'fulfilled' && Array.isArray(gbVolumeResult.value)) {
    const volumeData = gbVolumeResult.value.map(d => ({
      ...d,
      nome_volume: d.nome_volume || d.volume,
      total_gb: Number(d.total_gb),
      available_gb: Math.max(0, Number(d.capacidade_gb_volume || 0) - Number(d.total_gb)),
    }));
    volumeChart.update({ data: volumeData, loading: false });
  } else {
    volumeChart.update({ data: [], loading: false });
  }

  return () => {
    if (pieByType._cleanup) pieByType._cleanup();
    if (pieByScale._cleanup) pieByScale._cleanup();
    if (barStorageByType._cleanup) barStorageByType._cleanup();
    if (barFilesByType._cleanup) barFilesByType._cleanup();
    if (volumeChart._cleanup) volumeChart._cleanup();
  };
}
