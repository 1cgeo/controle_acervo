import { el, svgIcon, ICONS } from '@utils/dom.js';
import { toggleTheme, getTheme } from '@utils/theme.js';
import { getUsername, logout } from '@store/auth-store.js';
import { clearCache } from '@services/cache.js';
import { getModulo } from '@modules/registry.js';

/**
 * Navbar da interface unica: hamburger, titulo, area de extras do modulo
 * ativo, tema, usuario e sair.
 *
 * A troca de modulo NAO fica aqui. Ela vive na sidebar, onde cada modulo e uma
 * seção colapsavel e o cabecalho leva para a home dele. O seletor em dropdown
 * que existia aqui foi removido em 2026-07-27, a pedido do chefe.
 *
 * @param {Object} options
 * @param {Function} options.onToggleSidebar
 * @returns {HTMLElement} - elemento com ._cleanup() e ._setModulo(id)
 */
export function createNavbar({ onToggleSidebar }) {
  let dropdownOpen = false;
  const username = getUsername();
  const initial = username ? username.charAt(0).toUpperCase() : '?';

  // Hamburger toggle
  const toggleBtn = el('button', {
    className: 'navbar__toggle',
    'aria-label': 'Alternar menu lateral',
    onClick: () => onToggleSidebar(),
  }, [el('span', { className: 'navbar__toggle-icon' })]);

  // Titulo da plataforma. O nome do modulo ativo aparece na sidebar, nao aqui.
  const title = el('span', {
    className: 'navbar__title',
    textContent: 'SCA',
  });

  // Slot dos extras do modulo ativo (ex.: o seletor de ano do orcamento).
  const extrasSlot = el('div', { className: 'navbar__extras' });
  let extrasCleanup = null;
  // Sentinela: `null` e um valor VALIDO (rota de plataforma), entao a primeira
  // chamada nao pode ser confundida com "ja esta neste modulo".
  let moduloAtual;

  /**
   * Troca o modulo exibido: sincroniza o seletor e remonta os extras.
   * @param {string|null} moduloId
   */
  function setModulo(moduloId) {
    if (moduloId === moduloAtual) return;
    moduloAtual = moduloId;

    if (typeof extrasCleanup === 'function') {
      try {
        extrasCleanup();
      } catch (err) {
        console.error('Erro ao limpar extras da navbar:', err);
      }
      extrasCleanup = null;
    }
    extrasSlot.innerHTML = '';

    const mod = moduloId ? getModulo(moduloId) : null;
    if (mod && typeof mod.navbarExtras === 'function') {
      const extras = mod.navbarExtras() || {};
      for (const item of extras.elements || []) {
        if (item) extrasSlot.appendChild(item);
      }
      extrasCleanup = extras.cleanup || null;
    }
  }

  // Theme toggle
  const themeBtn = el('button', {
    className: 'navbar__theme-toggle',
    'aria-label': 'Alternar tema',
    onClick: () => {
      const newTheme = toggleTheme();
      themeBtn.innerHTML = '';
      themeBtn.appendChild(svgIcon(newTheme === 'dark' ? ICONS.lightMode : ICONS.darkMode, 20));
    },
  }, [svgIcon(getTheme() === 'dark' ? ICONS.lightMode : ICONS.darkMode, 20)]);

  // User dropdown
  const dropdown = el('div', { className: 'navbar__dropdown hidden' }, [
    el('button', {
      className: 'navbar__dropdown-item navbar__dropdown-item--danger',
      textContent: 'Sair',
      onClick: () => {
        clearCache();
        logout();
      },
    }),
  ]);

  const avatar = el('div', { className: 'navbar__avatar', textContent: initial });
  const usernameEl = el('span', { className: 'navbar__username', textContent: username });

  const userBtn = el('div', {
    className: 'navbar__user',
    onClick: (e) => {
      e.stopPropagation();
      dropdownOpen = !dropdownOpen;
      dropdown.classList.toggle('hidden', !dropdownOpen);
    },
  }, [usernameEl, avatar, dropdown]);

  // Close dropdown on outside click
  const closeDropdown = (e) => {
    if (dropdownOpen && !userBtn.contains(e.target)) {
      dropdownOpen = false;
      dropdown.classList.add('hidden');
    }
  };
  document.addEventListener('click', closeDropdown);

  const navbar = el('nav', { className: 'navbar' }, [
    el('div', { className: 'navbar__left' }, [toggleBtn, title]),
    el('div', { className: 'navbar__right' }, [extrasSlot, themeBtn, userBtn]),
  ]);

  navbar._setModulo = setModulo;

  navbar._cleanup = () => {
    document.removeEventListener('click', closeDropdown);
    if (typeof extrasCleanup === 'function') extrasCleanup();
  };

  return navbar;
}
