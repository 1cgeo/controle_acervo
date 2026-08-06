import { describe, test, expect, beforeEach } from 'vitest';
import { flush } from '@/__tests__/helpers/flush.js';
import { saveAuth, clearAuth } from '@store/auth-store.js';
import Router, { authLoader, adminLoader, perfilLoader, rotaRaiz } from './router.js';

const CATALOGO = [
  { code: 1, nome: 'Controle do Acervo', nome_abrev: 'acervo' },
  { code: 2, nome: 'Mapoteca', nome_abrev: 'mapoteca' },
  { code: 3, nome: 'Controle Orçamentário', nome_abrev: 'orcamento' },
];

function logar({ administrador = false, perfis = {} } = {}) {
  saveAuth({ token: 't', administrador, uuid: 'u', perfis, modulos: CATALOGO }, 'x');
}

beforeEach(() => {
  localStorage.clear();
  location.hash = '';
});

describe('router: guardas', () => {
  test('sem sessao, authLoader manda ao login guardando a origem', () => {
    clearAuth();
    location.hash = '/orcamento/dfd';
    const destino = authLoader();
    expect(destino).toBe(`/login?from=${encodeURIComponent('/orcamento/dfd')}`);
  });

  test('perfilLoader barra quem nao tem perfil NO MODULO da rota', () => {
    logar({ perfis: { acervo: 3 } });
    expect(perfilLoader('acervo', 'consulta')()).toBe(true);
    // Gerente do acervo nao entra no orcamento
    expect(perfilLoader('orcamento', 'consulta')()).toBe('/unauthorized');
  });

  test('perfilLoader respeita o nivel minimo dentro do modulo', () => {
    logar({ perfis: { orcamento: 1 } });
    expect(perfilLoader('orcamento', 'consulta')()).toBe(true);
    expect(perfilLoader('orcamento', 'operador')()).toBe('/unauthorized');
    expect(perfilLoader('orcamento', 'gerente')()).toBe('/unauthorized');
  });

  test('administrador global passa em qualquer modulo e nivel', () => {
    logar({ administrador: true, perfis: {} });
    expect(perfilLoader('orcamento', 'gerente')()).toBe(true);
    expect(perfilLoader('mapoteca', 'gerente')()).toBe(true);
    expect(adminLoader()).toBe(true);
  });

  test('adminLoader barra quem nao e administrador, mesmo sendo gerente', () => {
    logar({ perfis: { orcamento: 3 } });
    expect(adminLoader()).toBe('/unauthorized');
  });
});

describe('router: rota raiz', () => {
  test('sem sessao vai para o login', () => {
    clearAuth();
    expect(rotaRaiz()).toBe('/login');
  });

  test('com perfil no orcamento entra no orcamento', () => {
    logar({ perfis: { orcamento: 1 } });
    expect(rotaRaiz()).toBe('/orcamento/dashboard');
  });

  test('logado sem modulo acessivel cai no 403, nao numa tela vazia', () => {
    logar({ perfis: {} });
    expect(rotaRaiz()).toBe('/unauthorized');
  });

  // PRODUCAO e EFETIVO nao sao modulos do registry: eles existem em
  // `dominio.modulo` e guardam rotas do servidor, mas as telas deles sao de
  // PLATAFORMA, sem manifesto. Sem tratamento proprio na `rotaRaiz`, quem
  // tivesse perfil SO num deles entraria e cairia em /unauthorized, com o perfil
  // novo funcionando em toda rota menos na porta de entrada.
  test('so com perfil em Producao, a raiz abre o plano anual', () => {
    logar({ perfis: { producao: 2 } });
    expect(rotaRaiz()).toBe('/metas');
  });

  test('so com perfil de operador em Efetivo, a raiz abre o aproveitamento', () => {
    logar({ perfis: { efetivo: 2 } });
    expect(rotaRaiz()).toBe('/aproveitamento');
  });

  // CONSULTA em Efetivo nao abre tela nenhuma: a mais baixa da seção exige
  // operador. O /unauthorized aqui e a resposta certa, e nao uma lacuna.
  test('consulta em Efetivo continua sem porta de entrada', () => {
    logar({ perfis: { efetivo: 1 } });
    expect(rotaRaiz()).toBe('/unauthorized');
  });

  // O modulo do registry VENCE: quem tem os dois entra pelo modulo, que e onde
  // ele tem tela propria com dashboard.
  test('com modulo do registry E perfil em Producao, o modulo ganha', () => {
    logar({ perfis: { orcamento: 1, producao: 2 } });
    expect(rotaRaiz()).toBe('/orcamento/dashboard');
  });
});

describe('router: resolucao', () => {
  test('rota de modulo casa com o prefixo e passa os params', async () => {
    logar({ administrador: true });
    const container = document.createElement('div');
    const router = new Router(container);
    let visto = null;
    router.add('/orcamento/notas_empenho/:id', async (_c, ctx) => { visto = ctx.params.id; });

    location.hash = '/orcamento/notas_empenho/42';
    await router.resolve();
    await flush();

    expect(visto).toBe('42');
  });

  test('a mesma rota SEM o prefixo do modulo nao casa', async () => {
    logar({ administrador: true });
    const container = document.createElement('div');
    const router = new Router(container);
    let chamou = false;
    router.add('/orcamento/dfd', async () => { chamou = true; });
    router.add('/404', async () => {});

    location.hash = '/dfd';
    await router.resolve();
    await flush();

    expect(chamou).toBe(false);
    expect(location.hash).toBe('#/404');
  });

  test('guarda reprovando redireciona em vez de renderizar', async () => {
    logar({ perfis: { acervo: 1 } });
    const container = document.createElement('div');
    const router = new Router(container);
    let chamou = false;
    router.add('/orcamento/dfd', async () => { chamou = true; }, {
      guard: perfilLoader('orcamento', 'consulta'),
    });
    router.add('/unauthorized', async () => {});

    location.hash = '/orcamento/dfd';
    await router.resolve();
    await flush();

    expect(chamou).toBe(false);
    expect(location.hash).toBe('#/unauthorized');
  });

  test('trocar de modulo e trocar a rota, sem recarregar a pagina', async () => {
    logar({ administrador: true });
    const container = document.createElement('div');
    const router = new Router(container);
    const vistos = [];
    router.add('/orcamento/dashboard', async () => { vistos.push('orcamento'); });
    router.add('/mapoteca/dashboard', async () => { vistos.push('mapoteca'); });

    location.hash = '/orcamento/dashboard';
    await router.resolve();
    location.hash = '/mapoteca/dashboard';
    await router.resolve();

    expect(vistos).toEqual(['orcamento', 'mapoteca']);
  });

  test('a limpeza da pagina anterior roda antes da proxima', async () => {
    logar({ administrador: true });
    const container = document.createElement('div');
    const router = new Router(container);
    const ordem = [];
    router.add('/orcamento/dashboard', async () => {
      ordem.push('render-a');
      return () => ordem.push('cleanup-a');
    });
    router.add('/orcamento/dfd', async () => { ordem.push('render-b'); });

    location.hash = '/orcamento/dashboard';
    await router.resolve();
    location.hash = '/orcamento/dfd';
    await router.resolve();

    expect(ordem).toEqual(['render-a', 'cleanup-a', 'render-b']);
  });
});
