import { el } from '@utils/dom.js';
import { createNavbar } from './navbar.js';
import { createSidebar, activeIdFromPath } from './sidebar.js';
import { moduloDaRota } from '@modules/registry.js';

/**
 * Layout autenticado da interface unica (navbar + sidebar + conteudo).
 * Rotas publicas (login, 403/404 deslogado) nao o montam; index.js limpa o
 * layout antes de renderiza-las.
 *
 * O layout e criado UMA vez e sobrevive a troca de modulo: ao mudar o hash, ele
 * remonta a sidebar e os extras da navbar para o modulo da rota, sem recarregar
 * a pagina. E o que faz trocar de modulo custar uma troca de rota.
 *
 * @returns {{layout:HTMLElement, contentArea:HTMLElement, sidebarCtrl:Object, cleanup:Function}}
 */
export function createMainLayout() {
  const moduloInicial = moduloDaRota(location.hash.slice(1));
  const sidebarCtrl = createSidebar({ collapsed: false, modulo: moduloInicial });
  const isMobile = () => window.innerWidth <= 900;

  const contentArea = el('main', { className: 'main-content' });

  const navbar = createNavbar({
    onToggleSidebar: () => {
      if (isMobile()) {
        sidebarCtrl.setMobileOpen(true);
      } else {
        const collapsed = sidebarCtrl.toggle();
        contentArea.classList.toggle('main-content--sidebar-collapsed', collapsed);
      }
    },
  });

  const layout = el('div', { className: 'app-layout' }, [
    navbar,
    sidebarCtrl.sidebar,
    sidebarCtrl.overlay,
    contentArea,
  ]);

  // Mantem o modulo ativo e o item da sidebar em dia com o hash. A navbar saiu
  // daqui em 2026-08-04: sem os extras de modulo, ela nao muda com a rota.
  const sync = () => {
    const path = location.hash.slice(1) || '/';
    sidebarCtrl.setModulo(moduloDaRota(path));
    sidebarCtrl.setActive(activeIdFromPath(path));
  };
  window.addEventListener('hashchange', sync);
  sync();

  function cleanup() {
    window.removeEventListener('hashchange', sync);
    if (navbar._cleanup) navbar._cleanup();
  }

  return { layout, contentArea, sidebarCtrl, cleanup };
}
