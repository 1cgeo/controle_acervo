import { el, svgIcon, ICONS } from '@utils/dom.js';
import { isAdmin } from '@store/auth-store.js';
import { getModulo } from '@modules/registry.js';

/**
 * Itens de PLATAFORMA, fora de qualquer modulo: valem nos tres.
 * Hoje so a tela unica de usuarios, restrita ao administrador global.
 */
const MENU_PLATAFORMA = [
  { id: 'usuarios', label: 'Usuários', icon: ICONS.people, path: '/usuarios', admin: true },
];

/**
 * Sidebar da interface unica. O menu e o do MODULO ATIVO, mais a secao de
 * plataforma. Trocar de modulo remonta a lista sem recarregar a pagina.
 *
 * @param {Object} options
 * @param {boolean} [options.collapsed]
 * @param {string|null} [options.modulo] - id do modulo ativo
 */
export function createSidebar({ collapsed = false, modulo = null } = {}) {
  let isCollapsed = collapsed;
  let isMobileOpen = false;
  // Sentinela: `null` e um valor VALIDO de modulo (rota de plataforma), entao a
  // primeira montagem nao pode ser confundida com "ja esta neste modulo".
  let moduloAtual;

  const nav = el('nav', { className: 'sidebar__nav', 'aria-label': 'Menu principal' });

  const sidebar = el('aside', {
    className: `sidebar${isCollapsed ? ' sidebar--collapsed' : ''}`,
  }, [nav]);

  const overlay = el('div', {
    className: 'sidebar-overlay',
    onClick: () => setMobileOpen(false),
  });

  let itemElements = {};
  let groupElements = [];
  let idsConhecidos = [];

  function buildItem(item, prefixo, isSubitem = false) {
    const icon = el('span', { className: 'sidebar__item-icon' }, [svgIcon(item.icon, isSubitem ? 20 : 24)]);
    const label = el('span', { className: 'sidebar__item-label', textContent: item.label });

    const menuItem = el('a', {
      className: `sidebar__item${isSubitem ? ' sidebar__subitem' : ''}`,
      href: `#${prefixo}${item.path}`,
      dataset: { id: item.id },
      onClick: () => setMobileOpen(false),
    }, [icon, label]);

    itemElements[item.id] = menuItem;
    idsConhecidos.push(item.id);
    return menuItem;
  }

  function buildMenu(itens, prefixo) {
    for (const item of itens) {
      if (item.admin && !isAdmin()) continue;

      if (item.children) {
        const filhos = item.children.filter(c => !c.admin || isAdmin());
        if (!filhos.length) continue;

        const childIds = filhos.map(c => c.id);
        const itemsContainer = el('div', { className: 'sidebar__group-items' },
          filhos.map(child => buildItem(child, prefixo, true))
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
        nav.appendChild(buildItem(item, prefixo));
      }
    }
  }

  /**
   * Remonta o menu para um modulo. Chamar com o mesmo id nao faz nada.
   * @param {string|null} moduloId
   */
  function setModulo(moduloId) {
    if (moduloId === moduloAtual) return;
    moduloAtual = moduloId;

    nav.innerHTML = '';
    itemElements = {};
    groupElements = [];
    idsConhecidos = [];

    const mod = moduloId ? getModulo(moduloId) : null;
    if (mod && Array.isArray(mod.menu)) {
      buildMenu(mod.menu, `/${mod.id}`);
    }

    const plataforma = MENU_PLATAFORMA.filter(i => !i.admin || isAdmin());
    if (plataforma.length) {
      if (nav.childElementCount) {
        nav.appendChild(el('div', { className: 'sidebar__separator' }));
      }
      buildMenu(plataforma, '');
    }
  }

  /** Marca o item ativo pelo id (ver activeIdFromPath). */
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

  setModulo(modulo);

  return { sidebar, overlay, setModulo, setActive, toggle, setMobileOpen, isCurrentlyCollapsed };
}

/**
 * Resolve o id do item da sidebar a partir de uma rota COMPLETA
 * ('/orcamento/notas_empenho/3' -> 'notas_empenho'; '/usuarios' -> 'usuarios').
 * @param {string} path
 * @returns {string|null}
 */
export function activeIdFromPath(path) {
  const partes = String(path || '').split('?')[0].split('/').filter(Boolean);
  if (!partes.length) return null;

  // Rota de modulo: o primeiro segmento e o modulo, o segundo e o item.
  if (getModulo(partes[0])) {
    return partes[1] || null;
  }
  // Rota de plataforma (ex.: '/usuarios').
  return partes[0];
}
