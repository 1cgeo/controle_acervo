import { el, svgIcon, ICONS } from '@utils/dom.js';
import { toggleTheme, getTheme } from '@utils/theme.js';
import { getUsername, logout } from '@store/auth-store.js';
import { clearCache } from '@services/cache.js';

/**
 * Navbar da interface unica: hamburger, titulo, tema, usuario e sair.
 *
 * A troca de modulo NAO fica aqui. Ela vive na sidebar, onde cada modulo e uma
 * seção colapsavel e o cabecalho leva para a home dele. O seletor em dropdown
 * que existia aqui foi removido em 2026-07-27, a pedido do chefe.
 *
 * A navbar tambem NAO tem mais area de extras do modulo. O unico extra que
 * existiu foi o seletor de ano, que saiu em 2026-08-04: o ano virou filtro de
 * cada tela. Com ele foram embora o `navbarExtras`, o slot e o `_setModulo`,
 * que so existiam para montar e desmontar esses extras. A navbar deixou de
 * depender do registro de modulos.
 *
 * @param {Object} options
 * @param {Function} options.onToggleSidebar
 * @returns {HTMLElement} - elemento com ._cleanup()
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

  // User dropdown. "Meu perfil" entrou em 2026-08-02, com a autenticacao vindo
  // para dentro do SCA: e de la que a pessoa troca a PROPRIA senha, e sem esse
  // caminho ninguem troca a senha de ninguem a nao ser o administrador.
  const dropdown = el('div', { className: 'navbar__dropdown hidden' }, [
    el('a', {
      className: 'navbar__dropdown-item',
      href: '#/perfil',
      textContent: 'Meu perfil',
    }),
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

  const closeDropdown = (e) => {
    if (dropdownOpen && !userBtn.contains(e.target)) {
      dropdownOpen = false;
      dropdown.classList.add('hidden');
    }
  };
  document.addEventListener('click', closeDropdown);

  const navbar = el('nav', { className: 'navbar' }, [
    el('div', { className: 'navbar__left' }, [toggleBtn, title]),
    el('div', { className: 'navbar__right' }, [themeBtn, userBtn]),
  ]);

  navbar._cleanup = () => {
    document.removeEventListener('click', closeDropdown);
  };

  return navbar;
}
