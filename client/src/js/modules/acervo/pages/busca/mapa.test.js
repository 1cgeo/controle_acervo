import { describe, test, expect, vi, beforeEach } from 'vitest';

/**
 * O clique no mapa da busca precisa devolver TODOS os poligonos sob o cursor.
 *
 * Existe por um defeito real. Neste acervo a sobreposicao e a regra: a mesma
 * folha tem Carta Topografica, CDGV, Ortoimagem, MDS e MDT, e os cinco gravam a
 * MESMA moldura por INOM. O clique lia so `features[0]`, entao escolhia um deles
 * por um criterio que nao aparece na tela (a ordem de desenho) e deixava os
 * outros quatro inalcancaveis: nao havia onde clicar para chegar neles.
 *
 * O MapLibre tambem repete a mesma feicao quando ela cai em mais de um ladrilho,
 * e sem deduplicar o mesmo produto voltaria varias vezes.
 */

let ouvintes = {};
let camadas = [];

const mapaFalso = {
  addControl: vi.fn(),
  addSource: vi.fn(),
  addLayer: vi.fn(l => camadas.push(l)),
  getSource: vi.fn(() => ({ setData: vi.fn() })),
  getCanvas: vi.fn(() => ({ style: {} })),
  getLayer: vi.fn(() => true),
  setFeatureState: vi.fn(),
  removeFeatureState: vi.fn(),
  on: vi.fn((evento, alvoOuFn, talvezFn) => {
    const chave = talvezFn ? `${evento}:${alvoOuFn}` : evento;
    ouvintes[chave] = talvezFn || alvoOuFn;
  }),
  resize: vi.fn(),
  remove: vi.fn(),
  getBounds: vi.fn(),
  easeTo: vi.fn(),
  fitBounds: vi.fn(),
  queryRenderedFeatures: vi.fn(() => []),
};

vi.mock('@components/mapa/base.js', () => ({
  ESTILO_OSM: { version: 8, sources: {}, layers: [] },
  BRASIL: [[-74, -34], [-34, 6]],
  caixaDe: vi.fn(() => [[-51, -31], [-50, -29]]),
  carregarMapLibre: vi.fn(() => Promise.resolve({
    Map: vi.fn(() => mapaFalso),
    NavigationControl: vi.fn(),
    ScaleControl: vi.fn(),
  })),
}));

// Os dublês espelham a API REAL dos dois componentes (o `return` de cada um).
// Um dublê com nomes inventados passaria a montagem e quebraria na primeira
// chamada, que foi o que aconteceu ao escrever este arquivo.
vi.mock('@components/mapa/desenho-area.js', () => ({
  criarDesenhoDeArea: () => ({
    botao: document.createElement('button'),
    controles: document.createElement('div'),
    montar: () => {},
    tratarTecla: () => false,
    mostrarArea: () => {},
    limparArea: () => {},
    // `ocupado()` falso: o modo de desenho nao esta ativo, entao o clique no
    // produto vale. Com ele verdadeiro o mapa ignora o clique de proposito.
    ocupado: () => false,
    desabilitar: () => {},
    destruir: () => {},
  }),
}));

vi.mock('@components/mapa/limite-destaque.js', () => ({
  criarDestaqueDeLimite: () => ({
    montar: () => {},
    mostrar: () => {},
    limpar: () => {},
    montado: () => true,
  }),
}));

import { criarMapa } from './mapa.js';

// Duas folhas com a MESMA moldura: e o caso real do Convenio RS, onde
// Ortoimagem, MDS e MDT cobrem exatamente a celula da Carta Topografica.
const MOLDURA = {
  type: 'Polygon',
  coordinates: [[[-51, -30], [-51, -29], [-50, -29], [-50, -30], [-51, -30]]],
};

async function montar() {
  ouvintes = {};
  camadas = [];
  const recebido = [];
  const mapa = criarMapa({
    onAlternarSelecao: ids => recebido.push(ids),
    onApontar: () => {},
    onAreaDesenhada: () => {},
    onAreaCancelada: () => {},
  });
  await mapa.iniciar();
  ouvintes.load();
  mapa.setProdutos([
    { id: 10, nome: 'Garibaldi (CT)', geom: MOLDURA },
    { id: 11, nome: 'Garibaldi (Orto)', geom: MOLDURA },
    { id: 12, nome: 'Garibaldi (MDS)', geom: MOLDURA },
  ]);
  return { mapa, recebido };
}

beforeEach(() => {
  global.ResizeObserver = class { observe() {} disconnect() {} };
});

describe('mapa da busca: clique sobre poligonos sobrepostos', () => {
  test('devolve TODOS os poligonos sob o cursor, e nao so o de cima', async () => {
    const { recebido } = await montar();
    const clique = ouvintes['click:produtos-preenchimento'];
    expect(clique).toBeTypeOf('function');

    clique({
      features: [
        { id: 12, properties: { id: 12 } },
        { id: 11, properties: { id: 11 } },
        { id: 10, properties: { id: 10 } },
      ],
    });

    expect(recebido).toEqual([[12, 11, 10]]);
  });

  test('preserva a ordem de cima para baixo que o MapLibre entrega', async () => {
    const { recebido } = await montar();

    ouvintes['click:produtos-preenchimento']({
      features: [{ id: 11, properties: {} }, { id: 10, properties: {} }],
    });

    // A pagina usa a PRIMEIRA para decidir que cartao destacar na lista, entao a
    // ordem nao e detalhe.
    expect(recebido[0][0]).toBe(11);
  });

  test('deduplica a feicao que aparece em mais de um ladrilho', async () => {
    const { recebido } = await montar();

    ouvintes['click:produtos-preenchimento']({
      features: [
        { id: 10, properties: {} },
        { id: 10, properties: {} },
        { id: 11, properties: {} },
        { id: 10, properties: {} },
      ],
    });

    expect(recebido).toEqual([[10, 11]]);
  });

  test('descarta feicao sem id em vez de mandar NaN', async () => {
    const { recebido } = await montar();

    ouvintes['click:produtos-preenchimento']({
      features: [{ properties: {} }, { id: 10, properties: {} }],
    });

    expect(recebido).toEqual([[10]]);
  });

  test('clique sem feicao nenhuma nao avisa a pagina', async () => {
    const { recebido } = await montar();

    ouvintes['click:produtos-preenchimento']({ features: [] });

    expect(recebido).toEqual([]);
  });
});
