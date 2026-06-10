import { el, svgIcon, ICONS } from '@utils/dom.js';
import { toggleTheme, getTheme } from '@utils/theme.js';
import { getUsername, logout } from '@store/auth-store.js';
import { clearCache } from '@services/cache.js';

/**
 * Create the top navbar (hamburger, "Mapoteca" title, theme toggle, username, logout).
 * @param {Object} options
 * @param {Function} options.onToggleSidebar
 * @returns {HTMLElement} - element with ._cleanup()
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

  // Title
  const title = el('span', {
    className: 'navbar__title',
    textContent: 'Mapoteca',
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
    el('div', { className: 'navbar__right' }, [themeBtn, userBtn]),
  ]);

  navbar._cleanup = () => {
    document.removeEventListener('click', closeDropdown);
  };

  return navbar;
}
