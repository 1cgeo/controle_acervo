import '@css/style.css';
import { initTheme } from '@utils/theme.js';
import { isAuthenticated } from '@store/auth-store.js';
import Router, { adminLoader } from './router.js';
import { createMainLayout } from '@components/layout/main-layout.js';
import { renderLogin } from '@pages/login.js';
import { renderUnauthorized } from '@pages/unauthorized.js';
import { renderNotFound } from '@pages/not-found.js';
import { renderConsultarPedido } from '@pages/consultar-pedido.js';
import { renderDashboard } from '@pages/dashboard/index.js';
import { renderClientesList } from '@pages/clientes/list.js';
import { renderClienteDetails } from '@pages/clientes/details.js';
import { renderPedidosList } from '@pages/pedidos/list.js';
import { renderPedidoWizard } from '@pages/pedidos/wizard.js';
import { renderPedidoDetails } from '@pages/pedidos/details.js';
import { renderMateriaisList } from '@pages/materiais/list.js';
import { renderMaterialDetails } from '@pages/materiais/details.js';
import { renderEstoqueList } from '@pages/estoque/list.js';
import { renderConsumoList } from '@pages/consumo/list.js';
import { renderPlottersList } from '@pages/plotters/list.js';
import { renderPlotterDetails } from '@pages/plotters/details.js';

// Initialize theme (light/dark via data-theme, persisted in mapoteca-theme-mode)
initTheme();

const app = document.getElementById('app');

// Layout state: mounted only for authenticated (protected) pages
let mainLayout = null;

function getContentArea() {
  if (!mainLayout) {
    mainLayout = createMainLayout();
    app.innerHTML = '';
    app.appendChild(mainLayout.layout);
  }
  return mainLayout.contentArea;
}

function clearLayout() {
  if (mainLayout) {
    mainLayout.cleanup();
    mainLayout = null;
  }
  app.innerHTML = '';
}

/**
 * Wrap a page renderer so it renders inside the authenticated layout.
 * The page receives the layout content area and ctx { params, query }.
 */
function withLayout(renderFn) {
  return async (_container, ctx) => {
    const contentArea = getContentArea();
    contentArea.innerHTML = '';
    return await renderFn(contentArea, ctx);
  };
}

/**
 * Wrap a page renderer so it renders standalone (public pages, no layout).
 */
function standalone(renderFn) {
  return async (_container, ctx) => {
    clearLayout();
    return await renderFn(app, ctx);
  };
}

const router = new Router(app);

// Public: login (redirects to dashboard when already authenticated)
router.add('/login', standalone(renderLogin), {
  guard: () => (isAuthenticated() ? '/dashboard' : true),
});

// Protected (admin) pages — section 5.3 routes
router.add('/dashboard', withLayout(renderDashboard), { guard: adminLoader });
router.add('/clientes', withLayout(renderClientesList), { guard: adminLoader });
router.add('/clientes/:id', withLayout(renderClienteDetails), { guard: adminLoader });
router.add('/pedidos', withLayout(renderPedidosList), { guard: adminLoader });
router.add('/pedidos/novo', withLayout(renderPedidoWizard), { guard: adminLoader });
router.add('/pedidos/:id', withLayout(renderPedidoDetails), { guard: adminLoader });
router.add('/materiais', withLayout(renderMateriaisList), { guard: adminLoader });
router.add('/materiais/:id', withLayout(renderMaterialDetails), { guard: adminLoader });
router.add('/estoque', withLayout(renderEstoqueList), { guard: adminLoader });
router.add('/consumo', withLayout(renderConsumoList), { guard: adminLoader });
router.add('/plotters', withLayout(renderPlottersList), { guard: adminLoader });
router.add('/plotters/:id', withLayout(renderPlotterDetails), { guard: adminLoader });

// Public: order tracking by localizador (RN04)
router.add('/consultar/:localizador', standalone(renderConsultarPedido));

// Error pages (inside the layout when authenticated, standalone otherwise)
function errorPage(renderFn) {
  return async (_container, ctx) => {
    if (isAuthenticated()) {
      const contentArea = getContentArea();
      contentArea.innerHTML = '';
      return await renderFn(contentArea, ctx);
    }
    clearLayout();
    return await renderFn(app, ctx);
  };
}

router.add('/unauthorized', errorPage(renderUnauthorized));
router.add('/404', errorPage(renderNotFound));

router.start();
