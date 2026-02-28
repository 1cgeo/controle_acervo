import { isAuthenticated, isAdmin } from '@store/auth-store.js';

class Router {
  #routes = [];
  #contentEl;
  #currentCleanup = null;

  constructor(contentEl) {
    this.#contentEl = contentEl;
  }

  /**
   * Register a route.
   * @param {string} path - e.g. '/login', '/dashboard'
   * @param {Function} handler - async (container) => cleanupFn | void
   * @param {Object} [options]
   * @param {Function} [options.guard] - () => boolean | string (redirect path)
   */
  add(path, handler, options = {}) {
    this.#routes.push({ path, handler, guard: options.guard || null });
    return this;
  }

  async resolve() {
    // Cleanup previous page
    if (typeof this.#currentCleanup === 'function') {
      this.#currentCleanup();
      this.#currentCleanup = null;
    }

    const hash = location.hash.slice(1) || '/';

    // Handle root redirect
    if (hash === '/') {
      return this.navigate('/dashboard');
    }

    const route = this.#routes.find(r => r.path === hash);

    if (!route) {
      return this.navigate('/404');
    }

    // Run guard
    if (route.guard) {
      const result = route.guard();
      if (result !== true) {
        return this.navigate(typeof result === 'string' ? result : '/login');
      }
    }

    // Render page
    this.#contentEl.innerHTML = '';
    this.#currentCleanup = await route.handler(this.#contentEl);
  }

  navigate(path) {
    location.hash = path;
  }

  start() {
    window.addEventListener('hashchange', () => this.resolve());
    this.resolve();
  }
}

// Guards
export function authGuard() {
  if (!isAuthenticated()) {
    const from = location.hash.slice(1) || '/dashboard';
    return `/login?from=${encodeURIComponent(from)}`;
  }
  return true;
}

export function adminGuard() {
  if (!isAuthenticated()) {
    return '/login';
  }
  if (!isAdmin()) {
    return '/unauthorized';
  }
  return true;
}

export default Router;
