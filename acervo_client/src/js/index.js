import '@css/style.css';
import { initTheme } from '@utils/theme.js';
import { isAuthenticated } from '@store/auth-store.js';
import Router, { authGuard, adminGuard } from './router.js';
import { createAppLayout } from '@components/layout/app-layout.js';
import { renderLogin } from '@pages/login.js';
import { renderDashboard } from '@pages/dashboard.js';
import { renderUnauthorized } from '@pages/unauthorized.js';
import { renderNotFound } from '@pages/not-found.js';

// Initialize theme
initTheme();

const app = document.getElementById('app');

// State
let appLayout = null;

function getContentArea() {
  if (!appLayout) {
    appLayout = createAppLayout();
    app.innerHTML = '';
    app.appendChild(appLayout.layout);
  }
  return appLayout.contentArea;
}

function clearLayout() {
  if (appLayout) {
    appLayout.cleanup();
    appLayout = null;
  }
  app.innerHTML = '';
}

// Router setup
const router = new Router(app);

// Login (no layout)
router.add('/login', async (container) => {
  clearLayout();
  await renderLogin(container);
}, {
  guard: () => {
    // If already authenticated, redirect to dashboard
    if (isAuthenticated()) return '/dashboard';
    return true;
  },
});

// Dashboard (with layout, admin only)
router.add('/dashboard', async () => {
  const contentArea = getContentArea();
  contentArea.innerHTML = '';
  return await renderDashboard(contentArea);
}, { guard: adminGuard });

// Error pages (with layout if authenticated, otherwise standalone)
router.add('/unauthorized', async (container) => {
  if (isAuthenticated()) {
    const contentArea = getContentArea();
    contentArea.innerHTML = '';
    await renderUnauthorized(contentArea);
  } else {
    clearLayout();
    await renderUnauthorized(container);
  }
});

router.add('/404', async (container) => {
  if (isAuthenticated()) {
    const contentArea = getContentArea();
    contentArea.innerHTML = '';
    await renderNotFound(contentArea);
  } else {
    clearLayout();
    await renderNotFound(container);
  }
});

// Start router
router.start();
