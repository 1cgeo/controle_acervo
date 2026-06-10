import { el, clearChildren } from '@utils/dom.js';

/**
 * Create a tabbed interface.
 * Each tab's render(content) may return a cleanup function or an object
 * { cleanup?, refresh? } — refresh re-fetches the tab's data in place and is
 * triggered via refreshActive() (used by the dashboard auto-refresh).
 * @param {Object} options
 * @param {Array<{id: string, label: string, render: Function}>} options.tabs
 * @param {string} [options.activeId] - Initial active tab ID
 * @param {string} [options.className] - CSS class for the tab bar ('tabs' or 'sub-tabs')
 * @returns {{ element: HTMLElement, setActive: Function, getActive: Function, refreshActive: Function }}
 */
export function createTabs({ tabs, activeId = null, className = 'tabs' }) {
  let currentId = activeId || tabs[0]?.id;
  let currentCleanup = null;
  let currentRefresh = null;

  const tabBar = el('div', { className });
  const content = el('div', { className: 'tabs__content' });

  const tabButtons = {};

  for (const tab of tabs) {
    const btn = el('button', {
      className: `${className}__item${tab.id === currentId ? ` ${className}__item--active` : ''}`,
      textContent: tab.label,
      onClick: () => setActive(tab.id),
    });
    tabButtons[tab.id] = btn;
    tabBar.appendChild(btn);
  }

  async function setActive(id) {
    if (currentCleanup) {
      currentCleanup();
      currentCleanup = null;
    }
    currentRefresh = null;

    currentId = id;

    // Update tab button styles
    for (const [tabId, btn] of Object.entries(tabButtons)) {
      btn.classList.toggle(`${className}__item--active`, tabId === id);
    }

    // Render content
    clearChildren(content);
    const tab = tabs.find(t => t.id === id);
    if (tab && tab.render) {
      const result = await tab.render(content);
      if (typeof result === 'function') {
        currentCleanup = result;
      } else if (result && typeof result === 'object') {
        currentCleanup = typeof result.cleanup === 'function' ? result.cleanup : null;
        currentRefresh = typeof result.refresh === 'function' ? result.refresh : null;
      }
    }
  }

  function getActive() {
    return currentId;
  }

  async function refreshActive() {
    if (currentRefresh) await currentRefresh();
  }

  const element = el('div', {}, [tabBar, content]);

  // Render initial tab
  setActive(currentId);

  element._cleanup = () => {
    if (currentCleanup) currentCleanup();
  };

  return { element, setActive, getActive, refreshActive };
}
