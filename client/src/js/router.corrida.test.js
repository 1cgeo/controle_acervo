import { describe, test, expect, beforeEach } from 'vitest';
import { flush } from '@/__tests__/helpers/flush.js';
import { saveAuth } from '@store/auth-store.js';
import Router from './router.js';

// REGRESSAO: duas navegacoes ao mesmo tempo, e a LENTA chegando por ultimo.
//
// `resolve()` espera o handler da pagina, que busca dados. Abrir uma ficha
// pesada e clicar logo em outro item do menu deixava duas resolucoes correndo. A
// segunda limpava a tela e desenhava a dela; a primeira chegava depois,
// escrevia por cima e ainda gravava o `#currentCleanup` DELA. Resultado: a tela
// ficava com a rota abandonada, e a limpeza da rota certa nunca rodava.
//
// O router agora resolve uma navegacao POR VEZ (fila). Estes casos guardam as
// duas metades disso: a tela termina no destino certo, e a limpeza de quem
// carregou antes nao vaza.
//
// Todo caso aqui deixa a carga lenta COMECAR de verdade antes do segundo
// clique, com um `flush()` no meio. Sem isso a fila descarta o primeiro pedido
// antes de ele chamar o handler, nao ha duas cargas, e o caso passaria a provar
// nada.

const CATALOGO = [
  { code: 1, nome: 'Controle do Acervo', nome_abrev: 'acervo' },
];

const espera = (ms) => new Promise(resolve => setTimeout(resolve, ms));

beforeEach(() => {
  localStorage.clear();
  location.hash = '';
  saveAuth({ token: 't', administrador: true, uuid: 'u', perfis: {}, modulos: CATALOGO }, 'x');
});

describe('router: duas cargas ao mesmo tempo', () => {
  /**
   * O CASO QUE FECHA A LACUNA. Quem pinta e o handler, e o router nao despinta.
   * A fila resolve isso na origem: a rota rapida so comeca depois de a lenta
   * terminar, entao a lenta nao tem como escrever por cima.
   */
  test('a rota LENTA que ja estava carregando nao escreve por cima da nova', async () => {
    const container = document.createElement('div');
    const router = new Router(container);
    const pintou = [];

    router.add('/acervo/lenta', async (c) => {
      await espera(30);
      c.textContent = 'LENTA';
      pintou.push('lenta');
    });
    router.add('/acervo/rapida', async (c) => {
      c.textContent = 'RAPIDA';
      pintou.push('rapida');
    });

    location.hash = '/acervo/lenta';
    const primeira = router.resolve();
    await flush();
    location.hash = '/acervo/rapida';
    await router.resolve();

    expect(container.textContent).toBe('RAPIDA');

    await primeira;
    await espera(40);
    expect(container.textContent).toBe('RAPIDA');

    // VARIANCIA: as duas cargas rodaram, e a lenta pintou ANTES da rapida. Sem
    // isto o caso passaria com a lenta nunca tendo sido chamada.
    expect(pintou).toEqual(['lenta', 'rapida']);
  });

  test('o pedido ultrapassado na fila nem chega a carregar', async () => {
    const container = document.createElement('div');
    const router = new Router(container);
    const carregou = [];

    router.add('/acervo/lenta', async (c) => {
      await espera(30);
      c.textContent = 'LENTA';
      carregou.push('lenta');
    });
    router.add('/acervo/meio', async (c) => {
      c.textContent = 'MEIO';
      carregou.push('meio');
    });
    router.add('/acervo/fim', async (c) => {
      c.textContent = 'FIM';
      carregou.push('fim');
    });

    location.hash = '/acervo/lenta';
    const primeira = router.resolve();
    await flush();

    // Dois cliques enquanto a lenta carrega. Os dois esperam a mesma carga, e
    // so o ultimo desenha: a espera e de UMA carga, nao da fila inteira.
    location.hash = '/acervo/meio';
    const segunda = router.resolve();
    location.hash = '/acervo/fim';
    await router.resolve();
    await segunda;
    await primeira;
    await espera(40);

    expect(carregou).toEqual(['lenta', 'fim']);
    expect(container.textContent).toBe('FIM');
  });

  test('a limpeza da pagina que carregou primeiro roda, em vez de vazar', async () => {
    const container = document.createElement('div');
    const router = new Router(container);
    const limpou = [];

    router.add('/acervo/lenta', async () => {
      await espera(30);
      return () => limpou.push('lenta');
    });
    router.add('/acervo/rapida', async () => () => limpou.push('rapida'));

    location.hash = '/acervo/lenta';
    const primeira = router.resolve();
    await flush();
    location.hash = '/acervo/rapida';
    await router.resolve();

    await primeira;
    await espera(40);

    // A lenta chegou a montar, entao a limpeza dela roda antes da rapida
    // desenhar. O ouvinte dela nao fica solto.
    expect(limpou).toEqual(['lenta']);
  });

  // CONTROLE NEGATIVO: sem concorrencia nada muda. O descarte so pode valer
  // para quem foi ULTRAPASSADO -- se ele disparasse sempre, a pagina normal
  // perderia a propria limpeza e o teste acima passaria por engano.
  test('sem outra navegacao, a pagina lenta pinta e guarda a limpeza dela', async () => {
    const container = document.createElement('div');
    const router = new Router(container);
    const limpou = [];

    router.add('/acervo/lenta', async (c) => {
      await espera(10);
      c.textContent = 'LENTA';
      return () => limpou.push('lenta');
    });
    router.add('/acervo/outra', async (c) => { c.textContent = 'OUTRA'; });

    location.hash = '/acervo/lenta';
    await router.resolve();
    expect(container.textContent).toBe('LENTA');
    expect(limpou).toEqual([]);

    // A limpeza guardada roda na navegacao seguinte.
    location.hash = '/acervo/outra';
    await router.resolve();
    expect(limpou).toEqual(['lenta']);
  });
});
