import { el, svgIcon, ICONS } from '@utils/dom.js';
import { formatNumber } from '@utils/format.js';
import { createStatsCard } from '@components/stats-card.js';
import * as dashboardService from '@services/dashboard-service.js';

/**
 * Build the system health alert panel.
 */
function createAlertPanel(healthData) {
  const alerts = [];

  // Volume capacity alerts
  if (healthData.volumes_alertas && healthData.volumes_alertas.length > 0) {
    for (const vol of healthData.volumes_alertas) {
      const pct = Number(vol.percentual_uso);
      const severity = pct > 90 ? 'error' : 'warning';
      const fillClass = `progress-bar__fill--${severity}`;

      const progressBar = el('div', { className: 'progress-bar' }, [
        el('div', {
          className: `progress-bar__fill ${fillClass}`,
          style: { width: `${Math.min(pct, 100)}%` },
        }),
      ]);

      alerts.push(
        el('div', { className: `alert-panel__item alert-panel__item--${severity}` }, [
          svgIcon(ICONS.warning, 18),
          el('span', { className: 'alert-panel__item-text', textContent: `Volume "${vol.nome}" em ${pct}% da capacidade` }),
          progressBar,
        ])
      );
    }
  }

  // File error alerts
  const erros = healthData.erros_arquivo || {};
  const totalErros = (erros.erros_carregamento || 0) + (erros.erros_exclusao || 0);
  if (totalErros > 0) {
    let desc = `${totalErros} arquivo(s) com erro`;
    const parts = [];
    if (erros.erros_carregamento > 0) parts.push(`${erros.erros_carregamento} de carregamento`);
    if (erros.erros_exclusao > 0) parts.push(`${erros.erros_exclusao} de exclusao`);
    if (parts.length) desc += ` (${parts.join(', ')})`;

    alerts.push(
      el('div', { className: 'alert-panel__item alert-panel__item--error' }, [
        svgIcon(ICONS.warning, 18),
        el('span', { className: 'alert-panel__item-text', textContent: desc }),
      ])
    );
  }

  // Active upload sessions
  if (healthData.sessoes_upload_ativas > 0) {
    alerts.push(
      el('div', { className: 'alert-panel__item alert-panel__item--warning' }, [
        svgIcon(ICONS.warning, 18),
        el('span', {
          className: 'alert-panel__item-text',
          textContent: `${healthData.sessoes_upload_ativas} sessao(oes) de upload ativa(s)`,
        }),
      ])
    );
  }

  // No alerts
  if (alerts.length === 0) {
    alerts.push(
      el('div', { className: 'alert-panel__item alert-panel__item--success' }, [
        svgIcon(ICONS.checkCircle, 18),
        el('span', { className: 'alert-panel__item-text', textContent: 'Nenhum alerta - sistema saudavel' }),
      ])
    );
  }

  return el('div', { className: 'alert-panel' }, [
    el('div', { className: 'alert-panel__title' }, [
      svgIcon(ICONS.warning, 20),
      'Alertas do Sistema',
    ]),
    el('div', { className: 'alert-panel__list' }, alerts),
  ]);
}

/**
 * Render the "Visao Geral" tab.
 * @param {HTMLElement} container
 * @returns {Function|void} cleanup
 */
export async function renderOverviewTab(container) {
  const cards = [
    createStatsCard({
      title: 'Total de Produtos',
      value: '-',
      icon: svgIcon(ICONS.storage, 24),
      color: 'primary',
      loading: true,
    }),
    createStatsCard({
      title: 'Armazenamento Total',
      value: '-',
      icon: svgIcon(ICONS.dataUsage, 24),
      color: 'warning',
      loading: true,
      suffix: 'GB',
    }),
    createStatsCard({
      title: 'Total de Usuarios',
      value: '-',
      icon: svgIcon(ICONS.people, 24),
      color: 'success',
      loading: true,
    }),
    createStatsCard({
      title: 'Total de Projetos',
      value: '-',
      icon: svgIcon(ICONS.assignment, 24),
      color: 'info',
      loading: true,
    }),
    createStatsCard({
      title: 'Total de Versoes',
      value: '-',
      icon: svgIcon(ICONS.layers, 24),
      color: 'info',
      loading: true,
    }),
    createStatsCard({
      title: 'Downloads (24h)',
      value: '-',
      icon: svgIcon(ICONS.download, 24),
      color: 'info',
      loading: true,
    }),
  ];

  const grid = el('div', { className: 'stats-grid' }, cards);
  container.appendChild(grid);

  // Placeholder for alerts panel
  const alertContainer = el('div');
  container.appendChild(alertContainer);

  // Fetch data in parallel
  const [produtosResult, armazenamentoResult, usuariosResult, healthResult] = await Promise.allSettled([
    dashboardService.getProdutosTotal(),
    dashboardService.getArquivosTotalGb(),
    dashboardService.getUsuariosTotal(),
    dashboardService.getSystemHealth(),
  ]);

  if (produtosResult.status === 'fulfilled') {
    const data = produtosResult.value;
    cards[0].update({ value: formatNumber(data?.total_produtos ?? 0), loading: false });
  } else {
    cards[0].update({ value: 'Erro', loading: false });
  }

  if (armazenamentoResult.status === 'fulfilled') {
    const data = armazenamentoResult.value;
    cards[1].update({
      value: Number(data?.total_gb ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      loading: false,
      suffix: 'GB',
    });
  } else {
    cards[1].update({ value: 'Erro', loading: false });
  }

  if (usuariosResult.status === 'fulfilled') {
    const data = usuariosResult.value;
    cards[2].update({ value: formatNumber(data?.total_usuarios ?? 0), loading: false });
  } else {
    cards[2].update({ value: 'Erro', loading: false });
  }

  if (healthResult.status === 'fulfilled') {
    const health = healthResult.value;
    cards[3].update({ value: formatNumber(health?.total_projetos ?? 0), loading: false });
    cards[4].update({ value: formatNumber(health?.total_versoes ?? 0), loading: false });
    cards[5].update({ value: formatNumber(health?.downloads_24h ?? 0), loading: false });

    // Render alert panel
    alertContainer.appendChild(createAlertPanel(health));
  } else {
    cards[3].update({ value: 'Erro', loading: false });
    cards[4].update({ value: 'Erro', loading: false });
    cards[5].update({ value: 'Erro', loading: false });
  }
}
