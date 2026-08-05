import { el, svgIcon, ICONS } from '@utils/dom.js';
import { toggleTheme, getTheme } from '@utils/theme.js';
import { getUsername, logout } from '@store/auth-store.js';

/**
 * Navbar da interface unica: hamburger, titulo, tema, usuario e sair.
 *
 * A troca de modulo NAO fica aqui. Ela vive na sidebar, onde cada modulo e uma
 * seção colapsavel e o cabecalho leva para a home dele.
 *
 * A navbar tambem NAO tem area de extras do modulo, e por isso nao depende do
 * registro de modulos. O ano e filtro de cada tela.
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

  // User dropdown. "Meu perfil" e o unico caminho pelo qual a pessoa troca a
  // PROPRIA senha; sem ele, so o administrador troca senha, por reset.
  const dropdown = el('div', { className: 'navbar__dropdown hidden' }, [
    el('a', {
      className: 'navbar__dropdown-item',
      href: '#/perfil',
      textContent: 'Meu perfil',
    }),
    el('button', {
      className: 'navbar__dropdown-item navbar__dropdown-item--danger',
      textContent: 'Sair',
      // `logout()` ja apaga o cache junto com a sessao (ver clearAuth). O
      // `clearCache()` que ficava aqui era a UNICA porta que limpava, e por isso
      // o 401 e a tela de acesso negado deixavam dado da sessao anterior vivo.
      onClick: () => logout(),
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
