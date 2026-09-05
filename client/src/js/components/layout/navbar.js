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
  // 'SCA' ate 2026-08-09, quando o sistema passou a se chamar SAP. O 3.0 e a
  // VERSAO do servico, e nao entra no rotulo.
  const title = el('span', {
    className: 'navbar__title',
    textContent: 'SAP',
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

  /**
   * O GATILHO E UM `<button>`, e nao a `<div>` com `onClick` que estava aqui.
   *
   * A `<div>` nao entra na ordem de tabulacao e nao responde a tecla nenhuma:
   * "Meu perfil" e "Sair" existiam so para quem usa o mouse. E "Meu perfil" e o
   * UNICO caminho pelo qual a pessoa troca a propria senha -- sem ele, quem
   * navega pelo teclado dependia do administrador para isso.
   *
   * A `.navbar__user` continua existindo como a caixa POSICIONADORA: o dropdown
   * e `position: absolute` em relacao a ela. O que desceu para o botao foi o
   * visual do gatilho (a linha com nome e avatar, e o realce ao passar o mouse).
   */
  const gatilho = el('button', {
    className: 'navbar__user-gatilho',
    type: 'button',
    'aria-haspopup': 'true',
    'aria-expanded': 'false',
    'aria-label': username ? `Menu de ${username}` : 'Menu do usuário',
    onClick: (e) => {
      e.stopPropagation();
      abrirDropdown(!dropdownOpen);
    },
  }, [usernameEl, avatar]);

  const userBtn = el('div', { className: 'navbar__user' }, [gatilho, dropdown]);

  // ACIONAR UM ITEM FECHA O MENU. O `closeDropdown` abaixo so fecha por clique
  // FORA da caixa, e o dropdown esta DENTRO dela: clicar em "Meu perfil" navegava
  // e deixava o menu aberto por cima da pagina nova, ate a pessoa clicar em
  // qualquer outro lugar. Pior para quem ja esta em '#/perfil': o clique nao
  // muda nada na tela e ainda deixa o menu aberto.
  dropdown.addEventListener('click', () => abrirDropdown(false));

  function abrirDropdown(aberto) {
    dropdownOpen = aberto;
    dropdown.classList.toggle('hidden', !dropdownOpen);
    gatilho.setAttribute('aria-expanded', String(dropdownOpen));
  }

  const closeDropdown = (e) => {
    if (dropdownOpen && !userBtn.contains(e.target)) {
      abrirDropdown(false);
    }
  };
  document.addEventListener('click', closeDropdown);

  // Escape fecha e DEVOLVE O FOCO ao gatilho: sem isso quem abriu pelo teclado
  // fecharia o menu e ficaria com o foco no nada, no fim da barra.
  const escaparDropdown = (e) => {
    if (!dropdownOpen || e.key !== 'Escape') return;
    abrirDropdown(false);
    gatilho.focus();
  };
  document.addEventListener('keydown', escaparDropdown);

  const navbar = el('nav', { className: 'navbar' }, [
    el('div', { className: 'navbar__left' }, [toggleBtn, title]),
    el('div', { className: 'navbar__right' }, [themeBtn, userBtn]),
  ]);

  navbar._cleanup = () => {
    document.removeEventListener('click', closeDropdown);
    document.removeEventListener('keydown', escaparDropdown);
  };

  return navbar;
}
