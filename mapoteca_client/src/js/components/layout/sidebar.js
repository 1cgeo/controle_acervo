import { el, svgIcon, ICONS } from '@utils/dom.js';

/**
 * Sidebar menu structure: plain items + the collapsible "Materiais" group.
 * Each item id maps to the first segment of the hash route.
 */
const MENU = [
  { id: 'dashboard', label: 'Dashboard', icon: ICONS.dashboard, path: '/dashboard' },
  { id: 'clientes', label: 'Clientes', icon: ICONS.people, path: '/clientes' },
  { id: 'pedidos', label: 'Pedidos', icon: ICONS.assignment, path: '/pedidos' },
  {
    id: 'materiais-group',
    label: 'Materiais',
    icon: ICONS.layers,
    children: [
      { id: 'materiais', label: 'Tipos de Material', icon: ICONS.category, path: '/materiais' },
      { id: 'estoque', label: 'Estoque', icon: ICONS.storage, path: '/estoque' },
      { id: 'consumo', label: 'Consumo', icon: ICONS.dataUsage, path: '/consumo' },
    ],
  },
  { id: 'plotters', label: 'Plotters', icon: ICONS.print, path: '/plotters' },
  { id: 'relatorios', label: 'Relatórios', icon: ICONS.description, path: '/relatorios' },
  { id: 'rpcmtec', label: 'RPCMTec', icon: ICONS.print, path: '/rpcmtec' },
];

/**
 * Create the sidebar element.
 * @param {Object} options
 * @param {boolean} [options.collapsed]
 * @returns {{sidebar:HTMLElement, overlay:HTMLElement, setActive:(id:string)=>void,
 *   toggle:()=>boolean, setMobileOpen:(open:boolean)=>void, isCurrentlyCollapsed:()=>boolean}}
 */
export function createSidebar({ collapsed = false } = {}) {
  let isCollapsed = collapsed;
  let isMobileOpen = false;

  const nav = el('nav', { className: 'sidebar__nav', 'aria-label': 'Menu principal' });

  const sidebar = el('aside', {
    className: `sidebar${isCollapsed ? ' sidebar--collapsed' : ''}`,
  }, [nav]);

  const overlay = el('div', {
    className: 'sidebar-overlay',
    onClick: () => setMobileOpen(false),
  });

  const itemElements = {};
  const groupElements = [];

  function buildItem(item, isSubitem = false) {
    const icon = el('span', { className: 'sidebar__item-icon' }, [svgIcon(item.icon, isSubitem ? 20 : 24)]);
    const label = el('span', { className: 'sidebar__item-label', textContent: item.label });

    const menuItem = el('a', {
      className: `sidebar__item${isSubitem ? ' sidebar__subitem' : ''}`,
      href: `#${item.path}`,
      dataset: { id: item.id },
      onClick: () => setMobileOpen(false),
    }, [icon, label]);

    itemElements[item.id] = menuItem;
    return menuItem;
  }

  for (const item of MENU) {
    if (item.children) {
      const childIds = item.children.map(c => c.id);
      const itemsContainer = el('div', { className: 'sidebar__group-items' },
        item.children.map(child => buildItem(child, true))
      );

      const header = el('button', {
        className: 'sidebar__group-header',
        type: 'button',
        'aria-expanded': 'false',
        onClick: () => {
          const open = group.classList.toggle('sidebar__group--open');
          header.setAttribute('aria-expanded', String(open));
        },
      }, [
        el('span', { className: 'sidebar__item-icon' }, [svgIcon(item.icon, 24)]),
        el('span', { className: 'sidebar__item-label', textContent: item.label }),
        el('span', { className: 'sidebar__group-chevron' }, [svgIcon(ICONS.expandMore, 18)]),
      ]);

      const group = el('div', { className: 'sidebar__group' }, [header, itemsContainer]);
      groupElements.push({ group, header, childIds });
      nav.appendChild(group);
    } else {
      nav.appendChild(buildItem(item));
    }
  }

  /**
   * Highlight the active item (id = first segment of the route).
   * Opens the Materiais group when one of its children is active.
   */
  function setActive(activeId) {
    for (const [id, itemEl] of Object.entries(itemElements)) {
      itemEl.classList.toggle('sidebar__item--active', id === activeId);
    }
    for (const { group, header, childIds } of groupElements) {
      const hasActiveChild = childIds.includes(activeId);
      header.classList.toggle('sidebar__group-header--active', hasActiveChild);
      if (hasActiveChild && !group.classList.contains('sidebar__group--open')) {
        group.classList.add('sidebar__group--open');
        header.setAttribute('aria-expanded', 'true');
      }
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

  return { sidebar, overlay, setActive, toggle, setMobileOpen, isCurrentlyCollapsed };
}

/**
 * Resolve the sidebar item id for a route path (e.g. '/pedidos/3' -> 'pedidos').
 * @param {string} path
 * @returns {string|null}
 */
export function activeIdFromPath(path) {
  const segment = String(path || '').split('?')[0].split('/').filter(Boolean)[0];
  if (!segment) return 'dashboard';
  const known = ['dashboard', 'clientes', 'pedidos', 'materiais', 'estoque', 'consumo', 'plotters', 'relatorios', 'rpcmtec'];
  return known.includes(segment) ? segment : null;
}
