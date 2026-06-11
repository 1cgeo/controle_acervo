import { el } from '@utils/dom.js';
import { createTabs } from '@components/tabs.js';
import { createExportBar } from '@components/export-bar.js';
import { clearCache } from '@services/cache.js';
import { renderOverviewTab } from '@features/dashboard/overview-tab.js';
import { renderDistributionTab } from '@features/dashboard/distribution-tab.js';
import { renderActivityTab } from '@features/dashboard/activity-tab.js';
import { renderAdvancedTab } from '@features/dashboard/advanced-tab.js';

const REFRESH_INTERVAL_MS = 60 * 1000;

/**
 * Render the Dashboard page (auto-refetch of the active tab every 60s).
 * @param {HTMLElement} container
 * @returns {Function} cleanup
 */
export async function renderDashboard(container) {
  const header = el('div', { className: 'dashboard__header' }, [
    el('h1', { className: 'dashboard__title', textContent: 'Dashboard' }),
    createExportBar(),
  ]);

  const tabs = createTabs({
    tabs: [
      { id: 'overview', label: 'Visão Geral', render: renderOverviewTab },
      { id: 'distribution', label: 'Distribuição', render: renderDistributionTab },
      { id: 'activity', label: 'Atividade', render: renderActivityTab },
      { id: 'advanced', label: 'Análises Avançadas', render: renderAdvancedTab },
    ],
  });

  const page = el('div', { className: 'dashboard' }, [header, tabs.element]);
  container.appendChild(page);

  // Auto-refetch the active tab every 60s (drop the cache first so the
  // service layer hits the API instead of returning stale entries)
  const intervalId = setInterval(() => {
    clearCache();
    tabs.refreshActive();
  }, REFRESH_INTERVAL_MS);

  return () => {
    clearInterval(intervalId);
    if (tabs.element._cleanup) tabs.element._cleanup();
  };
}
