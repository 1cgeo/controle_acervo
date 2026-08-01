import { el, svgIcon, ICONS } from '@utils/dom.js';
import { isAdmin, nomeModulo } from '@store/auth-store.js';
import { getModulo, modulosAcessiveis, rotaInicial, podeAbrirRota } from '@modules/registry.js';

/**
 * Itens de PLATAFORMA, fora de qualquer modulo: valem nos tres.
 *
 * `admin: true` esconde o item de quem nao e administrador global. As Metas do
 * PIT NAO levam a marca: qualquer pessoa logada le o plano anual da Divisao, e o
 * backend cobra o administrador so na escrita. Elas moraram dentro do modulo
 * orcamento ate 2026-07-31, e era justamente isso que impedia quem so tem perfil
 * na mapoteca de ver a lista.
 */
const MENU_PLATAFORMA = [
  { id: 'metas', label: 'Metas do PIT', icon: ICONS.category, path: '/metas' },
  // O RPCMTec LEVA a marca de administrador: ele cruza os tres modulos numa
  // peca so, com valor de credito e de empenho dentro. Esteve partido em dois
  // itens de modulo ate 2026-08-01, um na mapoteca e outro no orcamento.
  { id: 'rpcmtec', label: 'RPCMTec', icon: ICONS.print, path: '/rpcmtec', admin: true },
  { id: 'usuarios', label: 'Usuários', icon: ICONS.people, path: '/usuarios', admin: true },
];

/** Icone de cada modulo, quando o manifesto nao declara um. */
const ICONE_PADRAO_MODULO = ICONS.layers;

/**
 * Sidebar da interface unica.
 *
 * A sidebar lista TODOS os modulos que a pessoa acessa, cada um como uma seção
 * colapsavel, mais a seção de plataforma no fim. Ela e montada UMA vez e nunca
 * se desmonta: navegar para uma rota de plataforma (ex.: #/usuarios) abre a
 * tela sem apagar os modulos, que era o defeito do desenho anterior, onde
 * `setModulo(null)` limpava o menu inteiro.
 *
 * Trocar de modulo tambem se faz por aqui: cada cabecalho de modulo e um link
 * para a home daquele modulo. O seletor da navbar deixou de existir.
 *
 * @param {Object} options
 * @param {boolean} [options.collapsed]
 * @param {string|null} [options.modulo] - id do modulo ativo
 */
