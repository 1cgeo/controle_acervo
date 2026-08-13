import {
  describe, test, expect, vi, beforeEach,
} from 'vitest';

// O CONTEINER SEM TAMANHO, que envenenou o mapa em 2026-08-13.
//
// As abas montam o conteudo sob demanda: ao SAIR da aba Mapa, `createTabs` limpa
// o painel e o conteiner e DESTACADO do documento, enquanto o mapa continua vivo
// para nao repagar meio megabyte de MapLibre na volta. Destacado, `clientWidth`
// e 0.
//
// `fitBounds` divide o espaco disponivel pela extensao da caixa. Com largura 0 o
// disponivel e `0 - 2*padding`, um NEGATIVO: o zoom sai NaN, o centro vira NaN e
// o `transform` NAO se recupera. O sintoma aparece longe daqui -- todo movimento
// do mouse lanca "Invalid LngLat object: (NaN, NaN)" e o `_calcMatrices` quebra
// em cima de matriz nula.
//
// Aqui o MapLibre e um duble, mas ele FAZ A CONTA DE VERDADE e recusa o que a
// biblioteca recusaria. Um duble que so registrasse a chamada aceitaria o
// padding maior que a tela, que e metade do defeito.

const espiao = vi.hoisted(() => ({
  fits: [],
  resizes: 0,
  aoObservar: null,
  larguraDoCanvas: 1000,
  alturaDoCanvas: 520,
}));

vi.mock('@components/mapa/base.js', async (importarOriginal) => {
  const original = await importarOriginal();
  return {
    ...original,
    carregarMapLibre: async () => ({
      Map: class {
        constructor (opcoes) {
          this.container = opcoes.container;
          this._ouvintes = {};
          this.opcoes = opcoes;
          espiao.instancia = this;
        }

        addControl () {}

        on (evento, a, b) {
          const fn = typeof a === 'function' ? a : b;
          (this._ouvintes[evento] = this._ouvintes[evento] || []).push(fn);
        }

        disparar (evento) {
          for (const fn of this._ouvintes[evento] || []) fn();
        }

        addSource (id) { (this._fontes = this._fontes || {})[id] = { setData () {} }; }

        getSource (id) { return (this._fontes || {})[id]; }

        addLayer () {}

        setFeatureState () {}

        getCanvas () { return { style: {} }; }

        resize () { espiao.resizes += 1; }

        // A CONTA DE VERDADE. `fitBounds` de um conteiner sem espaco util
        // produz zoom nao-finito, e e isso que apodrece o transform.
        fitBounds (limites, opcoes) {
          const larg = this.container.clientWidth;
          const alt = this.container.clientHeight;
          const dispX = larg - 2 * opcoes.padding;
          const dispY = alt - 2 * opcoes.padding;
          const fracLon = Math.abs(limites[1][0] - limites[0][0]) / 360;
          const escala = fracLon > 0 ? dispX / fracLon : Infinity;
          const zoom = Math.log2(escala / 512);
          espiao.fits.push({ limites, opcoes, dispX, dispY, zoom });
          if (dispX <= 0 || dispY <= 0 || !Number.isFinite(zoom)) {
            throw new Error(`Invalid LngLat object: (NaN, NaN) [disp ${dispX}x${dispY}]`);
          }
        }
      },
      NavigationControl: class {},
      ScaleControl: class {},
    }),
  };
});

import { criarMapaCampos } from '@/js/pages/campo/campo-mapa.js';

const TRAJETO = {
  type: 'LineString',
  coordinates: [[-54.58, -30.06], [-53.0, -27.0], [-51.17, -24.06]],
};

// O jsdom NAO faz layout: `clientWidth` e sempre 0. O tamanho entra por
// definicao de propriedade, que e o que permite simular a aba escondida.
function dimensionar (elemento, largura, altura) {
  Object.defineProperty(elemento, 'clientWidth', { value: largura, configurable: true });
  Object.defineProperty(elemento, 'clientHeight', { value: altura, configurable: true });
}

async function montar ({ largura = 1000, altura = 520 } = {}) {
  const mapa = criarMapaCampos({});
  document.body.appendChild(mapa.element);
  const canvas = mapa.element.querySelector('.campo-mapa__canvas');
  dimensionar(canvas, largura, altura);
  await mapa.iniciar();
  // O `load` do MapLibre e o que faz o mapa ficar PRONTO: e nele que as fontes
  // e as camadas nascem. Sem dispara-lo, `enquadrar` so guardaria o alvo e o
  // teste nunca chegaria ao `fitBounds`. Sem tamanho o mapa nem e construido, e
  // ai nao ha o que disparar.
  if (espiao.instancia) espiao.instancia.disparar('load');
  return { mapa, canvas };
}

beforeEach(() => {
  document.body.innerHTML = '';
  espiao.fits = [];
  espiao.resizes = 0;
  espiao.instancia = null;
  global.ResizeObserver = class {
    constructor (fn) { espiao.aoObservar = fn; }

    observe () {}

    disconnect () {}
  };
});

