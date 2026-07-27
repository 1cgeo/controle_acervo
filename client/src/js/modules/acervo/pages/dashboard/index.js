import { el } from '@utils/dom.js';
import { createTabs } from '@components/tabs/tabs.js';
import { createExportBar } from '@components/export-bar/export-bar.js';
import { invalidarDashboard, EXPORTACOES_ACERVO } from '@modules/acervo/services/acervo-service.js';
import { renderOverviewTab } from './overview-tab.js';
import { renderDistributionTab } from './distribution-tab.js';
import { renderActivityTab } from './activity-tab.js';
import { renderAdvancedTab } from './advanced-tab.js';

/** Intervalo do auto-refresh da aba ativa. */
const REFRESH_MS = 60 * 1000;

/**
 * Dashboard do acervo (#/acervo/dashboard): quatro abas e a barra de exportacao.
 *
 * A aba ativa se recarrega sozinha a cada 60 s. O cache do dashboard cai antes,
 * senao o `refresh` devolveria a mesma resposta guardada. So o prefixo
 * 'acervo:dashboard' e invalidado: o cache dos outros modulos fica de pe.
 *
 * @param {HTMLElement} container
 * @param {{params:Object, query:URLSearchParams}} [_ctx]
 * @returns {Promise<Function>} cleanup
 */
export async function renderDashboard(container, _ctx) {
  const abas = createTabs({
    ariaLabel: 'Painéis do acervo',
    tabs: [
      { id: 'overview', label: 'Visão Geral', render: renderOverviewTab },
      { id: 'distribution', label: 'Distribuição', render: renderDistributionTab },
      { id: 'activity', label: 'Atividade', render: renderActivityTab },
      { id: 'advanced', label: 'Análises Avançadas', render: renderAdvancedTab },
    ],
  });

  const page = el('div', { className: 'dashboard' }, [
    el('div', { className: 'dashboard-section__header' }, [
      el('h1', { className: 'dashboard__title', textContent: 'Dashboard do Acervo' }),
      createExportBar({ items: EXPORTACOES_ACERVO }),
    ]),
    abas.element,
  ]);
  container.appendChild(page);

  await abas.ready;

  const intervalo = setInterval(() => {
    invalidarDashboard();
    abas.refreshActive();
  }, REFRESH_MS);

  return () => {
    clearInterval(intervalo);
    abas._cleanup();
  };
}