export function createSidebar({ collapsed = false, modulo = null } = {}) {
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

  // Chave dos itens: `<modulo>:<item>` nos modulos e `<item>` na plataforma.
  // Sem o prefixo, o `dashboard` dos tres modulos colidiria num mapa so.
  const itemElements = {};
  // Grupos DENTRO de um modulo (ex.: "Materiais" na mapoteca).
  const groupElements = [];
  // Uma entrada por modulo, para abrir e fechar a seção.
  const moduleSections = [];

  function buildItem(item, prefixo, chavePrefixo, isSubitem = false) {
    const icon = el('span', { className: 'sidebar__item-icon' }, [svgIcon(item.icon, isSubitem ? 20 : 24)]);
    const label = el('span', { className: 'sidebar__item-label', textContent: item.label });

    const chave = chavePrefixo ? `${chavePrefixo}:${item.id}` : item.id;

    const menuItem = el('a', {
      className: `sidebar__item${isSubitem ? ' sidebar__subitem' : ''}`,
      href: `#${prefixo}${item.path}`,
      dataset: { id: chave },
      onClick: () => setMobileOpen(false),
    }, [icon, label]);

    itemElements[chave] = menuItem;
    return menuItem;
  }

  /**
   * O item aparece? Num modulo a resposta sai da ROTA que ele aponta, entao
   * restringir uma tela restringe o menu junto, sem ninguem lembrar de repetir
   * a regra aqui. `admin: true` no proprio item continua valendo para o que nao
   * tem rota de modulo, que hoje e so o menu de plataforma.
   * @param {Object} item
   * @param {string} moduloId - '' nos itens de plataforma
   * @returns {boolean}
   */
  function itemVisivel(item, moduloId) {
    if (item.admin && !isAdmin()) return false;
    if (!moduloId || !item.path) return true;
    return podeAbrirRota(moduloId, item.path);
  }

  function buildMenu(itens, prefixo, chavePrefixo, destino) {
    for (const item of itens) {
      if (!itemVisivel(item, chavePrefixo)) continue;

      if (item.children) {
        const filhos = item.children.filter(c => itemVisivel(c, chavePrefixo));
        if (!filhos.length) continue;

        const childIds = filhos.map(c => (chavePrefixo ? `${chavePrefixo}:${c.id}` : c.id));
        const itemsContainer = el('div', { className: 'sidebar__group-items' },
          filhos.map(child => buildItem(child, prefixo, chavePrefixo, true))
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
        destino.appendChild(group);
      } else {
        destino.appendChild(buildItem(item, prefixo, chavePrefixo));
      }
    }
  }

  /**
   * Uma seção colapsavel por modulo. O cabecalho e um LINK para a home do
   * modulo, entao clicar nele ja troca de modulo; o chevron ao lado abre e
   * fecha a lista sem navegar.
   */
  function buildModuleSection(mod) {
    const itensContainer = el('div', { className: 'sidebar__module-items' });
    buildMenu(mod.menu || [], `/${mod.id}`, mod.id, itensContainer);

    const chevron = el('button', {
      className: 'sidebar__module-chevron',
      type: 'button',
      'aria-label': `Abrir ou fechar ${nomeModulo(mod.id)}`,
      onClick: (e) => {
        // Sem isto o clique subiria para o link e navegaria junto.
        e.preventDefault();
        e.stopPropagation();
        const open = section.classList.toggle('sidebar__module--open');
        chevron.setAttribute('aria-expanded', String(open));
      },
    }, [svgIcon(ICONS.expandMore, 18)]);

    const header = el('a', {
      className: 'sidebar__module-header',
      href: `#${rotaInicial(mod)}`,
      title: nomeModulo(mod.id),
      onClick: () => setMobileOpen(false),
    }, [
      el('span', { className: 'sidebar__item-icon' }, [svgIcon(mod.icon || ICONE_PADRAO_MODULO, 24)]),
      el('span', { className: 'sidebar__item-label', textContent: nomeModulo(mod.id) }),
      chevron,
    ]);

    const section = el('div', { className: 'sidebar__module' }, [header, itensContainer]);
    moduleSections.push({ id: mod.id, section, header, chevron });
    nav.appendChild(section);
  }

  function build() {
    for (const mod of modulosAcessiveis()) {
      buildModuleSection(mod);
    }

    const plataforma = MENU_PLATAFORMA.filter(i => !i.admin || isAdmin());
    if (plataforma.length) {
      if (nav.childElementCount) {
        nav.appendChild(el('div', { className: 'sidebar__separator' }));
      }
      buildMenu(plataforma, '', '', nav);
    }
  }

  /**
   * Abre a seção do modulo ativo e fecha as demais. Com `null` (rota de
   * plataforma) NADA e fechado: a pessoa continua vendo onde estava.
   * @param {string|null} moduloId
   */
  function setModulo(moduloId) {
    for (const { id, section, header, chevron } of moduleSections) {
      const ativo = id === moduloId;
      header.classList.toggle('sidebar__module-header--active', ativo);
      if (!moduloId) continue;
      section.classList.toggle('sidebar__module--open', ativo);
      chevron.setAttribute('aria-expanded', String(ativo));
    }
  }

  /** Marca o item ativo pela chave qualificada (ver activeIdFromPath). */
  function setActive(activeId) {
    for (const [chave, itemEl] of Object.entries(itemElements)) {
      itemEl.classList.toggle('sidebar__item--active', chave === activeId);
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

  build();
  setModulo(modulo);

  return { sidebar, overlay, setModulo, setActive, toggle, setMobileOpen, isCurrentlyCollapsed };
}

/**
 * Resolve a chave do item da sidebar a partir de uma rota COMPLETA.
 * A chave carrega o modulo porque `dashboard` existe nos tres:
 *   '/orcamento/notas_empenho/3' -> 'orcamento:notas_empenho'
 *   '/acervo/dashboard'          -> 'acervo:dashboard'
 *   '/usuarios'                  -> 'usuarios'
 * @param {string} path
 * @returns {string|null}
 */
export function activeIdFromPath(path) {
  const partes = String(path || '').split('?')[0].split('/').filter(Boolean);
  if (!partes.length) return null;

  // Rota de modulo: o primeiro segmento e o modulo, o segundo e o item. Usa
  // getModulo, e nao modulosAcessiveis, para a funcao nao depender da sessao.
  if (getModulo(partes[0])) {
    return partes[1] ? `${partes[0]}:${partes[1]}` : null;
  }
  // Rota de plataforma (ex.: '/usuarios').
  return partes[0];
}
