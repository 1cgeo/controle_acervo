import {
  isAuthenticated, isAdmin, temPerfil, ehDeAlgumPerfil, temAcessoModulo,
  ehGerenteDeAlgumModulo, temAlgumAcesso,
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
  // Fila de navegacao: uma resolucao por vez, na ordem dos cliques.
  #emCurso = Promise.resolve();
  // Ordem de chegada dos pedidos. Quem espera na fila e ja foi ultrapassado
  // desiste, em vez de desenhar o mesmo hash duas vezes.
  #ultimoPedido = 0;

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

  /**
   * Resolve o hash atual, uma navegacao POR VEZ.
   *
   * O handler da pagina e quem pinta, e ele ja pintou quando o `await` dele
   * retorna. Enquanto duas resolucoes corriam juntas, o router via tarde demais
   * que tinha perdido a corrida: dava para descartar a limpeza da rota
   * abandonada, nao dava para despintar a tela dela.
   *
   * A fila fecha isso na raiz. Cada pedido espera o anterior TERMINAR antes de
   * comecar, entao nunca ha dois handlers escrevendo. O ultimo hash e o que
   * fica na tela.
   *
   * O QUE ISSO CUSTA, e e preciso dizer: responsividade. Clicar no menu durante
   * uma carga lenta faz a navegacao nova esperar a carga em curso. A espera e
   * de UMA carga, nunca da fila inteira: quem foi ultrapassado desiste sem
   * desenhar. A tela ainda pisca a pagina abandonada antes de trocar, porque o
   * handler dela pinta ao terminar.
   */
  async resolve() {
    const meuPedido = ++this.#ultimoPedido;
    // O hash e lido AGORA, e nao depois da espera: cada pedido resolve o
    // destino que existia quando ele foi feito.
    const hash = location.hash.slice(1) || '/';
    const anterior = this.#emCurso;
    let liberar;
    this.#emCurso = new Promise((resolver) => { liberar = resolver; });

    try {
      await anterior;
      // Outro pedido entrou na fila enquanto este esperava. Quem chegou depois
      // desenha o destino mais novo, e carregar este aqui seria trabalho jogado
      // fora.
      if (meuPedido !== this.#ultimoPedido) return;
      return await this.#executar(hash);
    } finally {
      liberar();
    }
  }

  /**
   * O trabalho de uma navegacao, ja com a vez na fila.
   * @param {string} hash - destino sem o '#' (ex.: '/orcamento/dfd?ano=2026')
   */
  async #executar(hash) {
    // Cleanup previous page
    if (typeof this.#currentCleanup === 'function') {
      try {
        this.#currentCleanup();
      } catch (err) {
        console.error('Erro ao limpar página anterior:', err);
      }
      this.#currentCleanup = null;
    }

    const [pathname, queryString = ''] = hash.split('?');
    const query = new URLSearchParams(queryString);

    // Raiz: manda para o primeiro modulo em que a pessoa tem acesso.
    if (pathname === '/' || pathname === '') {
      return this.#redirecionar(rotaRaiz());
    }

    const matched = this.#match(pathname);
    if (!matched) {
      return this.#redirecionar('/404');
    }

    const { route, params } = matched;

    if (route.guard) {
      const result = route.guard({ params, query });
      if (result !== true) {
        return this.#redirecionar(typeof result === 'string' ? result : '/login');
      }
    }

    // Render page
    this.#currentCleanup = await route.handler(this.#container, { params, query });
  }

  /**
   * Desvio decidido DENTRO da fila (raiz, 404, guarda que reprova).
   * Passar por `navigate()` aqui esperaria a propria vez e travaria a fila.
   * @param {string} path
   */
  #redirecionar(path) {
    if (location.hash === `#${path}`) return this.#executar(path);
    location.hash = path;
    return undefined;
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
 * Rota de entrada: o primeiro modulo acessivel. Sem sessao vai para o login.
 *
 * PIT E EFETIVO NAO SAO MODULOS DO REGISTRY, e por isso precisam de resposta
 * propria aqui. Eles existem em `dominio.modulo` desde a 1.33.0 e guardam rotas
 * do servidor, mas as telas deles sao de PLATAFORMA (#/metas, #/aproveitamento),
 * sem manifesto e sem prefixo. Sem este trecho, quem tivesse perfil SO no PIT
 * ou SO em Efetivo entraria no sistema e cairia em /unauthorized, com o perfil
 * novo funcionando em toda rota menos na porta de entrada.
 *
 * A ORDEM segue a da sidebar: PIT antes de Efetivo.
 *
 * SEM NADA DISSO, A ENTRADA E '#/perfil', e nao mais '/unauthorized'. Quem ainda
 * nao recebeu perfil nenhum tem UMA tela que e dela -- o proprio cadastro, a
 * troca da propria senha e o pedido de acesso -- e cair num 403 na porta dizia a
 * essa pessoa que ela nao tinha nem conta. Ter conta e ter acesso sao dois
 * momentos, e o intervalo entre eles e justamente o que a tela de perfil cobre.
 * @returns {string}
 */
export function rotaRaiz() {
  if (!isAuthenticated()) return '/login';
  const modulo = primeiroModuloAcessivel();
  if (modulo) return rotaInicial(modulo);
  // '/metas' abre para quem tem perfil em algum modulo, entao qualquer nivel no
  // PIT basta para entrar por ela.
  if (temPerfil('consulta', 'pit')) return '/metas';
  // Em Efetivo, QUALQUER NIVEL entra pelo dashboard. Ele e a tela de leitura da
  // secao, e '#/acessos' cobra so consulta desde que a regua nova valeu.
  //
  // O OPERADOR NAO ENTRA MAIS PELO APROVEITAMENTO, e essa e a parte que morde:
  // a tela da Divisao inteira passou a pedir consulta OU gerente, numa lista que
  // nao e hierarquica, e mandar o operador para la seria mandar direto ao
  // /unauthorized. O aproveitamento dele agora e o proprio, em '#/perfil'.
  if (temPerfil('consulta', 'efetivo')) return '/acessos';
  return '/perfil';
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
 * Guard: exige sessao valida E acesso ao sistema, isto e, perfil em algum
 * modulo (ou a flag de administrador).
 *
 * E o piso das telas de PLATAFORMA que nao sao de modulo nenhum -- o PIT do ano
 * e o Extra-PIT. Era `authLoader`, e a diferenca e a conta recem-criada, ainda
 * sem concessao: ela nao ve o plano de trabalho da Divisao enquanto espera o
 * acesso. O servidor cobra o mesmo com `verifyAcesso`, lendo o BANCO.
 *
 * NAO guarda '#/perfil': aquela e a tela que existe para essa pessoa.
 * @returns {true|string}
 */
export function acessoLoader() {
  const auth = authLoader();
  if (auth !== true) return auth;
  if (!temAlgumAcesso()) return '/unauthorized';
  return true;
}

/**
 * Guard: administrador global OU gerente de qualquer modulo.
 *
 * Guarda a rastreabilidade e o RPCMTec (a lista e a edicao de um mes). Nenhuma
 * cabe no `adminLoader` nem no `authLoader`: elas sao do administrador (que ve
 * tudo) e do gerente (que ve o modulo dele). A execucao do PIT SAIU daqui na
 * regua de 2026-08-08, e virou `perfilLoader('pit', 'consulta')`.
 *
 * O recorte de verdade e do servidor (`verify_gerente.js` e
 * `verifyRastreabilidade`), que le o perfil do BANCO a cada requisicao. Aqui e
 * so ergonomia: evita abrir uma tela que responderia 403, lendo a foto do login,
 * que envelhece.
 * @returns {true|string}
 */
export function gerenteLoader() {
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
    // as de leitura, mesmo sendo um nivel acima de consulta.
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
