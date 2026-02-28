import { el, svgIcon, ICONS } from '@utils/dom.js';

const MENU_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: ICONS.dashboard, path: '/dashboard' },
  { id: 'volumes', label: 'Volumes', icon: ICONS.storage, path: '/volumes', adminOnly: true },
];

/**
 * Create the sidebar element.
 * @param {Object} options
 * @param {boolean} options.collapsed
 * @returns {{ sidebar: HTMLElement, overlay: HTMLElement, setActive: Function, toggle: Function, setMobileOpen: Function }}
 */
export function createSidebar({ collapsed = false }) {
  let isCollapsed = collapsed;
  let isMobileOpen = false;

  const nav = el('nav', { className: 'sidebar__nav' });

  const sidebar = el('aside', {
    className: `sidebar${isCollapsed ? ' sidebar--collapsed' : ''}`,
  }, [nav]);

  const overlay = el('div', {
    className: 'sidebar-overlay',
    onClick: () => setMobileOpen(false),
  });

  // Render menu items
  const itemElements = {};
  for (const item of MENU_ITEMS) {
    const icon = el('span', { className: 'sidebar__item-icon' }, [svgIcon(item.icon, 24)]);
    const label = el('span', { className: 'sidebar__item-label', textContent: item.label });

    const menuItem = el('a', {
      className: 'sidebar__item',
      href: `#${item.path}`,
      dataset: { id: item.id },
      onClick: () => {
        setMobileOpen(false);
      },
    }, [icon, label]);

    itemElements[item.id] = menuItem;
    nav.appendChild(menuItem);
  }

  function setActive(activeId) {
    for (const [id, itemEl] of Object.entries(itemElements)) {
      itemEl.classList.toggle('sidebar__item--active', id === activeId);
    }
  }

  function toggle() {
    isCollapsed = !isCollapsed;
    sidebar.classList.toggle('sidebar--collapsed', isCollapsed);
    return isCollapsed;
  }

  function setMobileOpen(open) {
    isMobileOpen = open;
    sidebar.classList.toggle('sidebar--mobile-open', isMobileOpen);
    overlay.classList.toggle('sidebar-overlay--visible', isMobileOpen);
  }

  function isCurrentlyCollapsed() {
    return isCollapsed;
  }

  // Set initial active based on hash
  const currentPath = location.hash.slice(1) || '/dashboard';
  const activeItem = MENU_ITEMS.find(i => currentPath.startsWith(i.path));
  if (activeItem) setActive(activeItem.id);

  return { sidebar, overlay, setActive, toggle, setMobileOpen, isCurrentlyCollapsed };
}
