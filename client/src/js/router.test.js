import { describe, test, expect, beforeEach } from 'vitest';
import { flush } from '@/__tests__/helpers/flush.js';
import { saveAuth, clearAuth } from '@store/auth-store.js';
import Router, {
  acessoLoader, authLoader, adminLoader, gerenteLoader, perfilLoader, rotaRaiz,
} from './router.js';

const CATALOGO = [
  { code: 1, nome: 'Acervo', nome_abrev: 'acervo' },
  { code: 2, nome: 'Mapoteca', nome_abrev: 'mapoteca' },
  { code: 3, nome: 'Orçamento', nome_abrev: 'orcamento' },
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

  // ESTAR LOGADO E TER ACESSO nao sao a mesma coisa. A conta recem-criada nasce
  // sem linha em `dgeo.usuario_perfil`, e as telas de PLATAFORMA que nao sao de
  // modulo nenhum (o PIT do ano, o Extra-PIT) nao sao dela. O servidor cobra o
  // mesmo com `verifyAcesso`.
  test('acessoLoader barra quem nao tem perfil em modulo nenhum', () => {
    logar({ perfis: {} });
    expect(acessoLoader()).toBe('/unauthorized');
  });

  test('acessoLoader passa com qualquer perfil em qualquer modulo', () => {
    logar({ perfis: { mapoteca: 1 } });
    expect(acessoLoader()).toBe(true);
  });

  // O administrador global nao tem linha de perfil nenhuma, e passa por ser
  // administrador. Sem isto, quem administra o sistema seria o unico barrado do
  // plano anual dele.
  test('acessoLoader passa o administrador global, que nao tem linha de perfil', () => {
    logar({ administrador: true, perfis: {} });
    expect(acessoLoader()).toBe(true);
  });

  test('acessoLoader manda ao login quem nao tem sessao', () => {
    clearAuth();
    location.hash = '/metas';
    expect(acessoLoader()).toBe(`/login?from=${encodeURIComponent('/metas')}`);
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

  // A REGUA DA INTERFACE, valendo para o sistema todo: consulta LE as telas do
  // modulo, operador LANCA, e gerente responde pela area inteira e ve tudo dela.
  // Os testes abaixo provam os tres casos em que ela nao e obvia.

  // ESTE E O CASO QUE MAIS CONFUNDE QUEM LE DEPOIS: a lista de perfis NAO E
  // HIERARQUICA, e por isso o OPERADOR e recusado onde a consulta passa, mesmo
  // estando um nivel acima dela. E de proposito, e guarda '#/aproveitamento': o
  // operador cuida do PROPRIO aproveitamento, em '#/perfil', e nao da tela da
  // Divisao inteira; quem lanca pelos outros e o gerente, e quem so le e a
  // consulta. Com um minimo hierarquico ('operador') o operador entraria por ser
  // um nivel acima de consulta, que e exatamente o contrario da regua.
  test('lista de perfis nao e hierarquica: consulta e gerente entram, o operador nao', () => {
    logar({ perfis: { efetivo: 1 } });
    expect(perfilLoader('efetivo', ['consulta', 'gerente'])()).toBe(true);

    logar({ perfis: { efetivo: 3 } });
    expect(perfilLoader('efetivo', ['consulta', 'gerente'])()).toBe(true);

    logar({ perfis: { efetivo: 2 } });
    expect(perfilLoader('efetivo', ['consulta', 'gerente'])()).toBe('/unauthorized');
  });

  // A consulta em Producao LE a execucao do PIT e a capacitacao ministrada, que
  // ate a regua nova pediam gerente e operador. Ler a grade nao move nada.
  test('consulta em Producao abre as telas de leitura do modulo', () => {
    logar({ perfis: { producao: 1 } });
    expect(perfilLoader('producao', 'consulta')()).toBe(true);
  });

  test('consulta em Producao nao vira acesso ao Efetivo', () => {
    logar({ perfis: { producao: 1 } });
    expect(perfilLoader('efetivo', 'consulta')()).toBe('/unauthorized');
  });

  // `gerenteLoader` guarda o que vale para a Divisao inteira, e nao para um
  // modulo so: a rastreabilidade, e o RPCMTec desde que ele deixou de ser
  // admin-only. Qualquer modulo serve, porque gerente responde pela area dele e
  // o relatorio e um so.
  test('gerenteLoader passa o gerente de QUALQUER modulo', () => {
    logar({ perfis: { mapoteca: 3 } });
    expect(gerenteLoader()).toBe(true);

    logar({ perfis: { producao: 3 } });
    expect(gerenteLoader()).toBe(true);
  });

  test('gerenteLoader recusa o operador, e passa o administrador global', () => {
    logar({ perfis: { orcamento: 2, acervo: 2 } });
    expect(gerenteLoader()).toBe('/unauthorized');

    logar({ administrador: true, perfis: {} });
    expect(gerenteLoader()).toBe(true);
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

  // Quem nao tem perfil nenhum entra na PROPRIA pagina, e nao num 403. A conta
  // existe e a senha funciona; o que falta e a concessao, e '#/perfil' e onde
  // ela ve isso escrito e pede o acesso. Cair no 403 na porta dizia a essa
  // pessoa que ela nao tinha nem conta.
  test('logado sem modulo acessivel entra no proprio perfil', () => {
    logar({ perfis: {} });
    expect(rotaRaiz()).toBe('/perfil');
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

  // O OPERADOR NAO ENTRA MAIS PELO APROVEITAMENTO. Aquela tela e a da Divisao
  // inteira, e passou a pedir consulta OU gerente, numa lista que nao e
  // hierarquica: mandar o operador para la seria mandar direto ao /unauthorized.
  // O dashboard cobra so consulta, entao ele serve a todo nivel do Efetivo.
  test('so com perfil de operador em Efetivo, a raiz abre o dashboard', () => {
    logar({ perfis: { efetivo: 2 } });
    expect(rotaRaiz()).toBe('/acessos');
  });

  // CONSULTA em Efetivo GANHOU tela com a regua nova: '#/acessos' desceu de
  // gerente para consulta, e antes disso essa pessoa caia no proprio perfil por
  // nao ter nenhuma.
  test('consulta em Efetivo entra pelo dashboard do efetivo', () => {
    logar({ perfis: { efetivo: 1 } });
    expect(rotaRaiz()).toBe('/acessos');
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
