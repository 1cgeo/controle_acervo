import { el } from '@utils/dom.js';
import { createNavbar } from './navbar.js';
import { createSidebar } from './sidebar.js';

/**
 * Create the main application layout with navbar, sidebar, and content area.
 * @returns {{ layout: HTMLElement, contentArea: HTMLElement, sidebarCtrl: Object, cleanup: Function }}
 */
export function createAppLayout() {
  const sidebarCtrl = createSidebar({ collapsed: false });
  const isMobile = () => window.innerWidth <= 900;

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

  const contentArea = el('main', { className: 'main-content' });

  const layout = el('div', { className: 'app-layout' }, [
    navbar,
    sidebarCtrl.sidebar,
    sidebarCtrl.overlay,
    contentArea,
  ]);

  // Listen for hash changes to update sidebar active item
  const onHashChange = () => {
    const hash = location.hash.slice(1) || '/dashboard';
    if (hash.startsWith('/dashboard')) sidebarCtrl.setActive('dashboard');
    else if (hash.startsWith('/volumes')) sidebarCtrl.setActive('volumes');
  };
  window.addEventListener('hashchange', onHashChange);

  function cleanup() {
    window.removeEventListener('hashchange', onHashChange);
    if (navbar._cleanup) navbar._cleanup();
  }

  return { layout, contentArea, sidebarCtrl, cleanup };
}
