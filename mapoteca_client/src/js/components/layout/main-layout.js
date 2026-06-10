import { el } from '@utils/dom.js';
import { createNavbar } from './navbar.js';
import { createSidebar, activeIdFromPath } from './sidebar.js';

/**
 * Create the authenticated application layout (navbar + sidebar + content).
 * Public routes (login, consultar, 403/404 when logged out) must not mount it
 * — index.js handles that by clearing the layout before rendering them.
 *
 * @returns {{layout:HTMLElement, contentArea:HTMLElement, sidebarCtrl:Object, cleanup:Function}}
 */
export function createMainLayout() {
  const sidebarCtrl = createSidebar({ collapsed: false });
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

  // Keep the sidebar active item in sync with the hash
  const syncActive = () => {
    const path = location.hash.slice(1) || '/dashboard';
    const activeId = activeIdFromPath(path);
    if (activeId) sidebarCtrl.setActive(activeId);
  };
  window.addEventListener('hashchange', syncActive);
  syncActive();

  function cleanup() {
    window.removeEventListener('hashchange', syncActive);
    if (navbar._cleanup) navbar._cleanup();
  }

  return { layout, contentArea, sidebarCtrl, cleanup };
}
