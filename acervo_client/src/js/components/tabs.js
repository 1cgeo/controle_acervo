import { el, clearChildren } from '@utils/dom.js';

/**
 * Create a tabbed interface.
 * @param {Object} options
 * @param {Array<{id: string, label: string, render: Function}>} options.tabs
 * @param {string} [options.activeId] - Initial active tab ID
 * @param {string} [options.className] - CSS class for the tab bar ('tabs' or 'sub-tabs')
 * @returns {{ element: HTMLElement, setActive: Function, getActive: Function }}
 */
export function createTabs({ tabs, activeId = null, className = 'tabs' }) {
  let currentId = activeId || tabs[0]?.id;
  let currentCleanup = null;

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

    currentId = id;

    // Update tab button styles
    for (const [tabId, btn] of Object.entries(tabButtons)) {
      btn.classList.toggle(`${className}__item--active`, tabId === id);
    }

    // Render content
    clearChildren(content);
    const tab = tabs.find(t => t.id === id);
    if (tab && tab.render) {
      currentCleanup = await tab.render(content);
    }
  }

  function getActive() {
    return currentId;
  }

  const element = el('div', {}, [tabBar, content]);

  // Render initial tab
  setActive(currentId);

  element._cleanup = () => {
    if (currentCleanup) currentCleanup();
  };

  return { element, setActive, getActive };
}
