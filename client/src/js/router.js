import {
  isAuthenticated, isAdmin, temPerfil, ehDeAlgumPerfil, temAcessoModulo,
  ehGerenteDeAlgumModulo,
} from '@store/auth-store.js';
import { primeiroModuloAcessivel, rotaInicial } from '@modules/registry.js';

/**
 * Hash-based router with path params (:id), query strings and per-page cleanup.
 *
 * Toda rota de modulo tem o formato '/<modulo>/<caminho>' (ex.: '/orcamento/dfd').
 * As rotas de plataforma ('/login', '/usuarios', '/404', '/unauthorized') nao
 * carregam prefixo de modulo.
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
   * @param {string} path - e.g. '/orcamento/notas_empenho/:id' (register static
   *   paths like '/orcamento/dfd/novo' before the ':id' ones)
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

    // Raiz: manda para o primeiro modulo em que a pessoa tem acesso.
    if (pathname === '/' || pathname === '') {
      return this.navigate(rotaRaiz());
    }

    const matched = this.#match(pathname);
    if (!matched) {
      return this.navigate('/404');
    }

    const { route, params } = matched;

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
   * Navigate to a path (e.g. '/orcamento/dfd'). Re-resolves when already there.
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
 * Rota de entrada: o primeiro modulo acessivel. Sem sessao vai para o login;
 * com sessao mas sem nenhum modulo, a pessoa nao entra em lugar nenhum.
 * @returns {string}
 */
export function rotaRaiz() {
  if (!isAuthenticated()) return '/login';
  const modulo = primeiroModuloAcessivel();
  return modulo ? rotaInicial(modulo) : '/unauthorized';
}

/**
 * Guard: requires a valid session. Redirects to login keeping the origin route.
 * @returns {true|string}
 */
export function authLoader() {
  if (!isAuthenticated()) {
    const from = location.hash.slice(1) || '/';
    return `/login?from=${encodeURIComponent(from)}`;
  }
  return true;
}

/**
 * Guard: requires a valid session AND the global administrator flag.
 * Usado nas rotas de PLATAFORMA (usuarios) e no que o modulo marcar admin: true.
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

/**
 * Guard da tela de RASTREABILIDADE: administrador global OU gerente de algum
 * modulo.
 *
 * Nao cabe no `adminLoader` nem no `authLoader`, que sao os dois que a
 * plataforma tinha: a tela e do administrador (que ve tudo) e do gerente (que ve
 * o modulo dele). O recorte de verdade e do servidor, no
 * `verifyRastreabilidade`, que le o perfil do BANCO -- este guarda so evita
 * abrir uma tela que responderia 403, e le a foto do login, que envelhece.
 * @returns {true|string}
 */
export function rastreabilidadeLoader() {
  const auth = authLoader();
  if (auth !== true) return auth;
  if (!isAdmin() && !ehGerenteDeAlgumModulo()) return '/unauthorized';
  return true;
}

/**
 * Guard: exige sessao valida e um perfil MINIMO NO MODULO da rota.
 * Quem tenta entrar por URL num modulo sem perfil cai em /unauthorized.
 * O administrador global passa em qualquer modulo e nivel.
 * @param {string} modulo - nome_abrev do modulo (ex.: 'orcamento')
 * @param {'consulta'|'operador'|'gerente'} [minimo='consulta']
 * @returns {Function}
 */
export function perfilLoader(modulo, minimo = 'consulta') {
  return () => {
    const auth = authLoader();
    if (auth !== true) return auth;
    if (!temAcessoModulo(modulo)) return '/unauthorized';
    // LISTA de perfis: a tela vale so para quem tem um daqueles perfis, e nao
    // "aquele nivel ou acima". Na mapoteca o operador tem telas proprias e nao ve
    // as de leitura, mesmo sendo um nivel acima de consulta (chefe, 2026-07-30).
    // O menu decide pelo MESMO campo, em registry.podeAbrirRota: sem isso, a
    // pessoa nao veria o item e ainda assim abriria a tela pela URL.
    if (Array.isArray(minimo)) {
      if (!ehDeAlgumPerfil(minimo, modulo)) return '/unauthorized';
      return true;
    }
    if (!temPerfil(minimo, modulo)) return '/unauthorized';
    return true;
  };
}

export default Router;
