import { isAuthenticated, isAdmin } from '@store/auth-store.js';

/**
 * Hash-based router with path params (:id), query strings and per-page cleanup.
 *
 * Route handlers receive (container, ctx) where ctx = { params, query }:
 *   - params: object with the :named segments (e.g. { id: '3' })
 *   - query:  URLSearchParams of everything after '?' in the hash
 * Handlers may return a cleanup function; it is called before the next render.
 */
class Router {
  #routes = [];
  #container;
  #currentCleanup = null;

  /** @param {HTMLElement} container - root container passed to handlers */
  constructor(container) {
    this.#container = container;
  }

  /**
   * Register a route.
   * @param {string} path - e.g. '/pedidos/:id' (register static paths like '/pedidos/novo' first)
   * @param {Function} handler - async (container, ctx) => cleanupFn | void
   * @param {Object} [options]
   * @param {Function} [options.guard] - () => true | redirectPath (string)
   * @returns {Router}
   */
  add(path, handler, options = {}) {
    this.#routes.push({
      segments: path.split('/').filter(Boolean),
      path,
      handler,
      guard: options.guard || null,
    });
    return this;
  }

  #match(pathname) {
    const parts = pathname.split('/').filter(Boolean);
    for (const route of this.#routes) {
      if (route.segments.length !== parts.length) continue;
      const params = {};
      let ok = true;
      for (let i = 0; i < route.segments.length; i++) {
        const seg = route.segments[i];
        if (seg.startsWith(':')) {
          params[seg.slice(1)] = decodeURIComponent(parts[i]);
        } else if (seg !== parts[i]) {
          ok = false;
          break;
        }
      }
      if (ok) return { route, params };
    }
    return null;
  }

  async resolve() {
    // Cleanup previous page
    if (typeof this.#currentCleanup === 'function') {
      try {
        this.#currentCleanup();
      } catch (err) {
        console.error('Erro ao limpar página anterior:', err);
      }
      this.#currentCleanup = null;
    }

    const hash = location.hash.slice(1) || '/';
    const [pathname, queryString = ''] = hash.split('?');
    const query = new URLSearchParams(queryString);

    // Root redirect
    if (pathname === '/' || pathname === '') {
      return this.navigate('/dashboard');
    }

    const matched = this.#match(pathname);
    if (!matched) {
      return this.navigate('/404');
    }

    const { route, params } = matched;

    // Run guard
    if (route.guard) {
      const result = route.guard({ params, query });
      if (result !== true) {
        return this.navigate(typeof result === 'string' ? result : '/login');
      }
    }

    // Render page
    this.#currentCleanup = await route.handler(this.#container, { params, query });
  }

  /**
   * Navigate to a path (e.g. '/pedidos/3'). Re-resolves when already there.
   * @param {string} path
   */
  navigate(path) {
    if (location.hash === `#${path}`) {
      this.resolve();
    } else {
      location.hash = path;
    }
  }

  start() {
    window.addEventListener('hashchange', () => this.resolve());
    this.resolve();
  }
}

/**
 * Guard: requires a valid session. Redirects to login keeping the origin route.
 * @returns {true|string}
 */
export function authLoader() {
  if (!isAuthenticated()) {
    const from = location.hash.slice(1) || '/dashboard';
    return `/login?from=${encodeURIComponent(from)}`;
  }
  return true;
}

/**
 * Guard: requires a valid session AND the ADMIN role.
 * @returns {true|string}
 */
export function adminLoader() {
  const auth = authLoader();
  if (auth !== true) return auth;
  if (!isAdmin()) {
    return '/unauthorized';
  }
  return true;
}

export default Router;