describe('o mapa nunca enquadra num conteiner sem tamanho', () => {
  // O FURO QUE SOBREVIVEU A PRIMEIRA LEVA DE TRAVAS. O construtor do MapLibre
  // faz um `fitBounds` proprio (`bounds` mais `fitBoundsOptions`) com o tamanho
  // do conteiner NAQUELE instante: construir em 0x0 nasce com o transform
  // envenenado, e nenhuma trava no `resize` ou no `fitBounds` posterior
  // desenvenena. O mapa so pode NASCER quando houver tamanho.
  test('em 0x0 o mapa nem e construido, e nasce quando o tamanho chega', async () => {
    const { mapa, canvas } = await montar({ largura: 0, altura: 0 });

    expect(espiao.instancia).toBeNull();
    expect(espiao.fits).toHaveLength(0);

    // O pedido de enquadramento fica guardado, sem quebrar nada.
    expect(() => mapa.enquadrar(TRAJETO, 13)).not.toThrow();
    expect(espiao.fits).toHaveLength(0);

    // O tamanho chega (a aba apareceu): o observador constroi o mapa.
    dimensionar(canvas, 1000, 520);
    expect(() => espiao.aoObservar()).not.toThrow();
    expect(espiao.instancia).not.toBeNull();

    // E o alvo guardado e aplicado quando o mapa fica pronto.
    espiao.instancia.disparar('load');
    expect(espiao.fits).toHaveLength(1);
    expect(Number.isFinite(espiao.fits[0].zoom)).toBe(true);
  });

  test('a aba escondida (0x0) NAO chama fitBounds, e guarda o alvo', async () => {
    const { mapa, canvas } = await montar({ largura: 1000, altura: 520 });
    expect(espiao.instancia).not.toBeNull();

    // A aba foi trocada: `createTabs` limpa o painel e o conteiner e destacado.
    dimensionar(canvas, 0, 0);
    expect(() => mapa.enquadrar(TRAJETO, 13)).not.toThrow();
    expect(espiao.fits).toHaveLength(0);

    // O tamanho volta (a aba reapareceu) e o observador solta o alvo guardado.
    dimensionar(canvas, 1000, 520);
    expect(() => espiao.aoObservar()).not.toThrow();
    expect(espiao.fits).toHaveLength(1);
    expect(Number.isFinite(espiao.fits[0].zoom)).toBe(true);
  });

  test('o observador nao redimensiona para 0x0', async () => {
    const { canvas } = await montar({ largura: 1000, altura: 520 });
    const antes = espiao.resizes;

    dimensionar(canvas, 0, 0);
    espiao.aoObservar();
    expect(espiao.resizes).toBe(antes);

    dimensionar(canvas, 800, 520);
    espiao.aoObservar();
    expect(espiao.resizes).toBe(antes + 1);
  });

  test('redimensionar() da aba tambem recusa 0x0', async () => {
    const { mapa, canvas } = await montar({ largura: 1000, altura: 520 });
    dimensionar(canvas, 0, 0);
    const antes = espiao.resizes;
    expect(() => mapa.redimensionar()).not.toThrow();
    expect(espiao.resizes).toBe(antes);
  });

  // MEDIDO: com 120px de largura, o padding de 60 zera o espaco disponivel e o
  // zoom sai -Infinity, com o mesmo estrago do conteiner destacado.
  test('a folga cede a tela estreita em vez de zerar o espaco', async () => {
    const { mapa } = await montar({ largura: 120, altura: 520 });
    expect(() => mapa.enquadrar(TRAJETO, 13)).not.toThrow();
    expect(espiao.fits).toHaveLength(1);
    const { opcoes, dispX, zoom } = espiao.fits[0];
    expect(opcoes.padding).toBeLessThan(60);
    expect(dispX).toBeGreaterThan(0);
    expect(Number.isFinite(zoom)).toBe(true);
  });

  test('em tela normal a folga pedida e respeitada, e sem animacao', async () => {
    const { mapa } = await montar({ largura: 1000, altura: 520 });
    mapa.enquadrar(TRAJETO, 13);
    expect(espiao.fits[0].opcoes.padding).toBe(60);
    expect(espiao.fits[0].opcoes.maxZoom).toBe(13);
    // Sem voo: o mapa vai direto ao trajeto, e nao fica meio segundo num estado
    // transitorio, aberto a redimensionamento e a clique no meio do caminho.
    expect(espiao.fits[0].opcoes.duration).toBe(0);
  });

  // O MapLibre observa o conteiner por conta propria, com 50 ms de atraso, e
  // INVENTA tamanho quando ele esta destacado do documento
  // (`clientWidth || 400`, `clientHeight || 300`). Destacar o conteiner e o
  // estado normal ao sair da aba, porque `createTabs` limpa o painel. Ligado,
  // ele e um segundo dono do mesmo `transform`, fora do alcance das travas
  // desta casa.
  test('o observador interno do MapLibre fica DESLIGADO', async () => {
    await montar({ largura: 1000, altura: 520 });
    expect(espiao.instancia.opcoes.trackResize).toBe(false);
  });
});
