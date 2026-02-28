import { el } from '@utils/dom.js';
import { createTabs } from '@components/tabs.js';
import { renderOverviewTab } from '@features/dashboard/overview-tab.js';
import { renderDistributionTab } from '@features/dashboard/distribution-tab.js';
import { renderActivityTab } from '@features/dashboard/activity-tab.js';
import { renderAdvancedTab } from '@features/dashboard/advanced-tab.js';

/**
 * Render the Dashboard page.
 * @param {HTMLElement} container
 * @returns {Function} cleanup
 */
export async function renderDashboard(container) {
  const title = el('h1', { className: 'dashboard__title', textContent: 'Dashboard' });

  const tabs = createTabs({
    tabs: [
      { id: 'overview', label: 'Visao Geral', render: renderOverviewTab },
      { id: 'distribution', label: 'Distribuicao', render: renderDistributionTab },
      { id: 'activity', label: 'Atividade', render: renderActivityTab },
      { id: 'advanced', label: 'Analises Avancadas', render: renderAdvancedTab },
    ],
  });

  const page = el('div', { className: 'dashboard' }, [title, tabs.element]);
  container.appendChild(page);

  return () => {
    if (tabs.element._cleanup) tabs.element._cleanup();
  };
}
